import { atom } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "./appAtoms";
import { isPreviewOpenAtom, stagedDiffFileAtom } from "./viewAtoms";

export type CommitDialogSource = "editor" | "banner";

/**
 * Which commit dialog is showing, if any. This is global rather than component
 * state because the dialog is no longer owned by one subtree: clicking a file
 * closes it and opens that file's staged diff, and the code view's "back to
 * editor" control is what brings it back.
 */
export const openCommitDialogAtom = atom<CommitDialogSource | null>(null);

/**
 * The dialog to reopen when the user leaves the staged diff, set when the diff
 * was opened from a dialog. Deliberately not exported: only the actions below
 * may write it, so no caller can leave a stale return target behind.
 */
const commitDialogReturnAtom = atom<CommitDialogSource | null>(null);

/**
 * Commit messages the user typed, keyed by app so a draft neither leaks into
 * another app nor is lost when switching back. Auto-generated defaults are
 * never stored here, so a message the user did not write cannot go stale as
 * more files change.
 */
export const commitMessageDraftsByAppIdAtom = atom<Map<number, string>>(
  new Map(),
);

/**
 * The selected app's commit message draft, or null when the user has not typed
 * one. Writing null discards it.
 */
export const commitMessageDraftAtom = atom(
  (get) => {
    const appId = get(selectedAppIdAtom);
    if (appId === null) return null;
    return get(commitMessageDraftsByAppIdAtom).get(appId) ?? null;
  },
  (get, set, message: string | null) => {
    const appId = get(selectedAppIdAtom);
    // A no-op before an app is selected, matching chatInputValueAtom: every
    // caller is a commit dialog, which only renders for a selected app.
    if (appId === null) return;
    const next = new Map(get(commitMessageDraftsByAppIdAtom));
    if (message === null) {
      next.delete(appId);
    } else {
      next.set(appId, message);
    }
    set(commitMessageDraftsByAppIdAtom, next);
  },
);

/**
 * Opens a staged file's working-tree diff in the code view. `returnTo` names
 * the dialog to reopen when the user leaves the diff, and is null for entry
 * points with no dialog to come back to (the commit menu's dropdown).
 *
 * Forcing the code panel open mirrors ModifiedFilesCard's openDiff: it is a
 * no-op for the commit menu, which already lives in the code view, and is what
 * lets the chat header's banner reach the diff at all.
 */
export const openStagedDiffAtom = atom(
  null,
  (
    _get,
    set,
    { path, returnTo }: { path: string; returnTo: CommitDialogSource | null },
  ) => {
    set(openCommitDialogAtom, null);
    set(commitDialogReturnAtom, returnTo);
    set(stagedDiffFileAtom, path);
    set(previewModeAtom, "code");
    set(isPreviewOpenAtom, true);
  },
);

/**
 * Leaves the staged diff and reopens the dialog that sent the user there, if
 * any. Use this for the deliberate "back to editor" exit.
 */
export const exitStagedDiffAtom = atom(null, (get, set) => {
  set(stagedDiffFileAtom, null);
  set(openCommitDialogAtom, get(commitDialogReturnAtom));
  set(commitDialogReturnAtom, null);
});

/**
 * Leaves the staged diff without reopening anything. Use this wherever the
 * diff is cleared as a side effect of going somewhere else - committing,
 * opening a file in the editor - so a pending return target cannot pop a
 * dialog open on top of the destination.
 */
export const clearStagedDiffAtom = atom(null, (_get, set) => {
  set(stagedDiffFileAtom, null);
  set(commitDialogReturnAtom, null);
});

/**
 * Drops the open dialog and any pending return without touching the staged
 * diff. For callers that replace the displayed presentation wholesale (chat tab
 * switches), where a dialog belonging to the previous tab must not survive.
 */
export const resetCommitDialogAtom = atom(null, (_get, set) => {
  set(openCommitDialogAtom, null);
  set(commitDialogReturnAtom, null);
});
