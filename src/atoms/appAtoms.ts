import { atom } from "jotai";

export const selectedAppIdAtom = atom<number | null>(null);
export type PreviewMode =
  | "preview"
  | "code"
  | "problems"
  | "configure"
  | "publish"
  | "security"
  | "plan"
  | "design";

export const previewModeAtom = atom<PreviewMode>("preview");
export const selectedVersionIdAtom = atom<string | null>(null);
