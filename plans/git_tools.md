# Safe Git Tools for Local Agent

## Summary

Add six current-app Git tools: read-only `git_status`, `git_diff`, `git_log`,
`git_show_commit`, and `git_show_file`, plus state-changing
`git_restore_file`. The read tools remain available in ask and plan modes;
restore is filtered from those modes and restores one historical file into
the working tree without changing the index. Replayed assistant turns also
receive one in-memory Git-context annotation so the agent can connect prior
responses to the relevant repository state.

## Public tool interfaces

### `git_status`

```ts
git_status({});
```

- Return the current branch or detached-HEAD state, canonical HEAD commit, and
  user-visible staged, unstaged, untracked, and conflicted paths.
- Use structured status categories rather than exposing raw porcelain output.

### `git_diff`

```ts
git_diff({
  scope?: "unstaged" | "staged" | "all"; // defaults to all
  path?: string;
  context_lines?: number; // defaults to 3, range 0-20
})
```

- `unstaged` compares the index with the working tree.
- `staged` compares `HEAD` with the index.
- `all` compares `HEAD` with the working tree, including staged and unstaged
  tracked changes but not untracked files; `git_status` reports those.
- Accept an optional literal path filter and return a bounded unified diff.

### `git_log`

```ts
git_log({
  revision?: string; // defaults to HEAD
  max_count?: number; // defaults to 20, range 1-100
  path?: string;
})
```

- Accept one revision/ref, a literal optional path, and a bounded commit count.
- Return newest-first canonical commit hashes, author details, ISO timestamps,
  and commit messages.

### `git_show_commit`

```ts
git_show_commit({
  revision: string;
  path?: string;
})
```

- Return commit metadata and a deterministic first-parent patch, optionally
  narrowed to one literal path.

### `git_show_file`

```ts
git_show_file({
  revision: string;
  path: string;
  start_line_one_indexed?: number;
  end_line_one_indexed_inclusive?: number;
})
```

- Return historical UTF-8 file content with the existing 256 KiB agent-read
  limit and line-range behavior.

### `git_restore_file`

```ts
git_restore_file({
  revision: string;
  path: string;
})
```

- Restore exactly one regular file, executable, or symlink from the resolved
  commit.
- Set `modifiesState: true` and default consent to `always`.
- Overwrite dirty or untracked working-tree content while leaving the index
  untouched.
- Reject directories, pathspecs, missing historical files, submodules,
  multiple paths, and referenced apps.

## Implementation changes

### Assistant-history Git context

- When rebuilding local-agent history, append one provider-neutral synthetic
  assistant text message after each parsed prior assistant turn:
  - If `commitHash` exists, append
    `<dyad-git-context commit="FINAL_HASH"></dyad-git-context>`.
  - Otherwise, if `sourceCommitHash` exists, append
    `<dyad-git-context source_commit="START_HASH" no_commit="true"></dyad-git-context>`.
  - If neither exists, append nothing. Never include both hashes by default.
- Treat `source_commit` as "HEAD when the turn began," not an exact snapshot of
  every working-tree file the assistant saw. Treat `commit` as the repository
  commit recorded after the turn, not proof that every included change was
  authored by that assistant response.
- Add annotations only to the in-memory `ModelMessage[]` passed to the model.
  Do not write them into message `content` or `aiMessagesJson`, and do not
  render them in the chat UI. Escape attribute values before constructing XML.
- Keep each annotation after the complete reconstructed AI SDK transcript for
  its database message so tool-call/tool-result adjacency remains valid.

### Git tools

- Add a hardened agent-Git execution layer in
  `src/ipc/utils/git_utils.ts`: canonicalize refs to commit OIDs; disable
  replace refs, pagers, external diffs, and textconv; force literal pathspecs;
  avoid shell execution; and bound model-visible output.
- Validate paths as current-app-relative with no traversal or pathspec
  expansion. Classify malformed refs/ranges as `Validation`, missing
  repositories/files as `NotFound` or `Precondition`, and user-fixable
  repository failures as `Conflict`.
- For current and historical patches, omit dotenv patch bodies with an
  explicit sensitive-content notice. For file views, redact dotenv values
  before selecting line ranges; reject binary/non-UTF-8 content while still
  allowing binary restoration.
- Execute restore under the existing per-file write lock using worktree-only
  Git restoration after confirming the historical tree entry. Preserve cloud
  sandbox synchronization, shared Supabase module tracking/deployment,
  blueprint gating, end-of-turn commits, and normal tool-consent behavior.
- Register the tools under
  `src/pro/main/ipc/handlers/local_agent/tools/` and expose compact Git cards
  through `src/components/chat/DyadMarkdownParser.tsx`, showing operation,
  scope, short revision, path, and pending/finished state without embedding
  full output in the card.
- Update exact agent/ask/plan tool-set expectations and affected request
  snapshots. Do not expose arbitrary Git arguments or add commit-to-commit
  diff ranges, blame, branch checkout, staging, network, or multi-file restore
  operations in v1.

## Test plan

- Add temporary-repository tests for structured status categories, detached
  HEAD and conflict states, each diff scope, path/context filtering, untracked
  file handling, log ordering and limits, revision/path filters, invalid refs,
  literal path enforcement, replace-ref immunity, root and merge commits,
  patch truncation, dotenv omission/redaction, binary rejection, and missing
  paths.
- Add restore tests proving dirty and untracked targets are overwritten,
  deleted targets are recreated, the index remains unchanged, staged changes
  remain staged, executable/binary content is preserved, and
  traversal/directories/submodules are rejected.
- Add tool-policy tests proving all five read tools appear in normal, ask, and
  plan modes while `git_restore_file` appears only in writable agent mode and
  participates in consent and blueprint gating.
- Add renderer tests for each compact Git card and streaming state, plus
  integration/request snapshot updates for exact tool declarations.
- Add history-replay tests covering final-commit annotation, source-only
  fallback, preference for final commit when both hashes exist, omission when
  neither exists, and placement after a multi-message tool-call/tool-result
  transcript. Verify replay does not mutate or persist `content` or
  `aiMessagesJson`.
- Run focused Vitest suites, then formatting, lint, and `npm run ts`; rebuild
  before any targeted Playwright snapshot verification.

## Assumptions

- All six tools operate only on the active app; no `app_name` parameter is
  added.
- `git_diff` does not compare arbitrary revisions in v1;
  `git_show_commit` remains the historical commit-patch interface.
- Revisions may be `HEAD`, a branch/tag, or an abbreviated/full commit hash,
  but not revision ranges or arbitrary Git options.
- Commit/file output is capped at the existing 256 KiB agent-read limit with
  an actionable narrowing notice.
- Restore intentionally behaves like an unstaged worktree edit, not exact
  `git checkout HASH -- FILE_PATH` index semantics.
- Each replayed assistant database message gets at most one Git-context
  annotation. The source hash is used only when the turn has no final commit.
