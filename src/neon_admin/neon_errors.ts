/**
 * Pure helpers for interpreting errors returned by the Neon management API.
 *
 * Kept dependency-free (no electron / settings imports) so the parsing logic
 * can be unit-tested in isolation and reused without pulling in the full
 * management client.
 */

export function getNeonErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : null;
  const detailedMessage =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
      ? error.response.data.message
      : null;

  if (message && detailedMessage) {
    return `${message} ${detailedMessage}`;
  }
  if (message) {
    return message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error == null) {
    return "Unknown Neon error";
  }

  try {
    const serializedError = JSON.stringify(error);
    return serializedError && serializedError !== "{}"
      ? serializedError
      : "Unknown Neon error";
  } catch {
    return String(error);
  }
}

/**
 * Returns true when the error is Neon's "timestamp is before retention window"
 * error. This happens when restoring a branch to a point in time that is older
 * than the project's history retention window (e.g. 6 hours on the free plan),
 * so the requested database snapshot can no longer be recovered.
 */
export function isRetentionWindowError(error: unknown): boolean {
  return getNeonErrorMessage(error).toLowerCase().includes("retention window");
}

/**
 * Extracts the retention window from a Neon retention-window error and formats
 * it for display (e.g. `6h0m0s` -> `6 hours`). Returns null when it can't be
 * parsed out of the error message.
 */
export function getRetentionWindowFromError(error: unknown): string | null {
  const match = getNeonErrorMessage(error).match(/retention_window:"([^"]+)"/);
  if (!match) {
    return null;
  }
  return formatGoDuration(match[1]) ?? match[1];
}

/**
 * Formats a Go-style duration string (e.g. `6h0m0s`) into human-readable text
 * (e.g. `6 hours`). Returns null if the input isn't a recognizable duration.
 */
function formatGoDuration(raw: string): string | null {
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) {
    return null;
  }
  const parts: string[] = [];
  const units: [string | undefined, string][] = [
    [match[1], "hour"],
    [match[2], "minute"],
    [match[3], "second"],
  ];
  for (const [value, unit] of units) {
    const amount = value ? parseInt(value, 10) : 0;
    if (amount > 0) {
      parts.push(`${amount} ${unit}${amount === 1 ? "" : "s"}`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
