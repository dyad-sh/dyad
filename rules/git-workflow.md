# Git Workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/dyad`), then create a PR from the fork to the upstream repo (`dyad-sh/dyad`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`dyad-sh/dyad`) as a last resort.

## `gh pr create` branch detection

If `gh pr create` says `you must first push the current branch to a remote` even though `git push -u` succeeded, create the PR with an explicit head ref:

```bash
gh pr create --head <owner>:<branch> ...
```

This can happen when remotes are configured in a non-fork layout and `gh` fails to infer the branch mapping.

## Skipping automated review

Add `#skip-bugbot` to the PR description for trivial PRs that won't affect end-users, such as:

- Claude settings, commands, or agent configuration
- Linting or test setup changes
- Documentation-only changes
- CI/build configuration updates

## Cross-repo PR workflows (forks)

When running GitHub Actions with `pull_request_target` on cross-repo PRs (from forks):

- The checkout action sets `origin` to the **fork** (head repo), not the base repo
- To rebase onto the base repo's main, you must add an `upstream` remote: `git remote add upstream https://github.com/<base-repo>.git`
- Remote setup for cross-repo PRs: `origin` → fork (push here), `upstream` → base repo (rebase from here)
- The `GITHUB_TOKEN` can push to the fork if the PR author enabled "Allow edits from maintainers"
- **`claude-code-action` overwrites origin's fetch URL** to point to the base repo (using `GITHUB_REPOSITORY`). Any workflow that needs to push to the fork must set `pushurl` separately via `git remote set-url --push origin <fork-url>`, because git uses `pushurl` over `url` when both are configured. See `pr-review-responder.yml` and `claude-rebase.yml` for examples.

## GITHUB_TOKEN and workflow chaining

Actions performed using the default `GITHUB_TOKEN` (including labels added by `github-actions[bot]` via `actions/github-script`) do **not** trigger `pull_request_target` or other workflow events. This is a GitHub limitation to prevent infinite loops. If one workflow adds a label that should trigger another workflow (e.g., `label-rebase-prs.yml` adds `cc:rebase` to trigger `claude-rebase.yml`), the label-adding step must use a **PAT** or **GitHub App token** (e.g., `PR_RW_GITHUB_TOKEN`) instead of `GITHUB_TOKEN`.

## GitHub API calls with special characters

When using `gh api` to post comments or replies containing backticks, `$()`, or other shell metacharacters, the security hook will block the command. Instead of passing the body inline with `-f body="..."`, write a JSON file and use `--input`:

```bash
# Write JSON body to a file (use the Write tool, not echo/cat)
# File: .claude/tmp/reply_body.json
# {"body": "Your comment with `backticks` and special chars"}

gh api repos/dyad-sh/dyad/pulls/123/comments/456/replies --input .claude/tmp/reply_body.json
```

Similarly for GraphQL mutations, write the full query + variables as JSON and use `--input`:

```bash
# {"query": "mutation($threadId: ID!) { ... }", "variables": {"threadId": "PRRT_abc123"}}
gh api graphql --input .claude/tmp/resolve_thread.json
```

## Adding labels to PRs

`gh pr edit --add-label` fails with a GraphQL "Projects (classic)" deprecation error on repos that had classic projects. Use the REST API instead:

```bash
gh api repos/dyad-sh/dyad/issues/{PR_NUMBER}/labels -f "labels[]=label-name"
```

## CI file access (claude-code-action)

In CI, `claude-code-action` restricts file access to the repo working directory (e.g., `/home/runner/work/dyad/dyad`). Skills that save intermediate files (like PR diffs) must use `./filename` (current working directory), **never** `/tmp/`. Using `/tmp/` causes errors like: `cat in '/tmp/pr_*_diff.patch' was blocked. For security, Claude Code may only concatenate files from the allowed working directories`.

## Rebase workflow and conflict resolution

### Handling unstaged changes during rebase

If `git rebase` fails with "You have unstaged changes" (common with spurious `package-lock.json` changes):

