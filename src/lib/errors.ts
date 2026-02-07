/**
 * Extracts a user-friendly error message from an Error object.
 *
 * Electron IPC errors are wrapped as:
 *   "Error invoking remote method '<channel>': Error: <actual message>"
 *
 * This strips the IPC wrapper and returns just the meaningful message.
 */
export function getErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  return raw.replace(/^Error invoking remote method '.*?':\s*Error:\s*/, "");
}
