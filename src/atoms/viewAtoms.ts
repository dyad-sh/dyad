import { atom } from "jotai";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";

export const isPreviewOpenAtom = atom(true);
export const isChatPanelHiddenAtom = atom(false);
export const selectedFileAtom = atom<{
  path: string;
  line?: number | null;
} | null>(null);
export const activeSettingsSectionAtom = atom<string | null>(
  SECTION_IDS.general,
);