```bash
git stash push -m "Stashing changes before rebase"
git rebase upstream/main
git stash pop
```

The stashed changes will be automatically merged back after the rebase completes.

### Conflict resolution tips

- **Modify/delete conflicts**: When a rebase shows `CONFLICT (modify/delete): <file> deleted in <commit> and modified in HEAD`, use `git rm <file>` (not `git add`) to resolve by confirming the deletion. Use `git add <file>` only when you want to keep the modified version instead.
- **Before rebasing:** If `npm install` modified `package-lock.json` (common in CI/local), discard changes with `git restore package-lock.json` to avoid "unstaged changes" errors
- When resolving import conflicts (e.g., `<<<<<<< HEAD` with different imports), keep **both** imports if both are valid and needed by the component
- When resolving conflicts in i18n-related commits, watch for duplicate constant definitions that conflict with imports from `@/lib/schemas` (e.g., `DEFAULT_ZOOM_LEVEL`)
- If both sides of a conflict have valid imports/hooks, keep both and remove any duplicate constant redefinitions
- When rebasing documentation/table conflicts (e.g., workflow README tables), prefer keeping **both** additions from HEAD and upstream - merge new rows/content from both branches rather than choosing one side
- **Complementary additions**: When both sides added new sections at the end of a file (e.g., both added different documentation tips), keep both sections rather than choosing one — they're not truly conflicting, just different additions
- **Preserve variable declarations used in common code**: When one side of a conflict declares a variable (e.g., `const iframe = po.previewPanel.getPreviewIframeElement()`) that is referenced in non-conflicting code between or after conflict markers, keep the declaration even when adopting the other side's verification approach — the variable is needed regardless of which style you choose
- **React component wrapper conflicts**: When rebasing UI changes that conflict on wrapper div classes (e.g., `flex items-start space-x-2` vs `flex items-end gap-1`), keep the newer styling from the incoming commit but preserve any functional components (like dialogs or modals) that exist in HEAD but not in the incoming change
- **Refactoring conflicts**: When incoming commits refactor code (e.g., extracting inline logic into helper functions), and HEAD has new features in the same area, integrate HEAD's features into the new structure. Example: if incoming code moves streaming logic to `runSingleStreamPass()` and HEAD adds mid-turn compaction to the inline code, add compaction support to the new function rather than keeping the old inline version

## Rebasing with uncommitted changes

If you need to rebase but have uncommitted changes (e.g., package-lock.json from startup npm install):

1. Stash changes: `git stash push -m "Stash changes before rebase"`
2. Rebase: `git rebase upstream/main` (resolve conflicts if needed)
3. After rebase completes, review stashed changes: `git stash show -p`
4. If stashed changes are spurious (e.g., package-lock.json peer markers when package.json conflicts were resolved during rebase), drop the stash: `git stash drop`
5. Otherwise, pop stash: `git stash pop` and discard spurious changes: `git restore package-lock.json` (if package.json unchanged)

This prevents rebase conflicts from uncommitted changes while preserving any work in progress.

**If stash pop creates a conflict in package-lock.json:** The file will be marked as unmerged. To resolve:

```bash
git reset HEAD package-lock.json && git checkout -- package-lock.json && git stash drop
```

This resets package-lock.json to the rebased HEAD (discarding the stashed version) and drops the stash.

## Resolving documentation rebase conflicts

When rebasing a PR branch that conflicts with upstream documentation changes (e.g., AGENTS.md):

- If upstream has reorganized content (e.g., moved sections to separate `rules/*.md` files), keep upstream's version
- Discard the PR's inline content that conflicts with the new organization
- The PR's documentation changes may need to be re-applied to the new file locations after the rebase

## Resolving package.json engine conflicts

When rebasing causes conflicts in the `engines` field of `package.json` (e.g., node version requirements), accept the incoming change from upstream/main to maintain consistency with the base branch requirements. The same resolution should be applied to the corresponding section in `package-lock.json`.
