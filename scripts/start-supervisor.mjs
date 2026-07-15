import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const forgeCli = path.join(
  repoRoot,
  "node_modules/@electron-forge/cli/dist/electron-forge.js",
);
const electronExecutable = path.join(
  repoRoot,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const crashpadExecutable = path.join(
  repoRoot,
  "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler",
);

function readProcessTable(runSync) {
  const result = runSync("ps", ["-axo", "pid=,pgid=,command="], {
    encoding: "utf8",
  });

  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean);
}

function commandMatchesExecutable(command, executable) {
  return command === executable || command.startsWith(`${executable} `);
}

export function findMacElectronPids({ processGroupId, runSync = spawnSync }) {
  return readProcessTable(runSync)
    .filter(
      (match) =>
        Number(match[2]) === processGroupId &&
        commandMatchesExecutable(match[3], electronExecutable),
    )
    .map((match) => Number(match[1]));
}

export function findMacCrashpadPids({ runSync = spawnSync } = {}) {
  return (
    readProcessTable(runSync)
      // Crashpad leaves Forge's process group, so the executable path is the
      // only checkout-specific identity available. This intentionally cleans
      // up every Crashpad process from this checkout, including concurrent
      // development sessions.
      .filter((match) => commandMatchesExecutable(match[3], crashpadExecutable))
      .map((match) => Number(match[1]))
  );
}

export function signalDetachedProcesses({
  pids,
  signal,
  kill = process.kill.bind(process),
}) {
  for (const pid of pids) {
    try {
      kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

export function unregisterMacElectronApps({
  pids,
  exitStatus,
  spawnProcess = spawn,
}) {
  for (const pid of pids) {
    const cleanup = spawnProcess(
      "lsappinfo",
      ["quit", "-asn", `#${pid}`, "-exitstatus", String(exitStatus)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    cleanup.once("error", () => {});
    cleanup.unref();
  }
}

export function signalDevelopmentTree({
  pid,
  signal,
  platform = process.platform,
  kill = process.kill.bind(process),
  runSync = spawnSync,
}) {
  if (platform === "win32") {
    runSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    // The Forge child is a process-group leader on POSIX. A negative PID
    // signals Forge, Electron, Electron helpers, and spawned app servers.
    kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export function startDevelopmentSupervisor({
  args = process.argv.slice(2),
  platform = process.platform,
  parentProcess = process,
  spawnProcess = spawn,
  spawnCleanupProcess = spawn,
  runSync = spawnSync,
  forceKillAfterMs = 1_000,
  kill = process.kill.bind(process),
  scheduleForceKill = setTimeout,
  cancelForceKill = clearTimeout,
} = {}) {
  const child = spawnProcess(
    parentProcess.execPath,
    [forgeCli, "start", ...args],
    {
      cwd: repoRoot,
      detached: platform !== "win32",
      env: parentProcess.env,
      stdio: "inherit",
    },
  );

  let shutdownSignal;
  let forceKillTimer;

  const shutdown = (signal) => {
    if (shutdownSignal || !child.pid) return;
    shutdownSignal = signal;
    const exitStatus = signal === "SIGINT" ? 130 : 143;
    let detachedPids = [];

    if (platform === "darwin") {
      const electronPids = findMacElectronPids({
        processGroupId: child.pid,
        runSync,
      });
      detachedPids = findMacCrashpadPids({ runSync });
      unregisterMacElectronApps({
        pids: electronPids,
        exitStatus,
        spawnProcess: spawnCleanupProcess,
      });
    }

    signalDevelopmentTree({
      pid: child.pid,
      signal: "SIGTERM",
      platform,
      kill,
    });
    signalDetachedProcesses({ pids: detachedPids, signal: "SIGTERM", kill });
    forceKillTimer = scheduleForceKill(() => {
      signalDevelopmentTree({
        pid: child.pid,
        signal: "SIGKILL",
        platform,
        kill,
      });
      signalDetachedProcesses({ pids: detachedPids, signal: "SIGKILL", kill });
      parentProcess.exitCode = exitStatus;
      removeSignalHandlers();
    }, forceKillAfterMs);
  };

  const handleSigint = () => shutdown("SIGINT");
  const handleSigterm = () => shutdown("SIGTERM");
  const handleSighup = () => shutdown("SIGHUP");
  const removeSignalHandlers = () => {
    parentProcess.removeListener("SIGINT", handleSigint);
    parentProcess.removeListener("SIGTERM", handleSigterm);
    if (platform !== "win32") {
      parentProcess.removeListener("SIGHUP", handleSighup);
    }
  };
  parentProcess.on("SIGINT", handleSigint);
  parentProcess.on("SIGTERM", handleSigterm);
  if (platform !== "win32") parentProcess.on("SIGHUP", handleSighup);

  child.once("error", (error) => {
    cancelForceKill(forceKillTimer);
    removeSignalHandlers();
    console.error("Failed to start Electron Forge:", error);
    parentProcess.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    if (shutdownSignal) {
      // Forge exits promptly on SIGTERM, but Electron and app servers may not.
      // Keep the force-kill timer alive to finish the whole process group.
      return;
    }

    cancelForceKill(forceKillTimer);
    removeSignalHandlers();
    if (typeof code === "number") {
      parentProcess.exitCode = code;
    } else {
      console.error(
        `Electron Forge exited with ${signal ?? "an unknown signal"}`,
      );
      parentProcess.exitCode = 1;
    }
  });

  return child;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startDevelopmentSupervisor();
}
