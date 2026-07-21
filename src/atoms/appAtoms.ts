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
// Presentation-only: which version's diff CodeView displays. Repository
// preview state (checkouts, return branch, recovery) is owned by the version
// preview machine in src/version_preview/ and must never be inferred from
// this atom. See plans/version-preview-state-machine.md.
export const selectedVersionIdAtom = atom<string | null>(null);
// The changed file the version diff view should open at, scoped to the version
// it belongs to. Set when navigating to a specific file (e.g. from the
// modified-files card). The diff view only honors `path` when `versionId`
// matches the version it is showing, so a selection made for one version never
// leaks into another that happens to contain a file with the same path; null
// (or a mismatched version) falls back to the first changed file.
export interface SelectedVersionDiffFile {
  versionId: string;
  path: string;
}
export const selectedVersionDiffFileAtom = atom<SelectedVersionDiffFile | null>(
  null,
);
export const selectedVersionReturnBranchAtom = atom<string | null>(null);
