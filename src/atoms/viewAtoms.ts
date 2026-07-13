import { atom } from "jotai";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";

export const isPreviewOpenAtom = atom(true);
export const isChatPanelHiddenAtom = atom(false);
export const selectedFileAtom = atom<{
  path: string;
  line?: number | null;
} | null>(null);
// When set, the code view shows the working-tree diff (vs HEAD) for this
// staged file instead of the file tree + editor. Cleared to return to editing.
export const stagedDiffFileAtom = atom<string | null>(null);
export const activeSettingsSectionAtom = atom<string | null>(
  SECTION_IDS.general,
);
