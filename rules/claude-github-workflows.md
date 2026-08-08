# Claude-driven GitHub Actions Workflows

Guidelines for the LLM-driven workflows in `.github/workflows/` that invoke `anthropics/claude-code-action` or `anthropics/claude-code-base-action` (e.g., `closed-issue-comment.yml`, `claude-triage.yml`, `claude-pr-review.yml`). Both actions wrap the same `claude` CLI under the hood, so settings/permission behavior is identical between them.

## Gate deterministic branching in the workflow, not the prompt

If a workflow's behavior depends on a deterministic check (identity comparisons, label presence, file paths, actor type, etc.), do the check in a workflow-level `if:` condition and split into separate jobs — do not leave it to the prompt.

**Why:** LLMs can conflate branches when the comment/PR body @mentions or describes the "other" party. A prior bug (see `closed-issue-comment.yml` history, dyad-sh/dyad#3228): the prompt told Claude "if COMMENT_AUTHOR == ISSUE_AUTHOR do X, else do Y," but when a maintainer closed an issue with a comment that mentioned `@original-author` and described the symptom, Claude fell into the author branch and re-opened the issue.

**How to apply:**

- Compare `github.event.comment.user.login` vs `github.event.issue.user.login` (and similar) in the job `if:` block, not the prompt.
- When one branch doesn't need judgment (e.g., posting a fixed reply), drop the LLM entirely and use `gh` directly.
- Add `github.event.*.user.type != 'Bot'` to prevent bot-comment loops when the same workflow can be triggered by its own output.

## Split LLM decisions from credentialed mutations

When a Claude workflow needs write credentials, prefer a two-job shape: the Claude job runs with read-only permissions and uploads a constrained JSON/Markdown artifact, then a separate `needs:` job downloads the artifact, checks out trusted helper scripts from `github.sha`, validates the artifact, creates the GitHub App token, and performs deterministic GitHub mutations.

## Harden the agent's permissions — `.claude/settings.json` merges into CI

Both `claude-code-action` and `claude-code-base-action` read `.claude/settings.json` from the workspace after `actions/checkout`, and the project's file is committed (tracked in git). **`permissions.allow` arrays merge across scopes — they do not replace each other.** From the Claude Code docs: _"Array settings merge across scopes. When the same array-valued setting (such as `permissions.allow`) appears in multiple scopes, the arrays are concatenated and deduplicated, not replaced."_ ([source](https://code.claude.com/docs/en/settings)).

This has two consequences that bite in CI:

1. **The `allowed_tools` action input is additive, not authoritative.** A workflow that sets `allowed_tools: "Read,Glob,Grep,Bash(git log:*)"` still inherits every entry in the project's `.claude/settings.json` — `Bash(git:*)`, `Bash(gh pr create:*)`, `Bash(npm run:*)`, `Bash(rm -f ...)`, etc. The narrow list looks tight but isn't.
2. **For workflows that check out a fork (`pull_request_target` + PR head, or `workflow_run`), the `.claude/settings.json` is attacker-controlled** (modulo any author allowlist). A hostile PR can ship a maximally permissive settings file.

**Why:** the project file is broad on purpose — it exists for local dev, where the developer-in-the-loop and the on-disk permission hooks (`.claude/hooks/`) compensate. CI has neither.

**How to apply** (layered defenses, pick what fits the job):

1. **Skip `actions/checkout` entirely** when the agent doesn't need repo contents (classification, summarization, structured-output jobs). Without checkout, `.claude/settings.json` is never in the workspace.
2. **Strip the file after checkout** when the job does need the repo: add a step `run: rm -f .claude/settings.json .claude/settings.local.json` immediately after `actions/checkout`, before invoking the action. This is the right move for fork checkouts where the file is attacker-controlled.
3. **Pass an inline `settings:` input** with an explicit `deny` list. This merges too, but `deny` beats `allow`, so it's an additional belt-and-suspenders layer. The action's `settings` input accepts a JSON string or a file path. Example for a tool-less classifier:
   ```yaml
   settings: |
     {
       "permissions": {
         "allow": [],
         "deny": ["Bash", "Edit", "Write", "Read", "NotebookEdit", "WebFetch", "WebSearch"]
       }
     }
   ```
4. **For untrusted-input jobs, combine all three.** `closed-issue-comment.yml` is the reference example: no checkout, defensive `rm` tripwire (in case checkout gets re-added), and an inline deny-all `settings:`.

**Verify before merging a new claude-code-action workflow:** mentally compute the effective allowlist as `project .claude/settings.json` ∪ `allowed_tools input` ∪ `inline settings allow`, minus any `deny`. If that union is wider than the job actually needs — especially if the job handles untrusted input or checks out a fork — apply the mitigations above.
