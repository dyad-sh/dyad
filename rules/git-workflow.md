# Git Workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/dyad`), then create a PR from the fork to the upstream repo (`dyad-sh/dyad`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`dyad-sh/dyad`) as a last resort.

## Rebase conflict resolution

When rebasing and a file was refactored between branches:

- If HEAD has a refactored file structure (e.g., code moved to separate modules with re-exports) and the incoming commit has the old monolithic structure, **keep the refactored structure from HEAD**.
- Only integrate the functional changes from the incoming commit (e.g., new imports, configuration changes) into the appropriate refactored modules.
- Example: `e2e-tests/helpers/test_helper.ts` was refactored to use re-exports; rebase conflicts should preserve the re-export structure and discard the duplicate inline code from the incoming commit.

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
