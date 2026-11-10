# Worktree isolation (isolated chat workspaces)

Opt-in (`enableWorktreeIsolation`). While it is on, every chat's first
writable turn gives it its own linked Git worktree on `dyad/chat-<id>` (an
app's first chat included), whether or not another chat is writing; Dyad
later merges its finished work back. Claude Code chats are isolated too
when their CLI can resume a session from another directory; with an older
CLI they use the app's original folder, as every chat does while isolation
is off.

## Where a turn runs

- `chat_stream_handlers.ts` calls `chatWorkspaceService.prepareTurnWorkspace`
  after the placeholder message is inserted and settles it in `finally`. The
  decision is one synchronous `chatWorkspaceRegistry.reserveWritableTurn` call;
  never add an `await` between "is it free?" and the reservation. A
  `new-workspace` reservation never falls back to the original folder: while
  the app is not on a branch, the turn waits and says why. There is no limit
  on workspaces per app.
- During a turn, code lives at `ctx.appPath` / `turnWorkspace.appPath`. Never
  re-resolve `getDyadAppPath(chat.app.path)` for code operations (commits,
  reviews, copies, snapshots): it is the app's original folder, not the
  chat's workspace. Use `chatWorkspaceService.resolveChatAppPath(chatId)` or
  `getActiveWorkspaceForChat` outside a turn.
- `.dyad` state that must outlive a workspace (plans, todos) uses
  `ctx.dyadMetadataPath`. Media/attachments are mirrored into the worktree at
  turn start and new files are mirrored back at settle. The chat's plan files
  are mirrored in too (`/implement-plan` edits the working plan with ordinary
  file tools); the working plan is copied back only if the turn changed it.
- Mirrored files must never look like work: `excludeDyadMetadata` adds
  `.dyad/` to the repository's `info/exclude` (shared by its worktrees)
  because the branch a workspace starts from may predate the app's
  `.gitignore` entry.
- The placeholder's `sourceCommitHash` is recorded after the workspace is
  prepared, so a pre-turn synchronization merge is part of the baseline.
- `TurnWorkspace.appPath` for the original folder is a snapshot. The app can
  move while a turn waits (Claude Code admission), so re-resolve it from the
  app row after any wait; an isolated workspace's path never moves.
- Build mode writes after streaming: pass `workspaceAppPath` to
  `processFullResponseActions`. Approving a proposal reserves the chat's
  workspace like a turn with `synchronize: false`: the proposal was written
  against the unsynchronized code, and merging the target first would let
  its full-file writes silently revert other chats' merged work.

## Claude Code chats

- The CLI runs in the turn's directory, so a Claude Code chat's folder
  changes when it first gets a worktree (its earlier turns ran in the app's
  folder: before isolation was on, or read-only), and again when its worktree
  is deleted. Its session survives because `--resume` works from another
  directory (CLI `CLAUDE_CROSS_DIRECTORY_RESUME_VERSION` and later; 2.1.42
  fails with "No conversation found") and `claudeSessionFingerprint` hashes
  the app's folder, with the worktree path in the system prompt mapped back to
  it. Never fingerprint `ctx.appPath` directly.
- With an older CLI the chat passes `allowIsolation: false` and keeps sharing
  the app's folder; check the version from `claudeStatus()` wherever a chat
  can be given a workspace (turns and proposal approval).
- Undo in a workspace clears the chat's Claude session like Undo in the app's
  folder: the CLI transcript still holds the undone turns.

## Runtime, ports, and logs

- A workspace runtime's lifecycle claims `runtime` on the workspace key and
  its app-wide claims (`app-path`, `runtime-config`) on the app
  (`runRuntimeLifecycle`), so app deletion and configuration swaps fence it.
- Neon restore points are stored on the turn's own commit (pass the turn's
  `appPath` to `storeDbTimestampAtCurrentVersion`); integration copies the
  newest included one onto the squash, then replaces it in the background
  with the database as it is when the squash lands (`commitHash: squash`):
  each stamp is taken as a turn starts, so the carried one predates the
  last turn.

- A workspace previews under `workspaceRuntimeId(workspaceId)`
  (`shared/workspace_runtime_id.ts`, 1e9 + id). The app_run actor, log store,
  `runningApps`, and coordinator are keyed by that number; `findRuntimeApp`
  maps it back to the app row plus the worktree path.
- Agent runtime tools (`read_logs`, lifecycle, `run_build`, `run_shell`) use
  `ctx.runtimeAppId`. The renderer's preview, console, and `useRunApp` default
  follow `usePreviewRuntime()`; app-level features stay keyed by the app.
- Workspace runtimes use their own port bands and always `localhost`; cloud
  runtime refuses them, visual editing and screenshots are off for them, and
  E2E `run_tests` refuses in isolated turns.
