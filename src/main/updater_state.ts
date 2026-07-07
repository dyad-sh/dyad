/**
 * Tracks the most recent auto-updater error so debug reports can include
 * the root cause even when it has scrolled out of the log tail.
 */

let lastUpdaterError: string | null = null;

export function recordUpdaterError(error: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  lastUpdaterError = `[${new Date().toISOString()}] ${detail}`;
}

export function getLastUpdaterError(): string | null {
  return lastUpdaterError;
}
