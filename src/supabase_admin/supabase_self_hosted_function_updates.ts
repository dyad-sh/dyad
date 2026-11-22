/**
 * Updated edge functions on self-hosted instances that may still be answering
 * with their previous code.
 *
 * The edge runtime keeps a function's worker running until it ends on its own,
 * at the latest after the router's worker lifetime, and only a new worker
 * loads the new files. So an update is guaranteed to be live by the deploy
 * time plus that lifetime, and often sooner. Kept in memory: after a restart
 * of Dyad the deadlines have usually passed anyway.
 */

export interface PendingSupabaseFunctionUpdate {
  functionName: string;
  /** When every worker that could run the previous code has ended. */
  liveByMs: number;
}

/** projectId -> functionName -> live-by time. */
const pendingUpdates = new Map<string, Map<string, number>>();
/** projectId -> functionName -> latest time a worker may still be running. */
const deletedWorkers = new Map<string, Map<string, number>>();

function entriesFor(
  store: Map<string, Map<string, number>>,
  projectId: string,
): Map<string, number> {
  let entries = store.get(projectId);
  if (!entries) {
    entries = new Map();
    store.set(projectId, entries);
  }
  return entries;
}

/**
 * Records a deploy. A function that did not exist is live at once, unless it
 * was deleted recently: the router reuses a worker by the function's path,
 * so a worker of the deleted function can still answer for the recreated one.
 */
export function recordSupabaseSelfHostedFunctionDeploy({
  projectId,
  functionName,
  replacedExisting,
  workerLifetimeMs,
  nowMs = Date.now(),
}: {
  projectId: string;
  functionName: string;
  replacedExisting: boolean;
  workerLifetimeMs: number;
  nowMs?: number;
}): void {
  const deletedUntil = deletedWorkers.get(projectId)?.get(functionName);
  deletedWorkers.get(projectId)?.delete(functionName);
  const liveByMs = replacedExisting
    ? nowMs + workerLifetimeMs
    : deletedUntil !== undefined && deletedUntil > nowMs
      ? deletedUntil
      : undefined;
  const pending = entriesFor(pendingUpdates, projectId);
  if (liveByMs === undefined) pending.delete(functionName);
  else pending.set(functionName, liveByMs);
}

export function recordSupabaseSelfHostedFunctionDelete({
  projectId,
  functionName,
  workerLifetimeMs,
  nowMs = Date.now(),
}: {
  projectId: string;
  functionName: string;
  workerLifetimeMs: number;
  nowMs?: number;
}): void {
  pendingUpdates.get(projectId)?.delete(functionName);
  entriesFor(deletedWorkers, projectId).set(
    functionName,
    nowMs + workerLifetimeMs,
  );
}

/** Updates not yet guaranteed live, soonest first. */
export function listPendingSupabaseSelfHostedFunctionUpdates(
  projectId: string,
  nowMs = Date.now(),
): PendingSupabaseFunctionUpdate[] {
  const pending = pendingUpdates.get(projectId);
  if (!pending) return [];
  const updates: PendingSupabaseFunctionUpdate[] = [];
  for (const [functionName, liveByMs] of pending) {
    if (liveByMs <= nowMs) pending.delete(functionName);
    else updates.push({ functionName, liveByMs });
  }
  return updates.sort(
    (a, b) =>
      a.liveByMs - b.liveByMs || a.functionName.localeCompare(b.functionName),
  );
}

/** Test seam. */
export function resetSupabaseSelfHostedFunctionUpdates(): void {
  pendingUpdates.clear();
  deletedWorkers.clear();
}