- Cloud sandbox syncs from agent tools use `ctx.runtimeAppId`: a workspace's
  edits (especially deletions) must not reach the app's sandbox before they
  are merged. The integration queue syncs the merged files after the
  fast-forward.

## Coordination

- Use `runWorkspaceScopedOperation`: file/index/runtime claims go on the
  workspace key, app-wide claims (providers, media, runtime-config, app-path)
  stay on the app id. Workspace keys are larger than app ids, so app-then-
  workspace acquisition follows the ascending-id rule. Workspace-only work
  is still admitted on the app id (with no claims), so app deletion refuses
  and drains it like any other app operation.
- `chatWorkspaceRegistry` locks a workspace for a turn, integration, or
  removal. Removal must claim first (`tryClaimWorkspaceForRemoval`); a "not
  busy" check alone races new turns.

## Keeping and deleting workspaces

- Nothing removes a workspace automatically: no idle or capacity sweep, and
  integration never removes one after merging. Workspaces go only through
  `deleteChatWorkspace` (the chat's Delete worktree button, refused while a
  turn, merge step, or reader holds it), chat deletion, or app deletion.
- Deleting stops the workspace runtime, removes the worktree (uncommitted
  changes go with it), and deletes the branch only when it is fully merged,
  so unmerged commits stay reachable. The chat's next writable turn creates
  a new workspace.
- Every deletion of a chat that may have run a turn calls `onChatDeleting`
  before deleting the row, after the chat's turns are cancelled and drained
  (`afterDrain`) and outside any app claim (removal takes its own), or the
  runtime, worktree, and queue state leak. Only rollbacks of a chat created
  moments earlier that never ran a turn (an abandoned first prompt, a
  security-fix chat whose setup failed) delete the row directly: a
  workspace is created by a turn, so they cannot have one. Forced removal never deletes without the removal claim: if
  something still holds the workspace, the folder is left for the startup
  orphan sweep.
- Startup does not wait for recovery (it runs Git in every worktree);
  instead every operation that changes a workspace (`prepareTurnWorkspace`,
  undo, delete, retry, idle synchronization) awaits `waitForRecovery()`.
  Recovery deletes interrupted "creating" rows and sweeps orphan folders, and
  starts the integration queue even when it fails.
- `ensureDyadGitignored` does nothing inside a chat worktree
  (`isInsideChatWorkspace`) or where the repository's `info/exclude` already
  lists `.dyad/` (`isDyadMetadataExcludedSync`, which isolation guarantees;
  looked up from the checkout root, since an app in a subfolder of its
  repository has no `.git` of its own):
  a tracked `.gitignore` edit in the app's folder is never committed while
  chats work in worktrees and blocks merges that touch it. With isolation on
  it adds `.dyad/` to `info/exclude` itself, since an attachment on a
  chat's first message is stored before its worktree exists.
- Settlement copies back only media the turn created (not what was mirrored
  in), so media the user deleted or moved meanwhile does not return. Until
  then a turn's generated media is only in the worktree, so `copy_file` /
  `<dyad-copy>` resolve media from the app's folder and then the worktree. Undo
  that fails after committing interrupted edits resets them to uncommitted.
- New workspace ids skip any port slot (`id % workspacePortSlotCount()`) a
  kept workspace holds (`pickWorkspaceId`), so previews share ports only
  once every slot (1,000; 500 in E2E) is held by a kept workspace; then the
  next id is used anyway. A removal that fails while the folder still exists
  puts the workspace back to `active` so the chat is not stuck waiting,
  after `restoreMissingTrackedFiles` writes back files the removal already
  deleted (the next turn would otherwise commit their deletion). Forced
  removal that gives up still disposes the workspace's preview.
- `hasUnmergedWork` in the chat's workspace status (unintegrated HEAD or
  uncommitted changes) picks the delete dialog's copy. Never infer it from
  the phase: "merged" stays after a stopped turn leaves edits.
- `deleteMergedBranch` (orphan sweep, failed creation) also deletes a
  branch whose tree equals its merge-base with `HEAD`: squashed work is
  never "merged" to `git branch -d`.
- Restore-to-message refuses a target commit that only worktree branches
  contain, or that no branch contains when the chat has a squash
  (`Dyad-Chat` trailer) on the app's branch: after a merged worktree is
  deleted its checkpoints are on no branch. A commit on no branch for a chat
  that never integrated (history rewritten by a rebase) restores as before.
