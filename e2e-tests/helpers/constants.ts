/**
 * Timeout constants for e2e tests.
 * Values are adjusted for CI vs local environments.
 */
export const Timeout = {
  // Things generally take longer on CI, so we make them longer.
  EXTRA_LONG: process.env.CI ? 120_000 : 60_000,
  LONG: process.env.CI ? 60_000 : 30_000,
  MEDIUM: process.env.CI ? 30_000 : 15_000,
  SHORT: process.env.CI ? 5_000 : 2_000,
};

export const showDebugLogs = process.env.DEBUG_LOGS === "true";
