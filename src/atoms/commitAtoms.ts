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
 *
 * Both dialogs share one entry per app on purpose: they are two entrances to
 * the same commit of the same working tree, so a message typed in one is the
 * message for the other. Staleness is bounded by lifetime instead: a draft only
 * survives while its dialog is open or while a diff opened from that dialog is
 * showing. Every way out of that round trip - committing, discarding,
 * dismissing, or leaving the diff for anywhere other than the dialog - drops
 * it, so it cannot outlive the change set it was written for.
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
 * Discards one app's draft by id rather than by whatever app is selected now.
 * Commit and discard handlers use this so a mutation that resolves after the
 * user moved on cannot wipe a draft they have since typed for another app.
 */
export const discardCommitMessageDraftAtom = atom(
  null,
  (get, set, appId: number) => {
    const drafts = get(commitMessageDraftsByAppIdAtom);
    if (!drafts.has(appId)) return;
    const next = new Map(drafts);
    next.delete(appId);
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
 *
 * This is the end of the round trip, not a pause in it: with the return target
 * gone there is no way back to the dialog, so the draft written in it goes too
 * rather than lying in wait to prefill an unrelated commit later.
 */
export const clearStagedDiffAtom = atom(null, (_get, set) => {
  set(stagedDiffFileAtom, null);
  set(commitDialogReturnAtom, null);
  set(commitMessageDraftAtom, null);
});

/**
 * Hands back the dialog state owned by one source, leaving the other source's
 * alone. A dialog is only visible while its owner is mounted, and the owner of
 * a pending return has to still be there to be returned to, so a source that
 * cannot render must drop both - otherwise the dialog pops open unprompted on
 * the next remount, and the staged diff's back control resolves to a dialog
 * nobody renders.
 *
 * Only the banner needs this: it is mounted conditionally by ChatHeader and
 * renders nothing without uncommitted files, whereas the editor dialog and the
 * back control that reopens it both live inside CodeView, so they come and go
 * together.
 */
export const releaseCommitDialogAtom = atom(
  null,
  (get, set, source: CommitDialogSource) => {
    if (get(openCommitDialogAtom) === source) {
      set(openCommitDialogAtom, null);
    }
    if (get(commitDialogReturnAtom) === source) {
      set(commitDialogReturnAtom, null);
    }
  },
);

/**
 * Ends one dialog's session without committing: closes it, drops a pending
 * return to it, and discards the draft typed in it. Reaching the diff and
 * coming back reopens the same dialog through `commitDialogReturnAtom`, so a
 * return target that outlived its dialog would resurrect one the user had
 * already dismissed - hence dropping it here rather than only closing.
 *
 * Scoped to the source that owns the dialog, and to the app the draft was
 * written for, so a commit or discard resolving late cannot close a dialog the
 * user has since opened elsewhere or clear a message meant for another app.
 */
export const dismissCommitDialogAtom = atom(
  null,
  (
    _get,
    set,
    { source, appId }: { source: CommitDialogSource; appId: number | null },
  ) => {
    set(releaseCommitDialogAtom, source);
    if (appId !== null) {
      set(discardCommitMessageDraftAtom, appId);
    }
  },
);

/**
 * Drops the open dialog and any pending return without touching the staged
 * diff. For callers that replace the displayed presentation wholesale (chat tab
 * switches), where a dialog belonging to the previous tab must not survive.
 *
 * The draft deliberately survives: it is keyed by app, so coming back to that
 * app's dialog is the "switching back" case the per-app map exists for. Writing
 * it here would be unsafe anyway - callers set `selectedAppIdAtom` around this,
 * so a selected-app-scoped write could land on the wrong app's entry.
 */
export const resetCommitDialogAtom = atom(null, (_get, set) => {
  set(openCommitDialogAtom, null);
  set(commitDialogReturnAtom, null);
});
