/**
 * Calculate the port for a given app based on its ID.
 * Uses a base port of 32100 and offsets by appId % 10_000.
 */
export function getAppPort(appId: number): number {
  return 32100 + (appId % 10_000);
}
