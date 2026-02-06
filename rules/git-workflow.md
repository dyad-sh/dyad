# Git Workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/dyad`), then create a PR from the fork to the upstream repo (`dyad-sh/dyad`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`dyad-sh/dyad`) as a last resort.

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

## Adding labels to PRs

`gh pr edit --add-label` fails with a GraphQL "Projects (classic)" deprecation error on repos that had classic projects. Use the REST API instead:

```bash
gh api repos/dyad-sh/dyad/issues/{PR_NUMBER}/labels -f "labels[]=label-name"
```

## CI file access (claude-code-action)

In CI, `claude-code-action` restricts file access to the repo working directory (e.g., `/home/runner/work/dyad/dyad`). Skills that save intermediate files (like PR diffs) must use `./filename` (current working directory), **never** `/tmp/`. Using `/tmp/` causes errors like: `cat in '/tmp/pr_*_diff.patch' was blocked. For security, Claude Code may only concatenate files from the allowed working directories`.

## Rebase conflict resolution tips

- **Before rebasing:** If `npm install` modified `package-lock.json` (common in CI/local), discard changes with `git restore package-lock.json` to avoid "unstaged changes" errors
- When resolving import conflicts (e.g., `<<<<<<< HEAD` with different imports), keep **both** imports if both are valid and needed by the component
- When resolving conflicts in i18n-related commits, watch for duplicate constant definitions that conflict with imports from `@/lib/schemas` (e.g., `DEFAULT_ZOOM_LEVEL`)
- If both sides of a conflict have valid imports/hooks, keep both and remove any duplicate constant redefinitions
- When rebasing documentation/table conflicts (e.g., workflow README tables), prefer keeping **both** additions from HEAD and upstream - merge new rows/content from both branches rather than choosing one side

## Rebasing with uncommitted changes

If you need to rebase but have uncommitted changes (e.g., package-lock.json from startup npm install):

1. Stash changes: `git stash push -m "Stash changes before rebase"`
2. Rebase: `git rebase upstream/main` (resolve conflicts if needed)
3. Pop stash: `git stash pop`
4. Discard spurious changes like package-lock.json (if package.json unchanged): `git restore package-lock.json`

This prevents rebase conflicts from uncommitted changes while preserving any work in progress.

## Resolving documentation rebase conflicts

When rebasing a PR branch that conflicts with upstream documentation changes (e.g., AGENTS.md):

- If upstream has reorganized content (e.g., moved sections to separate `rules/*.md` files), keep upstream's version
- Discard the PR's inline content that conflicts with the new organization
- The PR's documentation changes may need to be re-applied to the new file locations after the rebase
