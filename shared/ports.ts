/**
 * Calculate the port for a given app based on its ID.
 * Uses a base port of 32100 and offsets by appId % 10_000.
 */
export function getAppPort(appId: number): number {
  return 32100 + (appId % 10_000);
}

/**
 * Deterministic per-app port for the preview proxy worker.
 * The iframe loads this URL, so it must stay stable across restarts —
 * otherwise the preview's origin changes and origin-scoped browser state
 * gets orphaned and the user appears logged out.
 *
 * Uses a base of 42100 to stay clear of getAppPort's 32100..42099 range.
 */
export function getAppProxyPort(appId: number): number {
  return 42100 + (appId % 10_000);
}
