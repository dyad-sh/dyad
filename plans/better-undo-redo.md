# Better Undo/Redo: Confirm Before Reverting Extra Commits

## Summary

When the user clicks **Undo** (or **Retry**, which reverts before re-streaming) on the last chat turn, and performing that revert would wipe out _more commits than the message's own commit_ — e.g. the user made manual commits via CLI/IDE, or Dyad created intermediate commits (dirty-tree checkpoints, commits from another chat on the same app) — show a confirmation `AlertDialog` (styled like the existing "Restore to this point?" dialog in `ChatMessage.tsx`) that lists the extra commits about to be reverted, with **Undo anyway / Cancel** actions. When the revert only covers the message's own commit (the overwhelmingly common case), behavior is unchanged: no dialog, immediate revert.

Decisions made with the user:

- **Warn + confirm only.** No "surgically revert just this message's commit" mode — `git revert` of a single commit is a 3-way merge that can conflict with later commits, and Dyad has no conflict-resolution UI. (Possible follow-up: offer a surgical mode gated on a clean dry-run.)
- **Scope: Undo + Retry.** Both footer actions that revert code. The Version pane's Restore button is left as-is.
- **Trigger: any extra commit**, regardless of author (Dyad checkpoint or manual). Simple and predictable.
- **UI: centered `AlertDialog`**, consistent with the restore-to-message UX.

## Background: how undo/retry work today

- `src/components/chat/MessagesList.tsx` → `FooterComponent`:
  - `handleUndo` (~line 89): finds the last message's `commitHash` in the `versions` list, targets the **next-older** version (`versions[currentCommitIndex + 1].oid`, falling back to `sourceCommitHash`), and dispatches `{ type: "RESTORE", ... }` via `sendPreviewMutation`.
  - `handleRetry` (~line 143): if the last assistant commit is still the tip (`versions[0].oid === lastMessage.commitHash`), reverts to the previous assistant message's `commitHash` (or the chat's `initialCommitHash`), then re-streams the last user prompt. If the tip has moved (user committed after the turn), it skips the revert entirely and just re-streams.
  - Both handlers are shared by `ModifiedFilesCard` (committed turns) and the standalone Undo/Retry buttons (text-only turns), all rendered in the footer.
- The main-process revert (`revert-version` IPC → `gitStageToRevert` in `src/ipc/utils/git_utils.ts:519`) restores the target _tree_ as a new forward commit. History isn't rewritten, but the content of every commit between HEAD and the target is silently wiped — with no detection or warning anywhere.
- `versions` (from `useVersions` → `listVersions` IPC, `src/ipc/handlers/version_handlers.ts:608`) is a `gitLog` from HEAD, newest-first, each entry carrying `{ oid, message, timestamp }`. This is everything needed to detect and describe extra commits — **no new IPC or git helper is required** for detection.

## Design

### 1. Detection helper (pure function)

New file `src/components/chat/revertImpact.ts` (or colocate in `src/shared/` if preferred for unit testing):

```ts
export function getExtraRevertedCommits({
  versions,        // newest-first list from useVersions
  targetOid,       // the revert target
  ownCommitHashes, // commit(s) that are *expected* to be reverted (the message's own)
}: {...}): Version[] | null
```

- Find `targetIndex = versions.findIndex(v => v.oid === targetOid)`.
- If `targetIndex === -1` (target not in the loaded log — e.g. versions query empty/failed), return `null` meaning "cannot determine"; the caller proceeds exactly as today. We deliberately avoid false-positive dialogs over a safety guarantee we can't compute.
- Otherwise, the commits wiped by the revert are `versions.slice(0, targetIndex)`. Return those whose `oid` is not in `ownCommitHashes`.
- Common cases fall out naturally:
  - Normal undo: wiped = `[message's commit]` → extras empty → no dialog.
  - Text-only reply undone via `sourceCommitHash` where HEAD already equals it: `targetIndex === 0` → wiped empty → no dialog.
  - User made 2 manual commits after the AI turn: wiped = `[manual2, manual1, aiCommit]` → extras = the 2 manual commits → dialog.

### 2. Refresh before deciding

