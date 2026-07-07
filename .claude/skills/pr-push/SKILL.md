---
name: dyad:pr-push
description: Fast script-driven workflow to commit uncommitted changes, run checks, push the branch, and create or update a GitHub PR.
---

# PR Push

Use this skill to publish the current work to GitHub. It must complete autonomously and push by the end unless GitHub auth or permissions block the operation.

## Workflow

1. Run `/remember-learnings` first. This captures session learnings before any push or PR creation, so any resulting `AGENTS.md` or `rules/` changes are included in the same publish flow.
2. Run the bundled script from the repository root. Set `PR_PUSH_COMMIT_MESSAGE` to a descriptive commit message for the work being published:

   ```bash
   PR_PUSH_COMMIT_MESSAGE="<descriptive commit message>" bash .claude/skills/pr-push/scripts/pr_push.sh
   ```

3. If the script reports a fixable failure, fix it and rerun the script. When fixing issues, do not run `git pull` from fork remotes; only pull from the upstream repo configured by `PR_PUSH_BASE_REPO` (default `dyad-sh/dyad`) if needed. Do not manually replay the full workflow unless the script itself is broken.
4. Summarize the script's final output, including the branch, committed files, ignored files, checks, pushed remote, and PR URL or bot-account PR creation link.

## Script Behavior

The script handles the mechanical workflow:

- Refuses to push `main`/`master`; creates a feature branch if needed.
- Stages relevant changes while ignoring obvious secrets/artifacts and spurious `package-lock.json` changes without `package.json`.
- Commits changes with a generated message, unless `PR_PUSH_COMMIT_MESSAGE` is set.
- Runs `npm run fmt`, `npm run lint:fix`, `npm run ts`, and `npm test`.
- Amends automated formatting/lint changes into the commit it created.
- Pushes to the tracked upstream, an existing PR head remote, or `origin` with the documented fallback behavior.
- Creates or updates the PR against `dyad-sh/dyad:main`, unless the active GitHub account is a bot.
- Removes `needs-human:review-issue` when a PR exists.

Optional environment overrides:

- `PR_PUSH_COMMIT_MESSAGE`: commit message for newly staged work.
- `PR_PUSH_PR_TITLE`: PR title.
- `PR_PUSH_PR_BODY`: PR body.
- `PR_PUSH_BASE_REPO`: default `dyad-sh/dyad`.
- `PR_PUSH_BASE_BRANCH`: default `main`.
- `PR_PUSH_REMOTE`: default fallback remote `origin`.
