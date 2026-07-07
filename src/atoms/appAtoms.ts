import { atom } from "jotai";

export const selectedAppIdAtom = atom<number | null>(null);
export type PreviewMode =
  | "preview"
  | "code"
  | "problems"
  | "configure"
  | "publish"
  | "security"
  | "tests"
  | "plan";

export const previewModeAtom = atom<PreviewMode>("preview");
export const selectedVersionIdAtom = atom<string | null>(null);
// The file path the version diff view should open at. Set when navigating to a
// specific changed file (e.g. from the modified-files card); null falls back to
// the first changed file in the version.
export const selectedVersionDiffFileAtom = atom<string | null>(null);
