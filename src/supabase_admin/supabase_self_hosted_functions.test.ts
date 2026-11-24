// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { generateSshKeyPair } from "@/testing/fake_ssh_server";
import {
  currentFunctionFiles,
  readTarArchive,
  startFakeEdgeRuntimeSsh,
  type FakeEdgeRuntimeSsh,
} from "@/testing/fake_supabase_edge_runtime_ssh";
import {
  startFakeSupabaseSelfHosted,
  type FakeSupabaseSelfHosted,
} from "@/testing/fake_supabase_self_hosted_server";
import {
  checkSupabaseSelfHostedSsh,
  closeSupabaseSelfHostedSessions,
  createTarArchive,
  DEFAULT_WORKER_LIFETIME_MS,
  deleteSupabaseSelfHostedFunction,
  deployCommand,
  deploySupabaseSelfHostedFunction,
  parseEdgeRuntimeLogs,
  parseWorkerLifetimeMs,
  readSupabaseSelfHostedFunctionLogs,
} from "./supabase_self_hosted_functions";
import recordedLogs from "./__fixtures__/supabase_self_hosted/upstream/edge_runtime_logs.txt?raw";

const encode = (text: string) => new TextEncoder().encode(text);
const key = generateSshKeyPair().private;

let ssh: FakeEdgeRuntimeSsh | undefined;
let http: FakeSupabaseSelfHosted | undefined;

afterEach(async () => {
  closeSupabaseSelfHostedSessions();
  await ssh?.close();
  await http?.close();
  ssh = undefined;
  http = undefined;
});

function instanceFor(server: FakeEdgeRuntimeSsh, container?: string) {
  return {
    id: `instance-${server.port}`,
    ssh: {
      host: "127.0.0.1",
      port: server.port,
      username: "deployer",
      privateKey: key,
      hostKeyFingerprint: server.hostKeyFingerprint,
      functionsContainer: container ?? server.containers[0].name,
    },
  };
}

describe("createTarArchive", () => {
  it("writes files tar can read back, including paths over 100 bytes", () => {
    const longPath = `hello/${"nested/".repeat(16)}deep.ts`;
    const archive = createTarArchive([
      { relativePath: "hello/index.ts", content: encode("export {};\n") },
      { relativePath: longPath, content: encode("x".repeat(700)) },
    ]);

    expect(archive.length % 512).toBe(0);
    expect(readTarArchive(archive)).toEqual(
      new Map([
        ["hello/index.ts", "export {};\n"],
        [longPath, "x".repeat(700)],
      ]),
    );
  });
});

