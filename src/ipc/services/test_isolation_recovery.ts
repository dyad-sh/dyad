/**
 * Apps whose isolation teardown could not restore `.env.local` and may still
 * point at a temporary test database.
 *
 * The durable recovery marker is the app row's `neonTestBranchId`; this set is
 * the in-process relaunch gate shared by recordings, test runs, and app
 * lifecycle handlers. Keeping it outside any one handler prevents an ordinary
 * recorder-bar stop from becoming invisible to a later Run or Restart.
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
