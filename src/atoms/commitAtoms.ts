import { atom } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "./appAtoms";
import { isPreviewOpenAtom, stagedDiffFileAtom } from "./viewAtoms";

export type CommitDialogSource = "editor" | "banner";

/**
 * Who a commit dialog belongs to: the entry point that opened it and the app it
 * commits. Both halves matter. The source decides which component renders it,
 * and the app is what makes a late-arriving teardown safe - a commit that
 * resolves after the user moved on names the app it was for, so it cannot close
 * a dialog or discard a message that now belongs to somewhere else.
 */
export interface CommitDialogOwner {
  source: CommitDialogSource;
  appId: number;
}

const isSameOwner = (
  a: CommitDialogOwner | null,
  b: CommitDialogOwner | null,
) => a !== null && b !== null && a.source === b.source && a.appId === b.appId;

/**
 * Which commit dialog is showing, if any. This is global rather than component
 * state because the dialog is no longer owned by one subtree: clicking a file
 * closes it and opens that file's staged diff, and the code view's "back to
 * editor" control is what brings it back.
 */
export const openCommitDialogAtom = atom<CommitDialogOwner | null>(null);

/**
 * The dialog to reopen when the user leaves the staged diff, set when the diff
 * was opened from a dialog. Deliberately not exported: only the actions below
 * may write it, so no caller can leave a stale return target behind.
 */
const commitDialogReturnAtom = atom<CommitDialogOwner | null>(null);

/**
 * Commit messages the user typed, keyed by app. Auto-generated defaults are
 * never stored here, so a message the user did not write cannot go stale as
 * more files change.
 *
 * Both dialogs share one entry per app on purpose: they are two entrances to
 * the same commit of the same working tree, so a message typed in one is the
 * message for the other. Staleness is bounded by lifetime: a draft only lives
 * while its dialog is open, or while a diff opened from that dialog is showing.
 * Every way out of that round trip - committing, discarding, dismissing,
 * unmounting the dialog's host, or leaving the diff for anywhere else - drops
 * it, so it cannot outlive the change set it was written for.
 *
 * Keying by app is what makes those exits safe rather than what makes drafts
 * durable. A commit that resolves after the user moved on names the app it was
 * for, so it deletes that entry instead of whatever is on screen now. In
 * practice at most one entry exists, because switching apps unmounts the host
 * that owned the dialog and that drops the draft with it.
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
 * Everything that ends a dialog's life goes through here, so a teardown that
 * runs after the user moved on cannot wipe a draft they have since typed for
 * another app.
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
    { path, returnTo }: { path: string; returnTo: CommitDialogOwner | null },
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
 *
 * `appId` is the app the caller acted on, and this is a no-op once the user has
 * moved to another one. The staged diff and the draft are both global but only
 * ever describe the selected app, so a commit resolving late must not close the
 * diff, or discard the message, that has since come to belong to somebody else.
 */
export const clearStagedDiffAtom = atom(
  null,
  (get, set, appId: number | null) => {
    if (appId === null || get(selectedAppIdAtom) !== appId) return;
    set(stagedDiffFileAtom, null);
    set(commitDialogReturnAtom, null);
    set(discardCommitMessageDraftAtom, appId);
  },
);

/**
 * Ends one dialog's life: closes it, drops a pending return to it, and discards
 * the message typed in it. Both ways a dialog can end come through here.
 *
 * - The user dismissed it. Leaving the return target behind would let the
 *   staged diff's back arrow resurrect a dialog they just cancelled, and
 *   leaving the draft behind would prefill a later, unrelated commit.
 * - Its host can no longer render it. A dialog is only visible while its owner
 *   is mounted, and the owner of a pending return has to still be there to be
 *   returned to, so a source that cannot render must drop both - otherwise the
 *   dialog pops open unprompted on the next remount, and the staged diff's back
 *   control resolves to a dialog nobody renders. Both hosts need this: the
 *   banner is mounted conditionally by ChatHeader, and CodeView unmounts
 *   whenever `previewMode` leaves "code", which background subscriptions do on
 *   their own (a `plan:update` event switches to plan mode).
 *
 * Scoped to the owner, so neither a teardown for another source nor one for
 * another app can touch the dialog in front of the user. An owner that turns
 * out to hold neither the dialog nor the pending return leaves even the draft
 * alone: the two sources share one draft per app, so the editor's toolbar
 * unmounting must not empty the input of a banner dialog the user is typing in.
 */
export const closeCommitDialogAtom = atom(
  null,
  (get, set, owner: CommitDialogOwner) => {
    const ownsDialog = isSameOwner(get(openCommitDialogAtom), owner);
    const ownsReturn = isSameOwner(get(commitDialogReturnAtom), owner);
    if (!ownsDialog && !ownsReturn) return;

    if (ownsDialog) set(openCommitDialogAtom, null);
    if (ownsReturn) set(commitDialogReturnAtom, null);
    set(discardCommitMessageDraftAtom, owner.appId);
  },
);

/**
 * Drops the open dialog and any pending return without touching the staged
 * diff. For callers that replace the displayed presentation wholesale (chat tab
 * switches), where a dialog belonging to the previous tab must not survive.
 *
 * The draft is left alone, because this has no app to name it by: callers set
 * `selectedAppIdAtom` around this, so a selected-app-scoped write could land on
 * the wrong app's entry. Nothing leaks either way - the tab switch unmounts
 * whichever host owned the dialog, and that drops the draft with it.
 */
export const resetCommitDialogAtom = atom(null, (_get, set) => {
  set(openCommitDialogAtom, null);
  set(commitDialogReturnAtom, null);
});
