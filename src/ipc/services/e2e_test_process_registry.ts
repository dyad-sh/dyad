import type { ChildProcess } from "node:child_process";
import log from "electron-log";

import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";
import { forceKillProcessTree } from "@/ipc/utils/process_manager";

const logger = log.scope("e2e_test_process_registry");

/**
 * Every unsettled run-scoped process tree, mapped to the run that owns it.
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
 * unregister callback for callers that independently confirm settlement.
 * `close` also unregisters once the root and its shared stdio have closed;
 * `exit` alone cannot prove descendants sharing those pipes have stopped.
 */
export function trackE2eTestProcess(
  child: ChildProcess,
  owner?: AbortSignal,
): () => void {
  runScopedProcesses.set(child, owner);
  const forget = () => {
    runScopedProcesses.delete(child);
    child.removeListener("close", forget);
    child.removeListener("error", onError);
  };
  const onError = () => {
    // A spawn failure has no tree to settle. Errors on an existing process
    // (for example, a failed kill) do not prove that its tree is gone.
    if (child.pid === undefined) forget();
  };
  child.once("close", forget);
  child.on("error", onError);
  return forget;
}

/**
 * Force-kill every child still tracked FOR ONE RUN and report whether all of
 * them are CONFIRMED gone.
 *
 * An exited root stays registered until `close` or an explicit confirmation of
 * settlement. On Stop and timeout, `spawnStreaming`'s forced-kill timer can
 * resolve after sending SIGKILL without waiting for the tree. The Playwright
 * runner, its browser and an install's lifecycle descendants can still be
 * using the workspace, even when their wrapper has already exited.
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
    survivors.map(async (child) => {
      const confirmed = await forceKillProcessTree(child).catch((error) => {
        logger.warn(`Failed to settle an E2E test process tree: ${error}`);
        return false;
      });
      // Preserve unconfirmed trees so a later barrier cannot mistake an
      // earlier failed settlement for an empty, safe-to-delete workspace.
      if (confirmed) runScopedProcesses.delete(child);
      return confirmed;
    }),
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
