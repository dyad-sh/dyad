---
name: dyad:swarm-pr-review
description: Team-based PR review using Claude Code swarm. Spawns three specialized teammates (correctness expert, code health expert, UX wizard) who review the PR diff, discuss findings with each other, and reach consensus on real issues. Posts a summary with merge verdict and inline comments for HIGH/MEDIUM issues.
---

# Swarm PR Review

This skill uses Claude Code's agent team (swarm) functionality to perform a collaborative PR review with three specialized reviewers who discuss and reach consensus.

## Overview

1. Fetch PR diff and existing comments
2. Create a review team with 3 specialized teammates
3. Each teammate reviews the diff from their expert perspective
4. Teammates discuss findings to reach consensus on real issues
5. Team lead compiles final review with merge verdict
6. Post summary comment + inline comments to GitHub

## Team Members

| Name                   | Role                           | Focus                                                                 |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `correctness-reviewer` | Correctness & Debugging Expert | Bugs, edge cases, control flow, security, error handling              |
| `code-health-reviewer` | Code Health Expert             | Dead code, duplication, complexity, meaningful comments, abstractions |
| `ux-reviewer`          | UX Wizard                      | User experience, consistency, accessibility, error states, delight    |

## Workflow

### Step 1: Determine PR Number and Repo

Parse the PR number and repo from the user's input. If not provided, try to infer from the current git context:

```bash
# Get current repo
gh repo view --json nameWithOwner -q '.nameWithOwner'

# If user provides a PR URL, extract the number
# If user just says "review this PR", check for current branch PR
gh pr view --json number -q '.number'
```

### Step 2: Fetch PR Diff and Context

```bash
# Save the diff to scratchpad
gh pr diff <PR_NUMBER> --repo <OWNER/REPO> > $SCRATCHPAD/pr_diff.patch

# Get PR metadata
gh pr view <PR_NUMBER> --repo <OWNER/REPO> --json title,body,files,headRefOid

# Fetch existing comments to avoid duplicates
gh api repos/<OWNER/REPO>/pulls/<PR_NUMBER>/comments --paginate
gh api repos/<OWNER/REPO>/issues/<PR_NUMBER>/comments --paginate
```

Save the diff content and existing comments for use in the review.

### Step 3: Create the Review Team

Use `TeamCreate` to create the team:

```
TeamCreate:
  team_name: "pr-review-<PR_NUMBER>"
  description: "Code review for PR #<PR_NUMBER>"
```

### Step 4: Create Review Tasks

Create 4 tasks:

1. **"Review PR for correctness issues"** - Assigned to correctness-reviewer
2. **"Review PR for code health issues"** - Assigned to code-health-reviewer
3. **"Review PR for UX issues"** - Assigned to ux-reviewer
4. **"Discuss and reach consensus on findings"** - Blocked by tasks 1-3, no owner (team-wide)

### Step 5: Spawn Teammates

Spawn all 3 teammates in parallel using the `Task` tool with `team_name` set to the team name. Each teammate should be a `general-purpose` subagent.

**IMPORTANT**: Each teammate's prompt must include:

