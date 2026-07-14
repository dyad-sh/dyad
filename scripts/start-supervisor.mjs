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
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean);
}

export function findMacElectronPids({ processGroupId, runSync = spawnSync }) {
  return readProcessTable(runSync)
    .filter(
      (match) =>
        Number(match[2]) === processGroupId &&
        match[3].startsWith(`${electronExecutable} `),
    )
    .map((match) => Number(match[1]));
}

export function findMacCrashpadPids({ runSync = spawnSync } = {}) {
  return readProcessTable(runSync)
    .filter((match) => match[3].startsWith(`${crashpadExecutable} `))
    .map((match) => Number(match[1]));
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

    signalDevelopmentTree({ pid: child.pid, signal: "SIGTERM", platform });
    signalDetachedProcesses({ pids: detachedPids, signal: "SIGTERM" });
    forceKillTimer = setTimeout(() => {
      signalDevelopmentTree({ pid: child.pid, signal: "SIGKILL", platform });
      signalDetachedProcesses({ pids: detachedPids, signal: "SIGKILL" });
      parentProcess.exitCode = exitStatus;
    }, forceKillAfterMs);
  };

  const handleSigint = () => shutdown("SIGINT");
  const handleSigterm = () => shutdown("SIGTERM");
  const handleSighup = () => shutdown("SIGHUP");
  parentProcess.on("SIGINT", handleSigint);
  parentProcess.on("SIGTERM", handleSigterm);
  if (platform !== "win32") parentProcess.on("SIGHUP", handleSighup);

  child.once("error", (error) => {
    clearTimeout(forceKillTimer);
    console.error("Failed to start Electron Forge:", error);
    parentProcess.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    parentProcess.removeListener("SIGINT", handleSigint);
    parentProcess.removeListener("SIGTERM", handleSigterm);
    parentProcess.removeListener("SIGHUP", handleSighup);

    if (shutdownSignal) {
      // Forge exits promptly on SIGTERM, but Electron and app servers may not.
      // Keep the force-kill timer alive to finish the whole process group.
      return;
    }

    clearTimeout(forceKillTimer);
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
