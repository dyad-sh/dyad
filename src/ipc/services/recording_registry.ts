/**
 * In-flight recording sessions keyed by appId.
 *
 * Kept in its own dependency-free module so both `recording_handlers` and
 * `tests_handlers` can consult it for mutual exclusion (a recording session and
 * a test run must never run at once — both restart the dev server and share the
 * single per-app Neon test-branch slot) without an import cycle.
 */

export type RecordingEndReason =
  | "stopped"
  | "app-stopped"
  | "error"
  | "timed-out";

/** What ending a session left behind. */
export interface RecordingEndSummary {
  /**
   * False when isolation teardown couldn't restore the app's `.env.local`, so
   * it is still pointed at the temporary test branch. A caller about to
   * relaunch the app has to refuse rather than start it on isolated data.
   */
  envRestored: boolean;
}

export interface ActiveRecording {
  appId: number;
  /** Ends the session (restores isolation, releases the lock). Idempotent. */
  stop: (reason: RecordingEndReason, options?: EndRecordingOptions) => void;
  /** Resolves once the session's full lifecycle (incl. teardown) has finished. */
  done: Promise<RecordingEndSummary>;
}

export interface EndRecordingOptions {
  /**
   * The caller will restart or stop the app itself, so teardown shouldn't also
   * restart the dev server. Without it a restart-during-recording restarts
   * twice: once putting the real `.env.local` back, once for the actual restart.
   */
  skipRestart?: boolean;
  /**
   * The app is being deleted, so isolation's cloud resources must go even if
   * the local environment couldn't be restored — the app row about to be
   * removed is the only place the temporary branch id is recorded.
   */
  discardEnvironment?: boolean;
}

export const activeRecordings = new Map<number, ActiveRecording>();

export function isRecordingActive(appId: number): boolean {
  return activeRecordings.has(appId);
}

/**
 * End this app's recording session, if it has one, and wait for its teardown.
 *
 * A session holds the app's lock for its entire lifetime, so anything that takes
 * that lock — stopping or restarting the app — would otherwise queue behind it
 * until the 30-minute session cap, with no sign of why. Callers about to take
 * the lock call this first: a recording exists to observe a running app, so the
 * app going away ends it.
 */
export async function endRecordingForApp(
  appId: number,
  reason: RecordingEndReason,
  options?: EndRecordingOptions,
): Promise<RecordingEndSummary> {
  const recording = activeRecordings.get(appId);
  // Nothing was ever swapped, so nothing needs restoring.
  if (!recording) return { envRestored: true };
  recording.stop(reason, options);
  // A session that ended by throwing never reported on its own teardown, so
  // whether `.env.local` came back is unknown. The gate this feeds exists to
  // stop the app relaunching against isolated data, and "unknown" has to fail
  // the same way "no" does or the gate is decorative.
  return recording.done.catch(() => ({ envRestored: false }));
}
