/**
 * Calculate the port for a given app based on its ID.
 * Uses a base port of 32100 and offsets by appId % 10_000.
 */
const APP_PORT_BASE = 32100;
const APP_PORT_RANGE = 10_000;

const E2E_PORT_BLOCK_SIZE = 2_050;
const E2E_APP_PORT_RANGE = 1_000;
const E2E_PROXY_PORT_RANGE = 1_000;

function getE2ePortBlockBase(): number | null {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env.DYAD_E2E_PORT_BLOCK_INDEX;
  if (raw == null || raw.trim() === "") {
    return null;
  }

  const index = Number.parseInt(raw, 10);
  if (!Number.isFinite(index) || index < 0) {
    return null;
  }

  return APP_PORT_BASE + index * E2E_PORT_BLOCK_SIZE;
}

export function getAppPort(appId: number): number {
  const e2ePortBlockBase = getE2ePortBlockBase();
  if (e2ePortBlockBase != null) {
    return e2ePortBlockBase + (Math.abs(appId) % E2E_APP_PORT_RANGE);
  }

  return APP_PORT_BASE + (appId % APP_PORT_RANGE);
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
 * Start of the band reserved for run-scoped E2E test servers. It sits directly
 * above the proxy fallback band so a sandbox server never squats on the
 * deterministic app or proxy port of some *other* app that merely happens to be
 * stopped right now — which would make that app fail to start later, with
 * nothing to point at as the cause. An OS-assigned ephemeral port cannot give
 * that guarantee: on Linux the ephemeral range (32768–60999) covers almost all
 * of the reserved bands below.
 */
export const E2E_TEST_SERVER_PORT_START =
  PROXY_FALLBACK_PORT_START + PROXY_FALLBACK_MAX_ATTEMPTS;
/** Width of the E2E test-server band, so it spans 52150..52349. */
export const E2E_TEST_SERVER_PORT_RANGE = 200;

/**
 * Whether a port falls in a band Dyad hands out deterministically, and so must
 * not be taken by anything that only needs *some* free port.
 */
export function isReservedDyadPort(port: number): boolean {
  const e2ePortBlockBase = getE2ePortBlockBase();
  if (
    e2ePortBlockBase != null &&
    port >= e2ePortBlockBase &&
    port < e2ePortBlockBase + E2E_PORT_BLOCK_SIZE
  ) {
    return true;
  }
  return (
    (port >= APP_PORT_BASE && port < APP_PORT_BASE + APP_PORT_RANGE) ||
    (port >= PROXY_PORT_BASE && port < PROXY_PORT_BASE + PROXY_PORT_RANGE) ||
    (port >= PROXY_FALLBACK_PORT_START &&
      port < PROXY_FALLBACK_PORT_START + PROXY_FALLBACK_MAX_ATTEMPTS)
  );
}

export function getProxyFallbackPortStart(): number {
  const e2ePortBlockBase = getE2ePortBlockBase();
  if (e2ePortBlockBase != null) {
    return e2ePortBlockBase + E2E_APP_PORT_RANGE + E2E_PROXY_PORT_RANGE;
  }

  return PROXY_FALLBACK_PORT_START;
}

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
  const e2ePortBlockBase = getE2ePortBlockBase();
  if (e2ePortBlockBase != null) {
    return (
      e2ePortBlockBase +
      E2E_APP_PORT_RANGE +
      (Math.abs(appId) % E2E_PROXY_PORT_RANGE)
    );
  }

  return PROXY_PORT_BASE + (Math.abs(appId) % PROXY_PORT_RANGE);
}
