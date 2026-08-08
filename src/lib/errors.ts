/**
 * Extracts a user-friendly error message from an Error object.
 *
 * Electron IPC errors are wrapped as:
 *   "Error invoking remote method '<channel>': Error: <actual message>"
 *
 * This strips the IPC wrapper and returns just the meaningful message.
 */
export function getErrorMessage(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === "string") {
    raw = error;
  } else if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      raw = maybeMessage;
    } else {
      try {
        raw = JSON.stringify(error);
      } catch {
        raw = String(error);
      }
    }
  } else {
    raw = String(error ?? "Unknown error");
  }

  return raw.replace(/^Error invoking remote method '.*?':\s*Error:\s*/, "");
}
