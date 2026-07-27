import { spawnSync } from "node:child_process";

interface ProcessRow {
  pid: number;
  parentPid: number;
}

interface ProcessTreeSyncDependencies {
  spawnSync: typeof spawnSync;
  kill(pid: number, signal: NodeJS.Signals): boolean;
}

const processTreeSyncDependencies: ProcessTreeSyncDependencies = {
  spawnSync,
  kill: (pid, signal) => process.kill(pid, signal),
};

export function collectDescendantPids(
  rootPid: number,
  rows: readonly ProcessRow[],
): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentPid) ?? [];
    siblings.push(row.pid);
    children.set(row.parentPid, siblings);
  }

  const descendants: number[] = [];
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
}

/**
 * Best-effort synchronous process-tree termination for Electron's `will-quit`
 * event, whose async callbacks are not awaited.
 */
export function killProcessTreeSync(
  rootPid: number,
  platform: NodeJS.Platform = process.platform,
  dependencies: ProcessTreeSyncDependencies = processTreeSyncDependencies,
): boolean {
  if (platform === "win32") {
    const result = dependencies.spawnSync(
      "taskkill.exe",
      ["/pid", String(rootPid), "/t", "/f"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return result.error === undefined && result.status === 0;
  }

  const listing = dependencies.spawnSync("ps", ["-A", "-o", "pid=,ppid="], {
    encoding: "utf8",
  });
  let succeeded = listing.error === undefined && listing.status === 0;
  const rows = succeeded
    ? (listing.stdout ?? "")
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(
          (parts): parts is [number, number] =>
            parts.length === 2 && parts.every(Number.isSafeInteger),
        )
        .map(([pid, parentPid]) => ({ pid, parentPid }))
    : [];

  for (const pid of [...collectDescendantPids(rootPid, rows), rootPid]) {
    try {
      dependencies.kill(pid, "SIGTERM");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      ) {
        succeeded = false;
      }
    }
  }
  return succeeded;
}
