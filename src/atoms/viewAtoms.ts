import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";

export const isPreviewOpenAtom = atom(true);
export const isChatPanelHiddenAtom = atom(false);
export interface WorkspacePanelSizes {
  default: number;
  code: number;
}
export const workspacePanelSizesAtom = atomWithStorage<WorkspacePanelSizes>(
  "dyad-workspace-panel-sizes",
  { default: 50, code: 35 },
);
export const activeSettingsSectionAtom = atom<string | null>(
  SECTION_IDS.general,
);
