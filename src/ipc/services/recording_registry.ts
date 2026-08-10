/**
 * In-flight recording sessions keyed by appId.
 *
 * Kept in its own dependency-free module so both `recording_handlers` and
 * `tests_handlers` can consult it for mutual exclusion (a recording session and
 * a test run must never run at once — both restart the dev server and share the
 * single per-app Neon test-branch slot) without an import cycle.
 */

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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
}

export const activeRecordings = new Map<number, ActiveRecording>();

/**
 * A start that has claimed this app but not yet published an `ActiveRecording`.
 *
 * `cancelled` is the main-owned tombstone the start re-reads after each of its
 * setup awaits — see `reserveRecordingStart`.
 */
export interface RecordingStartReservation {
  readonly cancelled: boolean;
  /** Retire the reservation. Idempotent. */
  release: () => void;
}

const startingRecordings = new Map<number, { cancelled: boolean }>();

/**
 * Atomically reserve this app's recording start before the handler's first
 * await. Test runs consult the same state through `isRecordingActive`, so they
 * refuse immediately instead of queueing behind a setup that has not published
 * its full ActiveRecording handle yet.
 *
 * The returned reservation also carries the cancellation tombstone: a start
 * still in this window owns no `stop`, so `endRecordingForApp` can't reach it
 * and instead marks it cancelled. The start has to check `cancelled` after
 * every await before it swaps the environment or publishes a session, or it
 * would relaunch an app the user has just stopped.
 */
export function reserveRecordingStart(
  appId: number,
): RecordingStartReservation | null {
  if (activeRecordings.has(appId) || startingRecordings.has(appId)) {
    return null;
  }
  const state = { cancelled: false };
  startingRecordings.set(appId, state);
  let released = false;
  return {
    get cancelled() {
      return state.cancelled;
    },
    release: () => {
      if (released) return;
      released = true;
      // Only our own reservation: a release that overlaps the next attempt's
      // reservation must not retire the newer one.
      if (startingRecordings.get(appId) === state) {
        startingRecordings.delete(appId);
      }
    },
  };
}

export function isRecordingActive(appId: number): boolean {
  return activeRecordings.has(appId) || startingRecordings.has(appId);
}

/**
 * Refuse an app operation that would otherwise queue behind a recording.
 *
 * A session holds write claims on repository, provider, runtime, runtime-config
 * and test-files for its whole lifetime, and the coordinator queues conflicting
 * work with no timeout — so anything taking one of those claims can sit on a
 * spinner for the rest of the 30-minute cap with nothing on screen saying why.
 * Paths that can't simply end the session (the recording is the thing the user
 * is doing) say so instead and let them decide.
 *
 * `action` names what was asked for, in the imperative, e.g. "duplicate this
 * app".
 */
export function assertNoActiveRecording(appId: number, action: string): void {
  if (!isRecordingActive(appId)) return;
  throw new DyadError(
    `Stop the recording session before you ${action} — it's holding this app while it records.`,
    DyadErrorKind.Precondition,
  );
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
  // A start that has reserved this app but not yet published its session is
  // invisible to `activeRecordings`, so without this the caller would be told
  // the app is free while that start went on to swap `.env.local` and restart
  // the dev server it was in the middle of stopping. The reservation is
  // main-owned state the start re-reads after each of its awaits; marking it is
  // what makes the late completion give up instead of relaunching the app.
  const starting = startingRecordings.get(appId);
  if (starting) starting.cancelled = true;

  const recording = activeRecordings.get(appId);
  // Nothing was ever swapped, so nothing needs restoring — a cancelled
  // reservation gives up before isolation setup.
  if (!recording) return { envRestored: true };
  recording.stop(reason, options);
  // A session that ended by throwing never reported on its own teardown, so
  // whether `.env.local` came back is unknown. The gate this feeds exists to
  // stop the app relaunching against isolated data, and "unknown" has to fail
  // the same way "no" does or the gate is decorative.
  return recording.done.catch(() => ({ envRestored: false }));
}
