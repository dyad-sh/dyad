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

// Edit-in-diff state. The diff toolbar (CodeView) toggles edit mode and requests
// saves, while the editable Monaco model lives two levels down in FileDiffEditor;
// these atoms bridge that gap (dirty/saving state flows up, save request flows
// down) without prop-drilling a ref through the diff view components.
//
// RESET CONTRACT — because these are global (module-level) atoms, they are NOT
// scoped to a single diff and every consumer must cooperate to keep them from
// leaking across diffs. Whenever the active diff changes (file switch, version
// switch, or toggling edit mode off) or a participant unmounts, edit mode,
// dirty, and saving MUST be reset to their defaults and the FileDiffEditor
// remounted (via a `key` change) so no stale editor state survives. The
// participants that must honor this today:
//   - CodeView: resets on the pencil toggle and on unmount (the toolbar owner).
//   - StagedDiffView / VersionDiffView: reset on file/version switch and remount
//     FileDiffEditor via `key`.
//   - FileDiffEditor: guards writes behind `isMountedRef` so a save resolving
//     after a switch can't clobber the next diff's state.
// If you add a new diff surface or another atom here, wire it into every reset
// site above — a missed reset only surfaces at runtime as edits/dirty state
// bleeding into an unrelated diff.
export const diffEditModeAtom = atom(false);
export const diffDirtyAtom = atom(false);
export const diffSavingAtom = atom(false);
// False when the active diff is display-only (for example binary/oversized
// version-diff placeholders that must never be saved as file content).
export const diffContentEditableAtom = atom(true);
// Incrementing this counter requests a save from the active FileDiffEditor. Bumped
// by the toolbar Save button and by the editor's own Ctrl/Cmd+S command.
export const diffSaveRequestAtom = atom(0);
export const activeSettingsSectionAtom = atom<string | null>(
  SECTION_IDS.general,
);
