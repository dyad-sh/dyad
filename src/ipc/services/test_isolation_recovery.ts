/**
 * Apps whose isolation teardown could not restore `.env.local` and may still
 * point at a temporary test database.
 *
 * The durable recovery marker is the app row's `neonTestBranchId`; relaunch
 * handlers always consult that row so a process restart cannot forget the
 * failure. This set carries the same fact immediately across recordings, test
 * runs, and lifecycle handlers in the current process and is also useful for
 * diagnostics/tests.
 */
const appsPointedAtTestBranch = new Set<number>();

export function markAppPointedAtTestBranch(appId: number): void {
  appsPointedAtTestBranch.add(appId);
}

export function clearAppPointedAtTestBranch(appId: number): void {
  appsPointedAtTestBranch.delete(appId);
}

export function isAppPointedAtTestBranch(appId: number): boolean {
  return appsPointedAtTestBranch.has(appId);
}

/** Module state outlives a handler harness, so tests reset it explicitly. */
export function resetTestIsolationRecovery(): void {
  appsPointedAtTestBranch.clear();
}