- `.env*` files are gitignored, so `syncEnvironmentFiles` copies them into a
  worktree (missing or older than the app's copy) at creation, every writable
  turn, and every worktree preview start. Files either checkout tracks or has
  staged are skipped (an uncommitted edit in the app's folder would be
  committed by the chat), nothing is copied when Git cannot list them, and a
  worktree entry that is not a regular file (a symlink) is never written. Compaction keeps its transcript
  backup in the app's folder too (`durableAppPath`), and turns mirror the
  chat's `.dyad/chats/<id>/` backups in.
- Use `waitForChange(signal, { timeoutMs })` to poll; racing it against a
  timer leaves a waiter and an abort listener behind each round.
- Each worktree installs its own `node_modules`. `createWorkspace` records
  the package manager its installs will use (`chat_workspaces.package_manager`)
  so the chat can warn npm users, whose worktrees each get a full copy.

## Integration

- Lifecycle is the pure machine in `src/workspace_integration/`; execution is
  `workspace_integration_queue.ts`, one active attempt per app. Persist each
  transition before running its commands.
- Merge the target into the worktree, validate there, then land the result
  as one squash: `createSquashCommit` (`git commit-tree`, so no checkout
  moves) puts the worktree's exact tree on top of the target, and the target
  fast-forwards to it after rechecking branch, HEAD, and cleanliness under the
  app's `repository` claim. The squash carries `Dyad-Chat`, `Dyad-Workspace`,
  and one `Dyad-Turn` per included turn. Never rebase the worktree: message
  `commitHash`/`sourceCommitHash` stay on its branch for Undo.
- A successful fast-forward is integration success. Never decide "is this
  integrated?" by looking for the worktree's commits in the target (they are
  never there): use `isWorkspaceIntegrated`, which compares HEAD with
  `integratedHead` (`lastIntegratedCommit`, or `baseCommit` before the first
  integration). Anything that moves HEAD without adding chat work (pre-turn
  synchronization, recording a squash) must update `lastIntegratedCommit`; a
  spurious "unintegrated" self-heals because identical trees integrate as
  `NOTHING_TO_INTEGRATE`.
- After the fast-forward, `recordIntegratedSquash` merges the squash into the
  worktree with `-s ours` (no file changes). Without it the next merge with
  the target would start from the old merge-base and conflict with the chat's
  own earlier changes to the same lines.
- Branches are never "merged" in Git's sense, so removal deletes a branch
  (`forceDeleteBranch`) only when the workspace is integrated; otherwise it
  keeps it so unmerged commits stay reachable.
- Conflict repair resumes the originating chat (`workspace-integration` turn
  owner) without holding any claim. While MERGE_HEAD exists, neither the
  Local Agent turn nor a Build-mode response commits (the resolution stays
  staged); `settleMergeTurn` checks markers and unmerged entries before
  completing the merge. Approving a proposal is refused until then.
- Use `isMergeInProgress` (looks up the checkout from an app subfolder) or
  `inspectRepositoryHealth` for workspace paths: an app can live in a
  subfolder of its repository, so `<appPath>/.git` may not exist.
- Git reports paths relative to the repository root (`workspace.path`), not
  the app's folder. Resolve them against `workspace.path` for file checks and
  show the agent `toAppRelativePath(workspace, file)`; run per-file Git
  commands from `workspace.path`.
- An attempt that restarts after `WAITING` re-merges, but `validate` skips a
  tree that already passed (`passedTrees`), so blocked integration never
  loops through install/build/test. A tree that failed type-check, build, or
  tests (`failedTrees`; never install failures, which are often transient,
  nor `transientFailure` results: a timeout or a check that could not run)
  fails again without rerunning until Retry calls `forgetValidation`.
- The type-check baseline (errors the target already has) uses the app's
  folder when it is at the target commit and has no uncommitted changes
  other than install-written files.
- The squash is named after the newest own commit that is not the
  install-files commit (`INSTALL_COMMIT_SUBJECT`).
- Uncommitted changes in the app's folder do not block the fast-forward:
  nothing commits there while chats work in worktrees, and Dyad's own writes
  (a `.gitignore` entry, a lockfile) would otherwise stall every merge. Git
  refuses only when the update would overwrite them, which becomes a
  `WAITING` asking the user to commit or discard those files. Install-written
  files in the way (the main preview rewrote a lockfile) are restored to
  `HEAD` first (`discardInstallRewritesInTheWay`), so only the user's own
  edits ever block.
- A turn that hit its step limit still committed, so it requests integration
  like a finished one; only cancelled or failed turns wait for the next turn.
  A turn that completes a merge left by an attempt that already failed also
  re-requests, since no repair step is waiting for it.
- The fast-forward lands only a tree that passed validation
  (`passedTrees`): a turn can commit while an attempt is between steps or
  across a restart, and then the attempt goes back to merging and
  validating. Retries reuse the attempt's squash commit while the target and
  tree are unchanged.
