// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPnpmMinimumReleaseAgeSupportMock = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/socket_firewall", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/socket_firewall")>();
  return {
    ...actual,
    getPnpmMinimumReleaseAgeSupport: getPnpmMinimumReleaseAgeSupportMock,
  };
});

import {
  allocateE2eTestPort,
  buildE2eTestStartCommand,
  e2eServerReadyTimeoutMs,
  releaseE2eTestPort,
  startE2eTestRuntime,
} from "./e2e_test_runtime";
import { runningApps } from "@/ipc/utils/process_manager";
import {
  E2E_TEST_SERVER_PORT_RANGE,
  E2E_TEST_SERVER_PORT_START,
  isReservedDyadPort,
} from "../../../shared/ports";

function mockPnpmAvailable(available: boolean) {
  getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
    available,
    minimumReleaseAgeSupported: available,
  });
}

describe("buildE2eTestStartCommand", () => {
  beforeEach(() => {
    getPnpmMinimumReleaseAgeSupportMock.mockReset();
    mockPnpmAvailable(false);
  });

  it("starts npm without reinstalling dependencies", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
    });
    expect(command.command).toBe("npm run dev -- --port 45678");
    expect(command.command).not.toContain("install");
    expect(command.env.PORT).toBe("45678");
  });

  it("supports an explicit port placeholder in custom commands", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: "custom-install",
      startCommand: "custom-server --listen {port}",
    });
    expect(command.command).toBe(
      "(custom-install) && (custom-server --listen 45678)",
    );
  });

  it("runs both custom commands verbatim instead of appending a port flag", async () => {
    // Same `install && start` shape `getCommand` builds for the preview: the
    // sandbox is a fresh copy, so skipping the install step would drop codegen
    // or a build the server needs and break the app under test only.
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: "pip install -r requirements.txt",
      startCommand: "python server.py",
    });
    expect(command.command).toBe(
      "(pip install -r requirements.txt) && (python server.py)",
    );
    expect(command.env.PORT).toBe("45678");
  });

  it("groups each half so a start command's own operators still bind", async () => {
    // `&&` binds left-to-right, so an ungrouped `install && A || B` runs `B`
    // when the *install* fails — re-associating the user's command under test
    // only.
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: "make deps",
      startCommand: "./serve.sh || ./fallback.sh",
    });
    expect(command.command).toBe(
      "(make deps) && (./serve.sh || ./fallback.sh)",
    );
  });

  it("ignores a start command that has no matching install command", async () => {
    // `getCommand` in app_runtime_service only treats an app as custom when
    // both commands are set; the sandbox must agree with the normal preview.
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      startCommand: "python server.py",
    });
    expect(command.command).toBe("npm run dev -- --port 45678");
  });

  it("uses pnpm when the sandbox contains its lockfile", async () => {
    mockPnpmAvailable(true);
    const root = fs.mkdtempSync(path.join(process.cwd(), ".e2e-runtime-test-"));
    try {
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      const command = await buildE2eTestStartCommand({
        workspacePath: root,
        port: 45678,
      });
      expect(command.command).toContain("pnpm");
      expect(command.command).not.toContain("install");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to npm when the lockfile wants pnpm but pnpm is unusable", async () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".e2e-runtime-test-"));
    try {
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      const command = await buildE2eTestStartCommand({
        workspacePath: root,
        port: 45678,
      });
      expect(command.command).toBe("npm run dev -- --port 45678");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("starts and stops a server without registering the normal app runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-runtime-"));
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      `import http from "node:http";
const port = Number(process.argv[2]);
http.createServer((_request, response) => response.end("sandbox"))
  .listen(port, "127.0.0.1");
`,
    );
    let runtime: Awaited<ReturnType<typeof startE2eTestRuntime>> | undefined;
    const registeredRuntimeCount = runningApps.size;
    try {
      runtime = await startE2eTestRuntime({
        workspacePath: root,
        installCommand: "true",
        startCommand: `"${process.execPath}" server.mjs {port}`,
      });
      await expect(
        fetch(runtime.baseUrl).then((response) => response.text()),
      ).resolves.toBe("sandbox");
      expect(runningApps.size).toBe(registeredRuntimeCount);
    } finally {
      await runtime?.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("allocateE2eTestPort", () => {
  it("allocates out of Dyad's reserved band, never another app's port", async () => {
    const port = await allocateE2eTestPort();
    try {
      expect(port).toBeGreaterThanOrEqual(E2E_TEST_SERVER_PORT_START);
      expect(port).toBeLessThan(
        E2E_TEST_SERVER_PORT_START + E2E_TEST_SERVER_PORT_RANGE,
      );
      // The whole point: an OS-assigned ephemeral port would routinely land on
      // the deterministic app or proxy port of another, currently stopped app.
      expect(isReservedDyadPort(port)).toBe(false);
    } finally {
      releaseE2eTestPort(port);
    }
  });

  it("does not hand the same port to two runs starting at once", async () => {
    const [first, second] = await Promise.all([
      allocateE2eTestPort(),
      allocateE2eTestPort(),
    ]);
    try {
      expect(first).not.toBe(second);
    } finally {
      releaseE2eTestPort(first);
      releaseE2eTestPort(second);
    }
  });
});

describe("startE2eTestRuntime port recovery", () => {
  it("stops polling a dead port when the server announces the clash", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-port-"));
    // Mimics Vite's default `strictPort: false`: it prints the clash, moves to
    // another port and keeps running, so nothing throws and nothing ever
    // answers on the port Dyad picked. Without matching that output the poll
    // would sit here for the full two-minute readiness timeout.
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      [
        "const port = Number(process.argv[2]);",
        "console.log(`Port ${port} is in use, trying another one...`);",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const startedAt = Date.now();
    try {
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: "true",
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toThrow(/already in use|is in use/i);
      // Three attempts, each bailing on the announcement rather than waiting
      // out SERVER_READY_TIMEOUT_MS (120s).
      expect(Date.now() - startedAt).toBeLessThan(30_000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("startE2eTestRuntime port accounting", () => {
  it("hands the port back when start-command construction throws", async () => {
    // The pnpm version probe runs between the allocation and the try/catch that
    // used to be the only place releasing the port, so a failure here burned
    // one of the 200 band ports for the life of the process — and enough of
    // them left no port to allocate at all.
    getPnpmMinimumReleaseAgeSupportMock.mockRejectedValue(new Error("probe"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-release-"));
    try {
      await expect(
        startE2eTestRuntime({ workspacePath: root }),
      ).rejects.toThrow(/probe/);
      const port = await allocateE2eTestPort();
      try {
        // Free again — which it only is if the failed run released it.
        expect(port).toBe(E2E_TEST_SERVER_PORT_START);
      } finally {
        releaseE2eTestPort(port);
      }
    } finally {
      mockPnpmAvailable(false);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not retry when a sidecar reports a clash on its own port", async () => {
    // The "exited before becoming ready" error embeds 8KB of server output, so
    // matching a substring of the whole message turned any sidecar's
    // EADDRINUSE — Postgres, Redis, a second worker — into three more full
    // server starts before the real error reached the user.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-sidecar-"));
    const attempts = path.join(root, "attempts");
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      [
        'import fs from "node:fs";',
        'fs.appendFileSync(process.env.DYAD_ATTEMPTS, "x");',
        // Deliberately NOT the port Dyad allocated.
        "console.error('listen EADDRINUSE: address already in use 127.0.0.1:5432');",
        "process.exit(1);",
      ].join("\n"),
    );
    process.env.DYAD_ATTEMPTS = attempts;
    try {
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: "true",
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toThrow(/exited before becoming ready/i);
      expect(fs.readFileSync(attempts, "utf8")).toBe("x");
    } finally {
      delete process.env.DYAD_ATTEMPTS;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("still retries when the clash really is on the allocated port", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-clash-"));
    const attempts = path.join(root, "attempts");
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      [
        'import fs from "node:fs";',
        "const port = Number(process.argv[2]);",
        'fs.appendFileSync(process.env.DYAD_ATTEMPTS, "x");',
        "console.error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`);",
        "process.exit(1);",
      ].join("\n"),
    );
    process.env.DYAD_ATTEMPTS = attempts;
    try {
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: "true",
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toThrow(/in use/i);
      expect(fs.readFileSync(attempts, "utf8")).toBe("xxx");
    } finally {
      delete process.env.DYAD_ATTEMPTS;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("e2eServerReadyTimeoutMs", () => {
  it("gives a custom app's install step room beyond the server budget", () => {
    // `install && start` is one spawned command, so `pip install -r
    // requirements.txt`, `bundle install` or a cold `npm ci` spends the
    // readiness budget — and routinely passes two minutes on a first run.
    const dyadManaged = e2eServerReadyTimeoutMs({});
    const custom = e2eServerReadyTimeoutMs({
      installCommand: "pip install -r requirements.txt",
      startCommand: "python server.py",
    });
    expect(dyadManaged).toBe(120_000);
    expect(custom).toBeGreaterThan(dyadManaged);
  });

  it("does not extend the budget for a start command with no install command", () => {
    // Same rule `getCommand` uses: an app is custom only when both are set.
    expect(e2eServerReadyTimeoutMs({ startCommand: "python server.py" })).toBe(
      120_000,
    );
  });
});
