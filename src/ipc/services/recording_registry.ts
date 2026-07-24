/**
 * In-flight recording sessions keyed by appId.
 *
 * Kept in its own dependency-free module so both `recording_handlers` and
 * `tests_handlers` can consult it for mutual exclusion (a recording session and
 * a test run must never run at once — both restart the dev server and share the
 * single per-app Neon test-branch slot) without an import cycle.
 */

export type RecordingEndReason = "stopped" | "app-stopped" | "error";

export interface ActiveRecording {
  appId: number;
  /** Ends the session (restores isolation, releases the lock). Idempotent. */
  stop: (reason: RecordingEndReason) => void;
  /** Resolves once the session's full lifecycle (incl. teardown) has finished. */
  done: Promise<void>;
}

export const activeRecordings = new Map<number, ActiveRecording>();

export function isRecordingActive(appId: number): boolean {
  return activeRecordings.has(appId);
}
