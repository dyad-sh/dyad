import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { RecordingAuth, TestIsolation } from "@/ipc/types";
import type { RecordedTestDraft } from "@/lib/test_recorder/draft";
import type { RecordedEntry } from "@/lib/test_recorder/types";

/**
 * Phases the preview recorder moves through for a given app:
 * - "idle": not recording.
 * - "starting": recording:start in flight (isolation setup).
 * - "authenticating": establishing the pre-recording session in the iframe.
 * - "recording": capturing interactions.
 * - "finishing": closing the session; waiting on isolation teardown.
 * - "reviewing": recording captured as a draft — the steps are listed and the
 *   assertion pass is offered. NOTHING has been written to disk yet.
 * - "saving": generating the spec from the draft (the no-assertions path).
 * - "saved": spec written; offering to open it until dismissed.
 * - "stopping": discarding the session; waiting on isolation teardown.
 */
export type RecordingPhase =
  | "idle"
  | "starting"
  | "authenticating"
  | "recording"
  | "finishing"
  | "reviewing"
  | "saving"
  | "saved"
  | "stopping";

export interface RecordingState {
  phase: RecordingPhase;
  /** How the recording session's database is isolated (drives the badge). */
  isolation?: TestIsolation;
  /** Auth to establish before recording. */
  auth?: RecordingAuth;
  /** Non-fatal notice (e.g. RLS warning, unauthenticated fallback). */
  warning?: string;
  /** Latest setup-progress line (isolation setup, sign-in). */
  progress?: string;
  /** Fatal setup error (recording didn't start). */
  error?: string;
  /** The captured recording, while phase is "reviewing" (or being saved). */
  draft?: RecordedTestDraft;
  /**
   * The assertion pass is with the agent and we're waiting for its card. The
   * review stays up meanwhile: the request can fail, be cancelled, or never
   * reach the tool, and the draft has no other recovery UI.
   */
  awaitingAssertions?: boolean;
  /** Path of the just-written spec, while phase is "saved". */
  savedSpecPath?: string;
  startedAt?: number;
}

export const EMPTY_RECORDING_STATE: RecordingState = Object.freeze({
  phase: "idle",
}) as RecordingState;

/**
 * A "start recording" ask from outside the preview (the Tests panel). The
 * recorder only lives while the preview is mounted, so the entry point leaves
 * this behind for `useTestRecorder` to pick up. `requestedAt` keeps a request
 * that was never consumed from silently starting a session minutes later.
 */
export interface RecordingStartRequest {
  appId: number;
  requestedAt: number;
}

export const RECORDING_REQUEST_TTL_MS = 15_000;

export const recordingStartRequestAtom = atom<RecordingStartRequest | null>(
  null,
);

export const recordingStateByAppIdAtom = atom<Map<number, RecordingState>>(
  new Map(),
);
export const recordedEntriesByAppIdAtom = atom<Map<number, RecordedEntry[]>>(
  new Map(),
);

export const currentRecordingStateAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? EMPTY_RECORDING_STATE
    : (get(recordingStateByAppIdAtom).get(appId) ?? EMPTY_RECORDING_STATE);
});

export const currentRecordedEntriesAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? []
    : (get(recordedEntriesByAppIdAtom).get(appId) ?? []);
});

export const setRecordingStateForAppAtom = atom(
  null,
  (
    _get,
    set,
    {
      appId,
      update,
    }: {
      appId: number;
      update: RecordingState | ((prev: RecordingState) => RecordingState);
    },
  ) => {
    set(recordingStateByAppIdAtom, (prev) => {
      const current = prev.get(appId) ?? EMPTY_RECORDING_STATE;
      const nextState = typeof update === "function" ? update(current) : update;
      if (nextState === current) return prev;
      const next = new Map(prev);
      next.set(appId, nextState);
      return next;
    });
  },
);

/**
 * Ceiling on the actions one recording may buffer. Entries arrive from the
 * previewed app over postMessage, so an app in a render loop could otherwise grow
 * this without bound. Far above any hand-performed flow.
 */
export const MAX_RECORDED_ENTRIES = 5_000;

export const appendRecordedEntryAtom = atom(
  null,
  (_get, set, { appId, entry }: { appId: number; entry: RecordedEntry }) => {
    set(recordedEntriesByAppIdAtom, (prev) => {
      const current = prev.get(appId) ?? [];
      if (current.length >= MAX_RECORDED_ENTRIES) return prev;
      const next = new Map(prev);
      next.set(appId, [...current, entry]);
      return next;
    });
  },
);

export const clearRecordedEntriesForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(recordedEntriesByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);

export const clearRecorderForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(recordingStateByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(recordedEntriesByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);
