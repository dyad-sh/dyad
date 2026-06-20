/**
 * Calculate the port for a given app based on its ID.
 * Uses a base port of 32100 and offsets by appId % 10_000.
 */
export function getAppPort(appId: number): number {
  return 32100 + (appId % 10_000);
}

/**
 * Base of the preview proxy port range. Stays clear of getAppPort's
 * 32100..42099 range.
 */
export const PROXY_PORT_BASE = 42100;
/** Width of the proxy port range, so proxy ports span 42100..52099. */
export const PROXY_PORT_RANGE = 10_000;

/**
 * Start of the fallback band used when an app's deterministic proxy port is
 * already taken (by a foreign service or, in the rare 10k-app overlap, another
 * Dyad app). It sits just above the proxy range so a fallback never collides
 * with another app's *reserved* proxy slot.
 */
export const PROXY_FALLBACK_PORT_START = PROXY_PORT_BASE + PROXY_PORT_RANGE;
/** How many consecutive fallback ports to scan before giving up. */
export const PROXY_FALLBACK_MAX_ATTEMPTS = 50;

/**
 * Deterministic per-app port for the preview proxy worker.
 * The iframe loads this URL, so it must stay stable across restarts —
 * otherwise the preview's origin changes and origin-scoped browser state
 * gets orphaned and the user appears logged out.
 *
 * This is the *preferred* port: if it is already in use, the proxy worker
 * scans the fallback band (PROXY_FALLBACK_PORT_START upward) rather than
 * killing whatever already holds the port.
 */
export function getAppProxyPort(appId: number): number {
  return PROXY_PORT_BASE + (Math.abs(appId) % PROXY_PORT_RANGE);
}