1. Their role description (from the corresponding file in `references/`)
2. The full PR diff content (inline, NOT a file path - teammates cannot read files from the team lead's scratchpad)
3. The list of existing PR comments (so they can avoid duplicates)
4. Instructions to send their findings back as a structured message

#### Teammate Prompt Template

For each teammate, the prompt should follow this structure:

````
You are the [ROLE NAME] on a PR review team. Read your role description carefully:

<role>
[Contents of references/<role>.md]
</role>

You are reviewing PR #<NUMBER> in <REPO>: "<PR TITLE>"

<pr_description>
[PR body/description]
</pr_description>

Here is the diff to review:

<diff>
[Full diff content]
</diff>

Here are existing PR comments (do NOT flag issues already commented on):

<existing_comments>
[Existing comment data]
</existing_comments>

## Instructions

1. Read your role description carefully and review the diff from your expert perspective.
2. For each issue you find, classify it as HIGH, MEDIUM, or LOW severity using the guidelines in your role description.
3. Send your findings to the team lead using SendMessage with this format:

FINDINGS:
```json
[
  {
    "file": "path/to/file.ts",
    "line_start": 42,
    "line_end": 45,
    "severity": "MEDIUM",
    "category": "category-name",
    "title": "Brief title",
    "description": "Clear description of the issue and its impact",
    "suggestion": "How to fix (optional)"
  }
]
````

4. After sending your initial findings, wait for the team lead to share other reviewers' findings.
5. When you receive other reviewers' findings, discuss them:
   - ENDORSE issues you agree with (even if you missed them)
   - CHALLENGE issues you think are false positives or wrong severity
   - ADD context from your expertise that strengthens or weakens an issue
6. Send your discussion responses to the team lead.

Be thorough but focused. Only flag real issues, not nitpicks disguised as issues.

IMPORTANT: Cross-reference infrastructure changes (DB migrations, new tables/columns, API endpoints, config entries) against actual usage in the diff. If a migration creates a table but no code in the PR reads from or writes to it, that's dead infrastructure and should be flagged.

```

### Step 6: Collect Initial Reviews

Wait for all 3 teammates to send their initial findings. Parse the JSON from each teammate's message.

### Step 7: Facilitate Discussion

Once all initial reviews are in:

1. Send each teammate a message with ALL findings from all reviewers (labeled by who found them)
2. Ask them to discuss: endorse, challenge, or add context
3. Wait for discussion responses

The message to each teammate should look like:

```

All initial reviews are in. Here are the findings from all three reviewers:

## Correctness Reviewer Findings:

[list of issues]

## Code Health Reviewer Findings:

[list of issues]

## UX Reviewer Findings:

[list of issues]

Please review the other reviewers' findings from YOUR expert perspective:

- ENDORSE issues you agree are real problems (say "ENDORSE: <title> - <reason>")
- CHALLENGE issues you think are false positives or mis-classified (say "CHALLENGE: <title> - <reason>")
- If you have additional context that changes the severity, explain why

Focus on issues where your expertise adds value. You don't need to comment on every issue.

````

### Step 8: Compile Consensus

After discussion, compile the final issue list:

**Issue Classification Rules:**
- An issue is **confirmed** if the original reporter + at least 1 other reviewer endorses it (or nobody challenges it)
- An issue is **dropped** if challenged by 2 reviewers with valid reasoning
- An issue is **downgraded** if challenged on severity with good reasoning
- HIGH/MEDIUM issues get individual inline comments
- LOW issues go in a collapsible details section in the summary

### Step 9: Determine Merge Verdict

Based on the confirmed issues:

- **:white_check_mark: YES - Ready to merge**: No HIGH issues, at most minor MEDIUM issues that are judgment calls
- **:thinking: NOT SURE - Potential issues**: Has MEDIUM issues that should probably be addressed, but none are clear blockers
- **:no_entry: NO - Do NOT merge**: Has HIGH severity issues or multiple serious MEDIUM issues that NEED to be fixed

### Step 10: Post GitHub Comments

#### Summary Comment

Post a summary comment on the PR using `gh pr comment`:

```markdown
## :mag: Swarm Code Review

**Verdict: [VERDICT EMOJI + TEXT]**

Reviewed by 3 specialized agents: Correctness Expert, Code Health Expert, UX Wizard.

### Issues Summary

| # | Severity | File | Issue | Found By | Endorsed By |
|---|----------|------|-------|----------|-------------|
| 1 | :red_circle: HIGH | `src/auth.ts:45` | SQL injection in login | Correctness | Code Health |
| 2 | :yellow_circle: MEDIUM | `src/ui/modal.tsx:12` | Missing loading state | UX | Correctness |
| 3 | :yellow_circle: MEDIUM | `src/utils.ts:89` | Duplicated validation logic | Code Health | - |

<details>
<summary>:green_circle: Low Priority Notes (X items)</summary>

- **Minor naming inconsistency** - `src/helpers.ts:23` (Code Health)
- **Could add hover state** - `src/button.tsx:15` (UX)

</details>

<details>
<summary>:no_entry_sign: Dropped Issues (X items)</summary>

- **~~Potential race condition~~** - Challenged by Code Health: "State is only accessed synchronously in this context"

</details>

---
*Generated by swarm code review — 3 agents collaborated on this review*
````

#### Inline Comments

For each HIGH and MEDIUM issue, post an inline review comment at the relevant line using `gh api`:

```bash
# Post a review with inline comments
gh api repos/<OWNER/REPO>/pulls/<PR_NUMBER>/reviews \
  -X POST \
  --input payload.json
```

Where payload.json contains:

```json
{
  "commit_id": "<HEAD_SHA>",
  "body": "Swarm review: X issue(s) found",
  "event": "COMMENT",
  "comments": [
    {
      "path": "src/auth.ts",
      "line": 45,
      "body": "**:red_circle: HIGH** | security | Found by: Correctness, Endorsed by: Code Health\n\n**SQL injection in login**\n\nDescription of the issue...\n\n:bulb: **Suggestion:** Use parameterized queries"
    }
  ]
}
```

### Step 11: Shutdown Team

After posting comments:

1. Send shutdown requests to all teammates
2. Wait for shutdown confirmations
3. Delete the team with TeamDelete

## Deduplication

Before posting, filter out issues that match existing PR comments:

- Same file path
- Same or nearby line number (within 3 lines)
- Similar keywords in the issue title appear in the existing comment body

## Error Handling

- If a teammate fails to respond, proceed with the other reviewers' findings
- If no issues are found by anyone, post a clean summary: ":white_check_mark: No issues found"
- If discussion reveals all issues are false positives, still post the summary noting the review was clean
- Always post a summary comment, even if there are no issues
- Always shut down the team when done, even if there were errors

## File Structure

```
references/
  correctness-reviewer.md  - Role description for the correctness expert
  code-health-reviewer.md  - Role description for the code health expert
  ux-reviewer.md           - Role description for the UX wizard
```
