import { ComponentSelection, VisualEditingChange } from "@/ipc/types";
import type { ScreenshotCaptureSource } from "@/screenshot/state";
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

export const screenshotDataUrlAtom = atom<string | null>(null);
export const pendingVisualChangesAtom = atom<Map<string, VisualEditingChange>>(
  new Map(),
);

// Producer-facing screenshot request inbox. The screenshot provider consumes
// entries into per-app machines and clears them immediately.
export const pendingScreenshotAppIdsAtom = atom<
  Map<number, ScreenshotCaptureSource>
>(new Map());
