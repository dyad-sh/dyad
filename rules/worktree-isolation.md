# Worktree isolation (isolated chat workspaces)

Opt-in (`enableWorktreeIsolation`). When a writable turn starts while another
writable agent is running for the same app, the chat gets its own linked Git
worktree on `dyad/chat-<id>`; Dyad later merges its finished work back.

## Where a turn runs

- `chat_stream_handlers.ts` calls `chatWorkspaceService.prepareTurnWorkspace`
  after the placeholder message is inserted and settles it in `finally`. The
  decision is one synchronous `chatWorkspaceRegistry.reserveWritableTurn` call;
  never add an `await` between "who else is writing?" and the reservation.
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

## Runtime, ports, and logs

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
  workspace acquisition follows the ascending-id rule.
- `chatWorkspaceRegistry` locks a workspace for a turn, integration, or
  removal. Removal must claim first (`tryClaimWorkspaceForRemoval`) and then
  recheck eligibility; a "not busy" check alone races new turns.

## Integration

- Lifecycle is the pure machine in `src/workspace_integration/`; execution is
  `workspace_integration_queue.ts`, one active attempt per app. Persist each
  transition before running its commands.
- Merges only: merge the target into the worktree, validate there, then
  fast-forward the target after rechecking branch, HEAD, and cleanliness
  under the app's `repository` claim. Never rebase or squash: message
  `commitHash`/`sourceCommitHash` and version metadata reference commits.
- Conflict repair resumes the originating chat (`workspace-integration` turn
  owner) without holding any claim. While MERGE_HEAD exists, neither the
  Local Agent turn nor a Build-mode response commits (the resolution stays
  staged); `settleMergeTurn` checks markers and unmerged entries before
  completing the merge. Approving a proposal is refused until then.
- Use `isMergeInProgress` (looks up the checkout from an app subfolder) or
  `inspectRepositoryHealth` for workspace paths: an app can live in a
  subfolder of its repository, so `<appPath>/.git` may not exist.
- Restart recovery inspects Git before trusting the stored phase.

## History operations

- Undo/Retry for an isolated chat call `workspace:undo-turns`, which reverts
  only the chat's own first-parent non-merge commits. Restore-to-message with
  a codebase restore refuses for isolated chats.

## App and branch changes

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
