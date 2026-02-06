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
