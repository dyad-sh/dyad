# Claude-driven GitHub Actions Workflows

Guidelines for the LLM-driven workflows in `.github/workflows/` that invoke `anthropics/claude-code-action` (e.g., `closed-issue-comment.yml`, `claude-triage.yml`, `pr-review-responder.yml`).

## Gate deterministic branching in the workflow, not the prompt

If a workflow's behavior depends on a deterministic check (identity comparisons, label presence, file paths, actor type, etc.), do the check in a workflow-level `if:` condition and split into separate jobs — do not leave it to the prompt.

**Why:** LLMs can conflate branches when the comment/PR body @mentions or describes the "other" party. A prior bug (see `closed-issue-comment.yml` history, dyad-sh/dyad#3228): the prompt told Claude "if COMMENT_AUTHOR == ISSUE_AUTHOR do X, else do Y," but when a maintainer closed an issue with a comment that mentioned `@original-author` and described the symptom, Claude fell into the author branch and re-opened the issue.

**How to apply:**

- Compare `github.event.comment.user.login` vs `github.event.issue.user.login` (and similar) in the job `if:` block, not the prompt.
- When one branch doesn't need judgment (e.g., posting a fixed reply), drop the LLM entirely and use `gh` directly.
- Add `github.event.*.user.type != 'Bot'` to prevent bot-comment loops when the same workflow can be triggered by its own output.
