import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { RecordingAuth, TestIsolation } from "@/ipc/types";
import type { RecordedEntry } from "@/lib/test_recorder/types";

/**
 * Phases the preview recorder moves through for a given app:
 * - "idle": not recording.
 * - "starting": recording:start in flight (isolation setup).
 * - "authenticating": establishing the pre-recording session in the iframe.
 * - "recording": capturing interactions.
 * - "saving": generating + writing the spec.
 */
export type RecordingPhase =
  | "idle"
  | "starting"
  | "authenticating"
  | "recording"
  | "saving";

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
  startedAt?: number;
}

export const EMPTY_RECORDING_STATE: RecordingState = Object.freeze({
  phase: "idle",
}) as RecordingState;

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

export const appendRecordedEntryAtom = atom(
  null,
  (_get, set, { appId, entry }: { appId: number; entry: RecordedEntry }) => {
    set(recordedEntriesByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(appId, [...(prev.get(appId) ?? []), entry]);
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