// The fake server below lays files out itself, so the shell script that runs
// inside the container is exercised here with a real sh and tar.
describe.skipIf(process.platform === "win32")("the deploy script", () => {
  const MINUTE = 60_000;
  const T0 = 1_795_000_000_000;
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-functions-"));
    write("main/index.ts", "const workerTimeoutMs = 1 * 60 * 1000\n");
    write("_shared/other-app.ts", "kept");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const runScript = (input: Uint8Array, nowMs: number) => {
    const script = /sh -c '([\s\S]*)'$/
      .exec(deployCommand("container", "hello", { nowMs }))![1]
      .replace("/home/deno/functions", root);
    return execFileSync("sh", ["-c", script], {
      input,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  };
  const deploy = (version: string, nowMs: number) =>
    runScript(
      createTarArchive([
        {
          relativePath: "hello/index.ts",
          content: encode(
            `import { tag } from "../_shared/tag.ts";\nexport default { version: "${version}", tag };\n`,
          ),
        },
        {
          relativePath: "_shared/tag.ts",
          content: encode(`export const tag = "shared-${version}";\n`),
        },
      ]),
      nowMs,
    );
  const tree = () =>
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(root, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join("/"),
      )
      .sort();
  const versions = () =>
    fs.readdirSync(path.join(root, "hello", ".dyad")).sort();
  /** Loads the function the way the runtime does: through its index.ts. */
  let loads = 0;
  const load = async () =>
    (
      await import(
        `${pathToFileURL(path.join(root, "hello", "index.ts")).href}?load=${++loads}`
      )
    ).default;

  it("deploys a new function into a version directory behind its entry", async () => {
    const output = deploy("v1", T0);

    expect(output).toContain("dyad-existed:0");
    expect(output).toContain(
      "dyad-worker-lifetime:const workerTimeoutMs = 1 * 60 * 1000",
    );
    const [version] = versions();
    expect(version).toMatch(new RegExp(`^${T0}-[0-9a-f]{12}$`));
    expect(tree()).toEqual([
      "_shared/other-app.ts",
      `hello/.dyad/${version}/_shared/tag.ts`,
      `hello/.dyad/${version}/hello/index.ts`,
      "hello/index.ts",
      "main/index.ts",
    ]);
    // Its _shared imports resolve to the copy deployed with it.
    expect(await load()).toEqual({ version: "v1", tag: "shared-v1" });
  });

  it("points the entry at each new version and keeps recent ones", async () => {
    deploy("v1", T0);
    const output = deploy("v2", T0 + MINUTE);

    expect(output).toContain("dyad-existed:1");
    expect(versions()).toHaveLength(2);
    expect(await load()).toEqual({ version: "v2", tag: "shared-v2" });
  });

  it("re-exports nothing as an empty default for Deno.serve functions", async () => {
    write("hello/index.ts", "");
    runScript(
      createTarArchive([
        {
          relativePath: "hello/index.ts",
          content: encode("(globalThis as any).served = true;\n"),
        },
      ]),
      T0,
    );

    expect(await load()).toEqual({});
    expect((globalThis as { served?: boolean }).served).toBe(true);
  });

  it("removes a version once it has been replaced for 75 minutes", () => {
    deploy("v1", T0);
    const [first] = versions();
    deploy("v2", T0 + MINUTE);
    const [, second] = versions();

    // v1 was replaced 74 minutes ago: kept for workers that may still read
    // it, since a router's worker lifetime can be up to an hour.
    deploy("v3", T0 + 75 * MINUTE);
    expect(versions()).toContain(first);

    // Replaced 76 minutes ago now. v2 was replaced 2 minutes ago.
    deploy("v4", T0 + 77 * MINUTE);
    expect(versions()).not.toContain(first);
    expect(versions()).toContain(second);
    expect(versions()).toHaveLength(3);
  });

  it("converts a function deployed another way without removing its files early", async () => {
    write("hello/index.ts", "export default { version: 'plain' };\n");
    write("hello/helper.ts", "old helper");

    expect(deploy("v1", T0)).toContain("dyad-existed:1");
    expect(tree()).toContain("hello/helper.ts");
    expect(await load()).toEqual({ version: "v1", tag: "shared-v1" });

    deploy("v2", T0 + 76 * MINUTE);
    expect(tree().filter((file) => !file.includes("/.dyad/"))).toEqual([
      "_shared/other-app.ts",
      "hello/index.ts",
      "main/index.ts",
    ]);
  });

  it("keeps the deployed function when the upload is broken", async () => {
    deploy("v1", T0);
    const before = tree();

    expect(() => runScript(encode("not a tar archive"), T0 + MINUTE)).toThrow();

    expect(tree()).toEqual(before);
    expect(
      fs.readdirSync(root).filter((name) => name.startsWith(".dyad-")),
    ).toEqual([]);
    expect(await load()).toEqual({ version: "v1", tag: "shared-v1" });
  });
});

describe("parseWorkerLifetimeMs", () => {
  it("reads both routers' ways of writing the lifetime", () => {
    // Upstream's router, then Coolify's.
    expect(parseWorkerLifetimeMs("  const workerTimeoutMs = 400_000")).toBe(
      400_000,
    );
    expect(
      parseWorkerLifetimeMs("  const workerTimeoutMs = 1 * 60 * 1000"),
    ).toBe(60_000);
  });

  it("falls back to upstream's lifetime for anything else", () => {
    for (const line of [
      "",
      "const workerTimeoutMs = getTimeout()",
      "const workerTimeoutMs = 5",
      "const workerTimeoutMs = 99 * 60 * 60 * 1000",
    ]) {
      expect(parseWorkerLifetimeMs(line)).toBe(DEFAULT_WORKER_LIFETIME_MS);
    }
  });
});

describe("parseEdgeRuntimeLogs", () => {
  it("turns recorded upstream output into one entry per console call", () => {
    const entries = parseEdgeRuntimeLogs(recordedLogs);

    expect(entries.map(({ level, message }) => [level, message])).toEqual([
      [
        "info",
        '[hello-logs] request received { mode: "ok", nested: { ok: true } }',
      ],
      ["warn", "[hello-logs] slow path"],
      ["info", "[hello-logs] two\nlines"],
      ["error", "unprefixed error line"],
      [
        "info",
        '[hello-logs] request received { mode: "throw", nested: { ok: true } }',
      ],
      ["warn", "[hello-logs] slow path"],
      ["info", "[hello-logs] two\nlines"],
      [
        "error",
        expect.stringMatching(
          /^\[hello-logs\] Error: handler failed\n    at Object\.handler/,
        ),
      ],
    ]);
    expect(entries[0].timestamp).toBe(Date.parse("2026-11-17T17:30:44.785Z"));
  });

  it("drops the runtime's own startup line", () => {
    // Recorded: Deno.serve prints this whenever a function's worker starts.
    const entries = parseEdgeRuntimeLogs(
      [
        "2026-11-17T18:45:55.804643107Z [Info] Listening on http://localhost:9999/",
        "2026-11-17T18:45:55.804650000Z ",
        "2026-11-17T18:45:55.928121582Z [Info] [clear-completed] Listening on http://localhost:9999/",
        "2026-11-17T18:45:55.928130000Z ",
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.message)).toEqual([
      "[clear-completed] Listening on http://localhost:9999/",
    ]);
  });
});

describe("deploying over SSH", () => {
  beforeEach(async () => {
    ssh = await startFakeEdgeRuntimeSsh();
  });

  it("deploys the function with its shared files and reports what it replaced", async () => {
    const container = ssh!.containers[0].name;
    ssh!.files.set(
      container,
      new Map([["main/index.ts", "  const workerTimeoutMs = 1 * 60 * 1000\n"]]),
    );
    const deployHello = (text: string) =>
      deploySupabaseSelfHostedFunction({
        instance: instanceFor(ssh!),
        functionName: "hello",
        files: [
          { relativePath: "hello/index.ts", content: encode(text) },
          { relativePath: "_shared/cors.ts", content: encode("cors") },
        ],
      });

    await expect(deployHello("v1")).resolves.toEqual({
      replacedExisting: false,
      workerLifetimeMs: 60_000,
    });
    await expect(deployHello("v2")).resolves.toEqual({
      replacedExisting: true,
      workerLifetimeMs: 60_000,
    });
    expect(currentFunctionFiles(ssh!, container, "hello")).toEqual(
      new Map([
        ["hello/index.ts", "v2"],
        ["_shared/cors.ts", "cors"],
      ]),
    );
  });

  it("never touches the router function", async () => {
    await expect(
      deploySupabaseSelfHostedFunction({
        instance: instanceFor(ssh!),
        functionName: "main",
        files: [{ relativePath: "main/index.ts", content: encode("x") }],
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    await expect(
      deleteSupabaseSelfHostedFunction({
        instance: instanceFor(ssh!),
        functionName: "main",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(ssh!.commands).toEqual([]);
  });

  it("refuses files outside the function and shared directories", async () => {
    await expect(
      deploySupabaseSelfHostedFunction({
        instance: instanceFor(ssh!),
        functionName: "hello",
        files: [
          { relativePath: "hello/index.ts", content: encode("x") },
          { relativePath: "hello/../main/index.ts", content: encode("x") },
        ],
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(ssh!.commands).toEqual([]);
  });

  it("deletes only the named function", async () => {
    const container = ssh!.containers[0].name;
    ssh!.files.set(
      container,
      new Map([
        ["hello/index.ts", "a"],
        ["hello-two/index.ts", "b"],
      ]),
    );

    await expect(
      deleteSupabaseSelfHostedFunction({
        instance: instanceFor(ssh!),
        functionName: "hello",
      }),
    ).resolves.toEqual({ workerLifetimeMs: DEFAULT_WORKER_LIFETIME_MS });

    expect([...ssh!.files.get(container)!.keys()]).toEqual([
      "hello-two/index.ts",
    ]);
  });

  it("reads logs since a time and reuses one connection", async () => {
    ssh!.logs = recordedLogs;
    const instance = instanceFor(ssh!);

    const logs = await readSupabaseSelfHostedFunctionLogs({
      instance,
      sinceMs: 1_794_936_000_123,
    });
    await readSupabaseSelfHostedFunctionLogs({ instance, sinceMs: 0 });

    expect(logs).toHaveLength(8);
    expect(ssh!.commands[0]).toContain("--since 1794936000.123 ");
    expect(ssh!.connections).toBe(1);
  });

  it("reconnects once when the server closed a pooled connection", async () => {
    const instance = instanceFor(ssh!);
    await readSupabaseSelfHostedFunctionLogs({ instance, sinceMs: 0 });
    ssh!.dropConnections();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      readSupabaseSelfHostedFunctionLogs({ instance, sinceMs: 0 }),
    ).resolves.toEqual([]);
    expect(ssh!.connections).toBe(2);
  });

  it("refuses a server whose host key changed", async () => {
    const instance = instanceFor(ssh!);
    instance.ssh.hostKeyFingerprint = "SHA256:someone-else";

    await expect(
      readSupabaseSelfHostedFunctionLogs({ instance, sinceMs: 0 }),
    ).rejects.toThrow("host key changed");
    expect(ssh!.commands).toEqual([]);
  });

  it("explains a user who can't run docker", async () => {
    ssh!.dockerDenied = true;

    await expect(
      readSupabaseSelfHostedFunctionLogs({
        instance: instanceFor(ssh!),
        sinceMs: 0,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining("docker group"),
    });
  });
});

describe("checkSupabaseSelfHostedSsh", () => {
  async function start(containers: { name: string; image: string }[]) {
    ssh = await startFakeEdgeRuntimeSsh(containers);
    http = await startFakeSupabaseSelfHosted("coolify");
    return { ssh, http };
  }

  const check = () =>
    checkSupabaseSelfHostedSsh({
      url: http!.url,
      anonKey: http!.anonKey,
      ssh: {
        host: "127.0.0.1",
        port: ssh!.port,
        username: "deployer",
        privateKey: key,
      },
    });

  it("finds the container that serves the instance's URL and cleans up", async () => {
    await start([
      { name: "supabase-db-a1", image: "supabase/postgres:15.8.1.085" },
      {
        name: "supabase-edge-functions-a1",
        image: "supabase/edge-runtime:v1.71.2",
      },
      {
        name: "supabase-edge-functions-b2",
        image: "supabase/edge-runtime:v1.71.2",
      },
    ]);
    // Only the second instance's runtime is behind this gateway.
    http!.serveFunction = (name) =>
      currentFunctionFiles(ssh!, "supabase-edge-functions-b2", name)
        .get(`${name}/index.ts`)
        ?.match(/new Response\("(\w+)"\)/)?.[1];

    await expect(check()).resolves.toEqual({
      hostKeyFingerprint: ssh!.hostKeyFingerprint,
      functionsContainer: "supabase-edge-functions-b2",
    });
    for (const dir of ssh!.files.values()) expect(dir.size).toBe(0);
  });

  it("refuses when no deployed test function is served", async () => {
    await start([
      {
        name: "supabase-edge-functions",
        image: "supabase/edge-runtime:v1.77.9",
      },
    ]);

    await expect(check()).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining("wasn't served"),
    });
    expect(ssh!.files.get("supabase-edge-functions")?.size).toBe(0);
  });

  it("refuses a server without an edge runtime container", async () => {
    await start([{ name: "web", image: "nginx:1.27" }]);

    await expect(check()).rejects.toThrow(
      "no Supabase edge functions container",
    );
  });
});
