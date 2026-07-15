---
name: dyad:pr-push
description: Publish local work by committing changes, running checks, pushing the branch, and creating or refreshing a GitHub PR with a reviewer-useful description.
---

# PR Push

Use this skill to publish the current work to GitHub. It must complete autonomously and push by the end unless GitHub auth or permissions block the operation.

## Workflow

1. Run `/remember-learnings` first. This captures session learnings before any push or PR creation, so any resulting `AGENTS.md` or `rules/` changes are included in the same publish flow.
2. Decide whether to run unit tests locally before publishing. For broad or cross-cutting changes, run `npm test`. For targeted changes, run the narrowest relevant test command, such as `npm test -- path/to/file.test.ts`. For docs, agent-config, or other low-risk changes, it is acceptable to skip local unit tests because GitHub CI will run the full suite.
3. Review the complete branch diff and commit range against the base branch. Write:
   - A descriptive commit message for newly staged work.
   - A concise PR title describing the user-visible outcome or engineering purpose.
   - A reviewer-useful PR body with a `## Summary` section.

   Start the summary with a 1-2 sentence overview of the purpose and outcome, then add bullets for the decisions that deserve reviewer attention. Focus those bullets on subjective choices, trade-offs, assumptions, intentional exclusions, behavior boundaries, and questions a reviewer should verify. Use as many bullets as the change needs; optimize for helping a reviewer decide whether the approach is right, not for terseness or narrating the diff.

   Do not add a routine `## Testing` section. Report verification commands and results in the final handoff instead. Stay close to the user's original intent, and do not use changed filenames as a summary, merely restate commit subjects, or rely on an automated reviewer to explain the change later.

4. Save the PR body to an ignored file under `.claude/tmp/`, then run the bundled script from the repository root with all three publishing inputs:

   ```bash
   PR_PUSH_COMMIT_MESSAGE="<descriptive commit message>" \
   PR_PUSH_PR_TITLE="<descriptive PR title>" \
   PR_PUSH_PR_BODY_FILE=".claude/tmp/pr-body.md" \
   bash .agents/skills/pr-push/scripts/pr_push.sh
   ```

5. If the script reports a fixable failure, fix it and rerun the script. When fixing issues, do not run `git pull` from fork remotes; only pull from the upstream repo configured by `PR_PUSH_BASE_REPO` (default `dyad-sh/dyad`) if needed. Do not manually replay the full workflow unless the script itself is broken.
6. If the PR already existed, inspect its current title and body after the push. Refresh stale or generic agent-authored text to reflect the complete branch, while preserving human-written notes and sections added by review tools. Do not overwrite the entire body blindly.
7. Summarize the script's final output, including the branch, committed files, ignored files, checks, pushed remote, and PR URL or bot-account PR creation link. Also report the local unit-test decision and any test command that was run.

## Script Behavior

The script handles the mechanical workflow:

- Refuses to push `main`/`master`; creates a feature branch if needed.
- Stages relevant changes while ignoring obvious secrets/artifacts and spurious `package-lock.json` changes without `package.json`.
- Commits changes with a generated message, unless `PR_PUSH_COMMIT_MESSAGE` is set.
- Runs `npm run fmt`, `npm run lint:fix`, and `npm run ts`.
- Does not run unit tests. The agent decides whether to run `npm test` for broad changes or a targeted `npm test -- ...` command for narrow changes; GitHub CI runs the full suite.
- Amends automated formatting/lint changes into the commit it created.
- Pushes to the tracked upstream, an existing PR head remote, or `origin` with the documented fallback behavior.
- Creates the PR against `dyad-sh/dyad:main`, unless the active GitHub account is a bot. Existing PR branches are pushed without blindly overwriting their descriptions.
- Removes `needs-human:review-issue` when a PR exists.

Optional environment overrides:

- `PR_PUSH_COMMIT_MESSAGE`: commit message for newly staged work.
- `PR_PUSH_PR_TITLE`: PR title.
- `PR_PUSH_PR_BODY_FILE`: path to the prepared PR body; required when creating a PR.
- `PR_PUSH_PR_BODY`: inline PR body override; useful when shell quoting is known to be safe.
- `PR_PUSH_BASE_REPO`: default `dyad-sh/dyad`.
- `PR_PUSH_BASE_BRANCH`: default `main`.
- `PR_PUSH_REMOTE`: default fallback remote `origin`.