- Queue timers drop their wait before kicking: timers can fire a moment
  early, and a wait still "in the future" would be skipped with no retry.
  Registry waits also get a fallback timer: the wait is recorded after the
  worker releases its claims, so a change landing in between is not seen.
- `prepareAttempt` commits install-written dependency files (lockfiles,
  `pnpm-workspace.yaml`) when they are a worktree's only uncommitted changes:
  its own preview and installs rewrite them with no turn left to commit. Not
  gated on `isClean`, which ignores `pnpm-workspace.yaml`. An
  interrupted merge's attempt targets `MERGE_HEAD`, not the moved target.
- Conflict resolution stages from the worktree root, since a conflict can be
  outside the app's subfolder. Repair prompts are for conflicts only (stored
  validation results belong to an earlier attempt), and other chats' intents
  come only from this app's chats.
- A worktree is never deleted while `resolving-conflicts` (a repair turn is
  queued for it). An app deletion that does not go through resumes the
  integration it stopped.
- An automatic `REQUESTED` from `resolving-conflicts` keeps `repairAttempts`
  (only a user-initiated request resets it), so the repair limit holds.
- A resolved repair with no `targetCommit` (a pause recovered after a
  restart) goes back to `queued`: `VALIDATION_PASSED` needs the target, so
  validating without one would never publish.
- Undo's interrupted-edits checkpoint stages from the worktree root, like
  conflict resolution.
- App deletion calls `stopIntegrationForApp` before `drain()`, and prunes the
  repository's worktree registrations after removing the folders.
- Proposal approval passes `refuseWhileMerging`: the merge check must happen
  under the reservation, because a merge can start (and conflict) while the
  approval waits. Never release such a reservation through `settle()`, which
  would report an interrupted conflict repair.
- Restart recovery inspects Git before trusting the stored phase. For
  "integrating", the fast-forward landed when the target moved off
  `integrationTargetCommit` and has exactly the worktree's tree; recovery then
  records the squash and marks the work merged.
- The conflict-repair prompt finds other chats' requests from target commits
  by `messages.commitHash` (main-folder chats) or the squash's `Dyad-Turn`
  trailers (worktrees).

## History operations

- Undo/Retry for an isolated chat call `workspace:undo-turns`, which reverts
  only the chat's own first-parent non-merge commits. Restore-to-message with
  a codebase restore refuses for isolated chats, and so does a version
  restore that names a chat message (`currentChatMessageId`) of a chat with a
  worktree: the renderer may not know the chat's workspace yet.
- Retry passes `requestIntegration: false`: its replacement turn integrates
  the revert with its own work, so the target never briefly loses the change.
- Undo keeps uncommitted edits only when they are an interrupted
  (cancelled or errored) turn's leftovers, like Undo in the app's folder;
  install-written files alone are committed as install output first, and any
  other uncommitted edit refuses the undo.
- The version list is the app's branch for every chat. `list-versions`
  parses the `Dyad-*` trailers (`parseDyadCommitTrailers`) into each version's
  `workspace` (branch, chat, title) and `turnMessageIds`. Map a message to its
  version with `findVersionIndexForMessage` (its own commit, else the squash
  naming its turn), and never restore the app's branch to a message's
  `sourceCommitHash` unless that commit is one of the branch's versions.

## App and branch changes

- Applying a template (blueprint approval) commits in the app's folder, so
  `applyAppTemplate` then calls `synchronizeIdleWorkspace(chatId)`, after its
  app claims are released, to bring the chat's idle, fully merged worktree
  onto the new template. It returns the `runtimeAppId` to restart: the
  worktree's runtime, which is what the chat previews.

- Operations that move an app's folder (rename, change location, template
  path swap) call `chatWorkspaceService.reconnectAfterAppMove(appId)` while
  they still hold their claims; it runs `git worktree repair`. Turns and
  startup also repair a broken link (`isWorktreeLinkBroken`) for moves Dyad
  did not see.
- Branch renames call `onBranchRenamed`: renaming the target is not
  switching away from it, so its workspaces follow the new name.
- Copying an app with history skips `.git/worktrees`; the copy must not
  inherit the original's worktree registrations.

## Linked worktrees

- `.git` is a file in a linked worktree. Use `resolveGitDirSync` /
  `rev-parse --git-path` for per-worktree markers and
  `resolveGitCommonDirSync` for shared config. Parse branch lists with
  `--format=%(refname:short)` (otherwise `+ branch` markers leak through).

## Tests

- `src/ipc/handlers/__tests__/worktree_isolation.test.ts` drives two chats
  through the real chat pipeline. It registers the `chat_stream` machine (the
  node harness does not) and stubs `validateWorkspace`, which would install
  dependencies. Run it with the Electron-as-Node recipe from
  `rules/native-modules.md` when `better-sqlite3` is built for Electron.
