import type { ChildProcess } from "node:child_process";
import log from "electron-log";

import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";
import { forceKillProcessTree } from "@/ipc/utils/process_manager";

const logger = log.scope("e2e_test_process_registry");

/**
 * Every live run-scoped child, mapped to the run that owns it.
 *
 * The owner is the run's `AbortSignal` — the identity every one of these call
 * sites already carries, so nothing has to invent a parallel run id that could
 * drift out of step with the controller. `undefined` for a caller with no
 * signal: such a child is still terminated on quit, but no run's cleanup
 * barrier claims it.
 */
const runScopedProcesses = new Map<ChildProcess, AbortSignal | undefined>();

/**
 * Track a run-scoped child (the dependency install, the sandbox dev server, the
 * Playwright runner) so Electron's synchronous quit can terminate it, and so
 * the owning run can wait for it before deleting its workspace. Returns an
 * unregister callback; the child's own exit/error also drops it.
 */
export function trackE2eTestProcess(
  child: ChildProcess,
  owner?: AbortSignal,
): () => void {
  runScopedProcesses.set(child, owner);
  const forget = () => {
    runScopedProcesses.delete(child);
  };
  child.once("exit", forget);
  child.once("error", forget);
  return forget;
}

/**
 * Force-kill every child still tracked FOR ONE RUN and report whether all of
 * them are CONFIRMED gone.
 *
 * The map is self-pruning — `trackE2eTestProcess` drops a child on its own
 * `exit` — so whatever is still in it has not exited, which is exactly the
 * survivor set. That matters because `spawnStreaming` resolves as soon as it
 * has *sent* a kill on the Stop and timeout paths, without waiting for the
 * tree: the Playwright runner, its browser and an install's lifecycle
 * descendants can all still be reading and writing the workspace when the run
 * believes it is finished.
 *
 * Scoped to `owner`, never global. The operation coordinator excludes by app,
 * so two apps can be running tests at once — and a global sweep here would let
 * either one's cleanup SIGKILL the other's server and runner mid-run.
 * `stopE2eTestProcessesSync` keeps the global form, because quit really does
 * mean all of them.
 *
 * `rules/app-operation-coordination.md` requires the barrier before the caller
 * removes that workspace and releases its claim, so this returns a verdict
 * rather than a promise of best effort: false means "something may still be in
 * there", and the caller must fail closed.
 */
export async function settleE2eTestProcesses(
  owner: AbortSignal,
): Promise<boolean> {
  const survivors = Array.from(runScopedProcesses)
    .filter(([, processOwner]) => processOwner === owner)
    .map(([child]) => child);
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

/** The children one run still owns. Exposed for tests. */
export function trackedE2eTestProcessesForOwner(
  owner: AbortSignal,
): ChildProcess[] {
  return Array.from(runScopedProcesses)
    .filter(([, processOwner]) => processOwner === owner)
    .map(([child]) => child);
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
  const children = Array.from(runScopedProcesses.keys());
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
