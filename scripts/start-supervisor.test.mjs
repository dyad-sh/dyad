import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  findMacCrashpadPids,
  findMacElectronPids,
  signalDetachedProcesses,
  signalDevelopmentTree,
  startDevelopmentSupervisor,
  unregisterMacElectronApps,
} from "./start-supervisor.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const electronExecutable = path.join(
  repoRoot,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const crashpadExecutable = path.join(
  repoRoot,
  "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler",
);

test("signals the full POSIX development process group", () => {
  const calls = [];

  signalDevelopmentTree({
    pid: 1234,
    signal: "SIGTERM",
    platform: "darwin",
    kill: (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [[-1234, "SIGTERM"]]);
});

test("finds Electron main processes in the development process group", () => {
  const stdout = `
  100  50 /repo/node
  200  50 ${electronExecutable} .
  201  50 ${repoRoot}/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper
  300  99 ${electronExecutable} .
`;

  assert.deepEqual(
    findMacElectronPids({
      processGroupId: 50,
      runSync: () => ({ stdout }),
    }),
    [200],
  );
});

test("finds detached Crashpad processes for this checkout", () => {
  const stdout = `
  200  50 ${crashpadExecutable} --database=dyad
  300  99 ${repoRoot}-zero/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --database=dyad-zero
`;

  assert.deepEqual(findMacCrashpadPids({ runSync: () => ({ stdout }) }), [200]);
});

test("signals detached development processes individually", () => {
  const calls = [];

  signalDetachedProcesses({
    pids: [200, 201],
    signal: "SIGKILL",
    kill: (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [
    [200, "SIGKILL"],
    [201, "SIGKILL"],
  ]);
});

test("unregisters Electron apps from macOS LaunchServices", () => {
  const calls = [];
  const cleanup = new EventEmitter();
  cleanup.unref = () => calls.push(["unref"]);

  unregisterMacElectronApps({
    pids: [200],
    exitStatus: 130,
    spawnProcess: (...args) => {
      calls.push(args);
      return cleanup;
    },
  });

  assert.deepEqual(calls, [
    [
      "lsappinfo",
      ["quit", "-asn", "#200", "-exitstatus", "130"],
      { detached: true, stdio: "ignore" },
    ],
    ["unref"],
  ]);
});

test("repeated terminal signals cannot interrupt forced cleanup", async () => {
  const parentProcess = new EventEmitter();
  parentProcess.execPath = process.execPath;
  parentProcess.env = {};
  parentProcess.exitCode = undefined;
  const child = new EventEmitter();
  child.pid = 4321;
  const spawnCalls = [];
  const originalKill = process.kill;
  const killCalls = [];
  process.kill = (...args) => {
    killCalls.push(args);
    return true;
  };

  try {
    startDevelopmentSupervisor({
      parentProcess,
      platform: "linux",
      forceKillAfterMs: 1,
      spawnProcess: (...args) => {
        spawnCalls.push(args);
        return child;
      },
    });

    parentProcess.emit("SIGINT");
    parentProcess.emit("SIGINT");
    parentProcess.emit("SIGHUP");
    child.emit("exit", null, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(spawnCalls[0][2].detached, true);
    assert.deepEqual(killCalls, [
      [-4321, "SIGTERM"],
      [-4321, "SIGKILL"],
    ]);
    assert.equal(parentProcess.exitCode, 130);
  } finally {
    process.kill = originalKill;
  }
});
