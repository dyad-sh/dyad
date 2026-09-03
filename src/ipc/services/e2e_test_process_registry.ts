import type { ChildProcess } from "node:child_process";
import log from "electron-log";

import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";

const logger = log.scope("e2e_test_process_registry");

const runScopedProcesses = new Set<ChildProcess>();

/**
 * Track a run-scoped child (the sandbox dev server, the Playwright runner) so
 * Electron's synchronous quit can terminate it. Returns an unregister callback;
 * the child's own exit/error also drops it.
 */
export function trackE2eTestProcess(child: ChildProcess): () => void {
  runScopedProcesses.add(child);
  const forget = () => {
    runScopedProcesses.delete(child);
  };
  child.once("exit", forget);
  child.once("error", forget);
  return forget;
}

/** Number of tracked children. Exposed for tests. */
export function trackedE2eTestProcessCount(): number {
  return runScopedProcesses.size;
}

/**
 * Tree-kill every tracked child synchronously.
 *
 * Aborting the run controllers is not enough on quit: their abort path goes
 * through `killProcess`/`tree-kill`, which spawns a helper and completes
 * asynchronously, and Electron's `will-quit` does not await async work. A
 * surviving sandbox server keeps holding its port and its cwd inside
 * `<userData>/test-sandboxes`, which then makes the next launch's orphan sweep
 * fail on Windows. `stopAllAppsSync` uses `killProcessTreeSync` for the same
 * reason.
 */
export function stopE2eTestProcessesSync(): void {
  const children = Array.from(runScopedProcesses);
  runScopedProcesses.clear();
  if (children.length === 0) return;
  logger.info(
    `Synchronously stopping ${children.length} E2E test process(es) on quit`,
  );
  for (const child of children) {
    const pid = child.pid;
    if (pid === undefined) continue;
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (!killProcessTreeSync(pid)) {
      logger.warn(
        `Failed to synchronously terminate E2E test process (PID ${pid}) during quit`,
      );
    }
  }
}
