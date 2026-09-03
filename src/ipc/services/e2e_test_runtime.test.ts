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
  INSTALL_COMPLETE_MARKER,
  releaseE2eTestPort,
  startE2eTestRuntime,
} from "./e2e_test_runtime";
import { runningApps } from "@/ipc/utils/process_manager";
import { DyadErrorKind } from "@/errors/dyad_error";
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

/**
 * A custom install command that does nothing, on every platform. `true` is a
 * Unix builtin `cmd.exe` cannot run, so these suites failed on Windows before
 * the server they are testing ever started.
 */
const NO_OP_INSTALL_COMMAND = `"${process.execPath}" -e ""`;
/** The marker readiness waits for, as the shell prints it. */
const INSTALL_ECHO = `echo "${INSTALL_COMPLETE_MARKER}"`;

/**
 * Whether the whole reserved band is off limits on this machine. Dyad's own
 * E2E shards relocate the reserved port ranges over it, and the allocator then
 * legitimately hands back an OS-assigned port from outside the band.
 */
function bandIsReserved(): boolean {
  for (let offset = 0; offset < E2E_TEST_SERVER_PORT_RANGE; offset += 1) {
    if (!isReservedDyadPort(E2E_TEST_SERVER_PORT_START + offset)) return false;
  }
  return true;
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
      `custom-install && ${INSTALL_ECHO} && (custom-server --listen 45678)`,
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
      `pip install -r requirements.txt && ${INSTALL_ECHO} && (python server.py)`,
    );
    expect(command.env.PORT).toBe("45678");
  });

  it("groups the start half so its own operators still bind", async () => {
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
      `make deps && ${INSTALL_ECHO} && (./serve.sh || ./fallback.sh)`,
    );
  });

  it("leaves the install half in the parent shell", async () => {
    // A `(…)` subshell around the install command would discard the shell state
    // it sets up — a `cd`, an activated virtualenv, an exported variable — so a
    // command pair that works in the preview would fail under test only.
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: ". .venv/bin/activate && pip install -r requirements.txt",
      startCommand: "python server.py",
    });
    expect(command.command).toBe(
      `. .venv/bin/activate && pip install -r requirements.txt && ${INSTALL_ECHO} && (python server.py)`,
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

  it("starts with the package manager used for the clean install", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      packageManager: "pnpm",
    });
    expect(command.command).toBe(
      "pnpm --config.pm-on-fail=ignore run dev --port 45678",
    );
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
        installCommand: NO_OP_INSTALL_COMMAND,
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

  it("confirms the stop from the port, not from the wrapper shell's exit", async () => {
    // `killProcess` usually leaves the wrapper shell already exited, so the
    // root's fate says nothing — and a server that outlived it is what makes
    // deleting the workspace unsafe. The port is the observable a survivor
    // would still be holding.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-stop-"));
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      `import http from "node:http";
const port = Number(process.argv[2]);
http
  .createServer((_request, response) => response.end("sandbox"))
  .listen(port, "127.0.0.1");
`,
    );
    let runtime: Awaited<ReturnType<typeof startE2eTestRuntime>> | undefined;
    try {
      runtime = await startE2eTestRuntime({
        workspacePath: root,
        installCommand: NO_OP_INSTALL_COMMAND,
        startCommand: `"${process.execPath}" server.mjs {port}`,
      });
      const port = Number(new URL(runtime.baseUrl).port);

      await expect(runtime.stop()).resolves.toBe(true);

      // The verdict has to mean something: the port really is free again.
      const reclaimed = await allocateE2eTestPort();
      try {
        expect(reclaimed).toBe(port);
      } finally {
        releaseE2eTestPort(reclaimed);
      }
    } finally {
      await runtime?.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("prefers the address serving this run's own workspace", async () => {
    // The nonce is the only positive proof available: it lives in this run's
    // sandbox, so a server returning it is serving a filesystem nothing else on
    // the machine has. A decoy holds `127.0.0.1` — the address readiness tries
    // FIRST — and answers `/` without the nonce, so the assertion fails unless
    // the `owned` preference actually picks the real server on `::1`.
    // The decoy is bound by the child, AFTER the port was allocated — which is
    // the only window this can happen in: allocation probes both loopbacks, so
    // a port something already holds is never handed out.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-owned-"));
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      `import fs from "node:fs";
import http from "node:http";
import path from "node:path";
const port = Number(process.argv[2]);
// The real one first, serving this run's own files. Bound BEFORE the decoy so
// readiness can never poll a window in which only the decoy answers — it
// probes 127.0.0.1 first, and a lone answer there would be latched as the
// address to confirm.
http
  .createServer((request, response) => {
    const name = decodeURIComponent(request.url.slice(1));
    const file = path.join(process.cwd(), "public", name);
    if (name && fs.existsSync(file)) {
      response.end(fs.readFileSync(file, "utf8"));
      return;
    }
    response.end("sandbox");
  })
  .listen(port, "::1", () => {
    // Answers, but serves nothing of the workspace: a stranger on the v4
    // loopback, and only once the real server is already reachable.
    http
      .createServer((_request, response) => response.end("not the sandbox"))
      .listen(port, "127.0.0.1");
  });
`,
    );
    let runtime: Awaited<ReturnType<typeof startE2eTestRuntime>> | undefined;
    try {
      runtime = await startE2eTestRuntime({
        workspacePath: root,
        installCommand: NO_OP_INSTALL_COMMAND,
        startCommand: `"${process.execPath}" server.mjs {port}`,
      });
      // `127.0.0.1` is probed first and answered first, so picking `[::1]` can
      // only be the nonce preference at work.
      expect(runtime.baseUrl).toMatch(/^http:\/\/\[::1\]:\d+$/);
      await expect(
        fetch(runtime.baseUrl).then((response) => response.text()),
      ).resolves.toBe("sandbox");
    } finally {
      await runtime?.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("allocateE2eTestPort", () => {
  it("allocates out of Dyad's reserved band, never another app's port", async () => {
    const port = await allocateE2eTestPort();
    try {
      // The whole point, and true of every allocation: an OS-assigned ephemeral
      // port would routinely land on the deterministic app or proxy port of
      // another, currently stopped app.
      expect(isReservedDyadPort(port)).toBe(false);
      // Band membership only when the band is actually available. Dyad's own
      // E2E shards relocate the reserved ranges — `DYAD_E2E_PORT_BLOCK_INDEX=9`
      // covers this whole band — and the allocator then correctly falls through
      // to an OS-assigned port outside it.
      if (!bandIsReserved()) {
        expect(port).toBeGreaterThanOrEqual(E2E_TEST_SERVER_PORT_START);
        expect(port).toBeLessThan(
          E2E_TEST_SERVER_PORT_START + E2E_TEST_SERVER_PORT_RANGE,
        );
      }
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

  it("does not hand the same port to eight runs starting at once", async () => {
    // The bind inside the probe is not the lock it looks like: it is released
    // between the two loopback attempts, so overlapping allocations that only
    // consulted the pending set before awaiting could all come back with the
    // same port. Enough concurrency to catch that ordering.
    const ports = await Promise.all(
      Array.from({ length: 8 }, () => allocateE2eTestPort()),
    );
    try {
      expect(new Set(ports).size).toBe(ports.length);
    } finally {
      for (const port of ports) releaseE2eTestPort(port);
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
    try {
      // The 60s case timeout is the assertion: three attempts that each waited
      // out SERVER_READY_TIMEOUT_MS (120s) instead of bailing on the
      // announcement cannot finish inside it. A second, tighter wall-clock
      // bound would only add a way for a loaded CI runner to fail this.
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: NO_OP_INSTALL_COMMAND,
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toThrow(/already in use|is in use/i);
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-release-"));
    // Taken before the failing run, so the comparison is against whatever this
    // machine's allocator actually hands out. Pinning the band's first port
    // instead would fail whenever an unrelated process holds it, or whenever
    // `DYAD_E2E_PORT_BLOCK_INDEX` reserves the band and the allocator correctly
    // falls through to an OS-assigned port.
    const before = await allocateE2eTestPort();
    releaseE2eTestPort(before);
    getPnpmMinimumReleaseAgeSupportMock.mockRejectedValue(new Error("probe"));
    try {
      await expect(
        startE2eTestRuntime({ workspacePath: root }),
      ).rejects.toThrow(/probe/);
      const port = await allocateE2eTestPort();
      try {
        // The same port again — which it only is if the failed run released it.
        expect(port).toBe(before);
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
          installCommand: NO_OP_INSTALL_COMMAND,
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
      // Precondition, not Internal: three fresh ports all taken means something
      // else on the machine holds them, which the user acts on — it must not
      // land in telemetry as an unclassified product exception the way a bare
      // `Error` would.
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: NO_OP_INSTALL_COMMAND,
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(fs.readFileSync(attempts, "utf8")).toBe("xxx");
    } finally {
      delete process.env.DYAD_ATTEMPTS;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("never re-picks a port the server already failed to bind", async () => {
    // `startE2eTestRuntimeOnce` hands its port back in a `finally`, so without
    // carrying the failures across attempts the rescan starts from the same
    // offset and hands back the same port. `probePort` only binds 127.0.0.1, so
    // the case the retry exists for — a port that probes free but the server
    // cannot take (an `::1`-only listener) — would otherwise burn all three
    // attempts on one port and report "couldn't get a free port".
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-ports-"));
    const attempts = path.join(root, "attempts");
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      [
        'import fs from "node:fs";',
        "const port = Number(process.argv[2]);",
        "fs.appendFileSync(process.env.DYAD_ATTEMPTS, `${port}\\n`);",
        "console.error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`);",
        "process.exit(1);",
      ].join("\n"),
    );
    process.env.DYAD_ATTEMPTS = attempts;
    try {
      await expect(
        startE2eTestRuntime({
          workspacePath: root,
          installCommand: NO_OP_INSTALL_COMMAND,
          startCommand: `"${process.execPath}" server.mjs {port}`,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      const used = fs
        .readFileSync(attempts, "utf8")
        .split("\n")
        .filter(Boolean);
      expect(used).toHaveLength(3);
      expect(new Set(used).size).toBe(3);
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
