import type { ChildProcess } from "node:child_process";
import log from "electron-log";

import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";
import { forceKillProcessTree } from "@/ipc/utils/process_manager";

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

/**
 * Force-kill every child still tracked and report whether all of them are
 * CONFIRMED gone.
 *
 * The set is self-pruning — `trackE2eTestProcess` drops a child on its own
 * `exit` — so whatever is still in it has not exited, which is exactly the
 * survivor set. That matters because `spawnStreaming` resolves as soon as it
 * has *sent* a kill on the Stop and timeout paths, without waiting for the
 * tree: the Playwright runner, its browser and an install's lifecycle
 * descendants can all still be reading and writing the workspace when the run
 * believes it is finished.
 *
 * `rules/app-operation-coordination.md` requires the barrier before the caller
 * removes that workspace and releases its claim, so this returns a verdict
 * rather than a promise of best effort: false means "something may still be in
 * there", and the caller must fail closed.
 */
export async function settleE2eTestProcesses(): Promise<boolean> {
  const survivors = Array.from(runScopedProcesses);
  if (survivors.length === 0) return true;
  logger.info(
    `Waiting for ${survivors.length} E2E test process tree(s) to settle before cleanup`,
  );
  const settled = await Promise.all(
    survivors.map((child) =>
      forceKillProcessTree(child).catch((error) => {
        logger.warn(`Failed to settle an E2E test process tree: ${error}`);
        return false;
      }),
    ),
  );
  return settled.every(Boolean);
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