The `versions` query can be stale (user may have committed from the CLI since the last fetch, and the app window regaining focus doesn't guarantee a refetch has landed). On Undo/Retry click, `await refreshVersions()` (the `refetch` already exposed by `useVersions`) and compute both the revert target and the extras from the **returned fresh data** (`const { data } = await refreshVersions()`), not the possibly-stale closure value. This keeps detection and target-selection consistent: both come from the same snapshot.

### 3. Restructure the handlers in `MessagesList.tsx`

Split each handler into "plan" and "perform" stages so the dialog can sit between them:

- `handleUndo` becomes:
  1. Refresh versions; compute `revertTargetVersionId` (existing logic) and `extraCommits` via the helper, with `ownCommitHashes = [currentMessage.commitHash]`.
  2. If `extraCommits?.length > 0`: stash a pending action in state and open the dialog. **Do not** set `isUndoLoading` while the dialog is open.
  3. Otherwise (or on dialog confirm): run the existing revert dispatch (`performUndo(target)`).
- `handleRetry` similarly: the revert branch (both the previous-assistant-commit case and the `initialCommitHash` fallback) computes extras with `ownCommitHashes = [lastMessage.commitHash]` before reverting. On extras → dialog with a Retry-flavored label; on confirm → revert then re-stream (the whole remainder of today's `handleRetry`). The no-revert path (`shouldRedo === true` because the tip moved) never shows a dialog — it doesn't touch the codebase.
- Pending-action state lives in `FooterComponent` (it already owns the handlers and loading state):

```ts
const [pendingRevert, setPendingRevert] = useState<{
  kind: "undo" | "retry";
  targetVersionId: string;
  extraCommits: Version[];
} | null>(null);
```

One dialog instance in the footer serves both `ModifiedFilesCard` and the standalone buttons, since they share the handlers.

### 4. The dialog component

New file `src/components/chat/ExtraCommitsRevertDialog.tsx`, modeled directly on the restore-to-message `AlertDialog` in `ChatMessage.tsx` (~lines 265–304):

- **Title:** `Undo will revert additional changes` (Retry: `Retry will revert additional changes`).
- **Description:** e.g. _"Besides this message's changes, 2 more commits were made afterwards. Undoing will also revert them:"_ — count-aware wording.
- **Commit list:** scrollable (`max-h-48 overflow-y-auto`) list of the extra commits, each showing the first line of the commit message and a relative timestamp via `formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true })` — same formatting as `VersionPane.tsx:260`. Cap visible entries sensibly (the list is usually 1–3; scrolling covers the rest — no silent truncation).
- **Footer** (stacked, like the restore dialog): destructive-styled `AlertDialogAction` **"Undo anyway"** / **"Retry anyway"**, then `AlertDialogCancel` **"Cancel"**.
- Props: `open`, `onOpenChange`, `kind: "undo" | "retry"`, `extraCommits: Version[]`, `onConfirm`.
- Test ids: `extra-commits-revert-dialog`, `confirm-revert-anyway-button`, `cancel-revert-button`.
- A cancelled dialog resets `pendingRevert` and leaves loading flags untouched.

### 5. Hardening (optional, phase 2): close the confirm-time race

Between showing the dialog and the user clicking "Undo anyway", another commit could land (agent in another chat, CLI). Defense in depth, backward compatible:

- Add optional `expectedHeadOid: z.string().optional()` to `RevertVersionParamsSchema` (`src/ipc/types/version.ts`).
- In the `revertVersion` handler (`src/ipc/handlers/version_handlers.ts:782` → `revertCodebaseToVersion`), when `expectedHeadOid` is provided, compare against the current HEAD before staging the revert; on mismatch throw a `Conflict` `DyadError` ("The app's history changed since you confirmed — please retry the undo."). The renderer surfaces it via the existing error toast path and refreshes versions.
- The renderer passes `versions[0].oid` from the same fresh snapshot used for detection. Only wire this for the dialog-confirmed path initially (the fast path already has an inherent race today; unchanged).

This phase is skippable for the MVP — the refresh-on-click in step 2 already covers the realistic staleness window.

## Files touched

| File                                               | Change                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/components/chat/revertImpact.ts`              | **New** — pure `getExtraRevertedCommits` helper                                                         |
| `src/components/chat/ExtraCommitsRevertDialog.tsx` | **New** — the confirmation dialog                                                                       |
| `src/components/chat/MessagesList.tsx`             | Split undo/retry into plan/perform, add `pendingRevert` state, render dialog, refresh versions on click |
| `src/ipc/types/version.ts`                         | (Phase 2) optional `expectedHeadOid` on revert params                                                   |
| `src/ipc/handlers/version_handlers.ts`             | (Phase 2) HEAD guard in revert path                                                                     |

No DB schema, no new IPC channels, no changes to `gitStageToRevert`.

## Testing

- **Unit:** `revertImpact.test.ts` — extras computed correctly for: no extras (normal undo), N manual commits after the turn, target not found (`null`), target === HEAD (empty), retry with intermediate commits between two assistant turns.
- **Integration:** extend the pattern in `src/ipc/handlers/__tests__/undo.integration.test.ts` (it drives the real Undo button through the real `revert-version` IPC):
  - Make an extra commit in the test repo after the assistant's commit → clicking Undo opens the dialog (assert commit message text appears) and does **not** revert yet.
  - Confirm → revert proceeds, tree matches target, chat messages trimmed as today.
  - Cancel → no revert, no message deletion, buttons re-enabled.
  - No extra commits → no dialog, revert proceeds immediately (regression guard for the fast path).
  - Same trio for Retry's revert branch.
- **Phase 2:** handler test that `expectedHeadOid` mismatch throws `Conflict` and leaves the tree untouched.

## Out of scope / follow-ups

- Surgical "revert only this message's commit" via `git revert` with a clean-apply pre-check (`git merge-tree` dry run) — explicitly deferred per discussion, due to merge-conflict risk and no conflict UI.
- Guarding the Version pane's Restore button the same way (it can also skip over many commits silently); the dialog component is built to be reusable if we extend it there later.
- Distinguishing Dyad-authored checkpoint commits from user commits in the dialog copy (e.g. a subtle badge) — trigger logic treats all extras alike per discussion, but labeling could reduce alarm for checkpoint-only cases.
