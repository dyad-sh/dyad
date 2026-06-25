import { ComponentSelection, VisualEditingChange } from "@/ipc/types";
import type { RecordedAction } from "@/ipc/types/tests";
import { atom } from "jotai";

export const selectedComponentsPreviewAtom = atom<ComponentSelection[]>([]);

export const visualEditingSelectedComponentAtom =
  atom<ComponentSelection | null>(null);

export const currentComponentCoordinatesAtom = atom<{
  top: number;
  left: number;
  width: number;
  height: number;
} | null>(null);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);

export const annotatorModeAtom = atom<boolean>(false);

export const isRestoringQueuedSelectionAtom = atom<boolean>(false);

export const screenshotDataUrlAtom = atom<string | null>(null);
export const pendingVisualChangesAtom = atom<Map<string, VisualEditingChange>>(
  new Map(),
);

export const pendingScreenshotAppIdAtom = atom<number | null>(null);

// "Record a test" feature: whether the preview is currently capturing user
// actions, and the actions captured so far (in order). Cleared when a new
// recording starts; consumed when the user stops recording.
export const isRecordingAtom = atom<boolean>(false);
export const recordedActionsAtom = atom<RecordedAction[]>([]);
