---
name: coney:multi-pr-review
description: Multi-agent code review system that spawns three independent Claude sub-agents to review PR diffs. Each agent receives files in different randomized order to reduce ordering bias. One agent focuses specifically on code health and maintainability. Issues are validated using reasoned analysis rather than simple vote counting. Reports merge verdict (YES / NOT SURE / NO). Automatically deduplicates against existing PR comments. Always posts a summary (even if no new issues), with low priority issues in a collapsible section.
---

# Multi-Agent PR Review

This skill spawns three independent sub-agents to review code changes from different perspectives, then validates and aggregates their findings through reasoned analysis.

## Overview

1. Fetch PR diff and existing comments
2. Spawn 3 sub-agents with specialized personas using the Task tool
   - Each agent receives files in a different randomized order to reduce ordering bias
   - **Correctness Expert**: Bugs, edge cases, control flow, security, error handling
   - **Code Health Expert**: Dead code, duplication, complexity, meaningful comments, abstractions
   - **UX Wizard**: User experience, consistency, accessibility, error states, delight
3. Each agent reviews and classifies issues (HIGH/MEDIUM/LOW severity)
4. Validate issues using reasoned analysis (not just vote counting)
5. Determine merge verdict based on confirmed issues
6. Filter out issues already commented on (deduplication)
7. Post findings: summary with verdict + inline comments for HIGH/MEDIUM issues

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

**IMPORTANT:** Always save files to the current working directory (e.g. `./pr_diff.patch`), never to `/tmp/` or other directories outside the repo. In CI, only the repo working directory is accessible.

```bash
# Save the diff to current working directory (NOT /tmp/)
gh pr diff <PR_NUMBER> --repo <OWNER/REPO> > ./pr_diff.patch

# Get PR metadata
gh pr view <PR_NUMBER> --repo <OWNER/REPO> --json title,body,files,headRefOid

# Fetch existing comments to avoid duplicates
gh api repos/<OWNER/REPO>/pulls/<PR_NUMBER>/comments --paginate
gh api repos/<OWNER/REPO>/issues/<PR_NUMBER>/comments --paginate
```

Save the diff content and existing comments for use in the review.

### Step 3: Spawn Review Agents in Parallel

Use the `Task` tool to spawn 3 sub-agents **in parallel** (all in a single message with multiple Task tool calls). Each agent should be a `general-purpose` subagent.

**File Ordering**: Before spawning, create 3 different orderings of the changed files (randomize/shuffle the order). Each agent gets the files in a different order to reduce ordering bias (reviewers tend to focus more on files they see first).

**IMPORTANT**: Each agent's prompt must include:

1. Their role description (from the corresponding file in `references/`)
2. The full PR diff content (inline, NOT a file path - agents cannot read files from the parent's context)
3. The list of existing PR comments (so they can avoid flagging already-commented issues)
4. Instructions to output findings as structured JSON

#### Agent Prompt Template

For each agent, the prompt should follow this structure:

````
You are a code reviewer with this specialization:

<role>
[Contents of references/<role>.md - e.g., correctness-reviewer.md]
</role>

You are reviewing PR #<NUMBER> in <REPO>: "<PR TITLE>"

<pr_description>
[PR body/description]
</pr_description>

Here is the diff to review (files presented in a specific order for this review):

<diff>
[Full diff content - with files in THIS agent's randomized order]
</diff>

Here are existing PR comments (do NOT flag issues already commented on):

<existing_comments>
[Existing comment data as JSON]
</existing_comments>

## Instructions

1. Read your role description carefully and review the diff from your expert perspective.
2. For each issue you find, classify it as HIGH, MEDIUM, or LOW severity using the guidelines in your role description.
3. Output your findings as a JSON array with this schema:

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
```

Severity levels:
- HIGH: Security vulnerabilities, data loss risks, crashes, broken functionality, UX blockers
- MEDIUM: Logic errors, edge cases, performance issues, sloppy code that hurts maintainability, UX issues that degrade the experience
- LOW: Minor style issues, nitpicks, minor polish improvements

Be thorough but focused. Only flag real issues, not nitpicks disguised as higher severity issues.

IMPORTANT: Cross-reference infrastructure changes (DB migrations, new tables/columns, API endpoints, config entries) against actual usage in the diff. If a migration creates a table but no code in the PR reads from or writes to it, that's dead infrastructure and should be flagged.

Output ONLY the JSON array, no other text.
````

### Step 4: Collect and Parse Results

Wait for all 3 agents to complete. Parse the JSON array from each agent's response.

### Step 5: Validate Issues with Reasoned Analysis

**Do NOT use simple consensus voting (e.g., "2+ agents agree").** Instead, perform reasoned validation:

For each unique issue found (group similar issues by file + approximate line range):

1. **Evaluate validity**: Is this a real issue or a false positive? Consider:
   - Does the code actually have this problem?
   - Is the reviewer misunderstanding the code's purpose?
   - Is this issue already handled elsewhere in the codebase?

2. **Evaluate severity**: Is the severity rating correct? Consider:
   - What's the actual user/system impact?
   - Is this being over- or under-rated?

3. **Make a decision**:
   - **CONFIRMED**: Issue is valid and severity is appropriate
   - **CONFIRMED (adjusted)**: Issue is valid but severity should be changed
   - **DROPPED**: Issue is a false positive, explain why

Track dropped issues with reasoning for the summary comment.

### Step 6: Determine Merge Verdict

Based on the confirmed issues, determine the verdict:

- **:white_check_mark: YES - Ready to merge**: No HIGH issues, at most minor MEDIUM issues that are judgment calls
- **:thinking: NOT SURE - Potential issues**: Has MEDIUM issues that should probably be addressed, but none are clear blockers
- **:no_entry: NO - Do NOT merge**: Has HIGH severity issues or multiple serious MEDIUM issues that NEED to be fixed

### Step 7: Deduplicate Against Existing Comments

Before posting, filter out issues that match existing PR comments:

- Same file path
- Same or nearby line number (within 3 lines)
- Similar keywords in the issue title appear in the existing comment body

### Step 8: Post GitHub Comments

#### Summary Comment

Post a summary comment on the PR using `gh pr comment`:

```markdown
## :mag: Coneybot Code Review Summary

**Verdict: [VERDICT EMOJI + TEXT]**

Reviewed by 3 independent agents: Correctness Expert, Code Health Expert, UX Wizard.

### Issues Summary

| Severity               | File                  | Issue                  |
| ---------------------- | --------------------- | ---------------------- |
| :red_circle: HIGH      | `src/auth.ts:45`      | SQL injection in login |
| :yellow_circle: MEDIUM | `src/ui/modal.tsx:12` | Missing loading state  |

<details>
<summary>:green_circle: Low Priority Notes (X items)</summary>

- **Minor naming inconsistency** - `src/helpers.ts:23`
- **Could add hover state** - `src/button.tsx:15`

</details>

<details>
<summary>:no_entry_sign: Dropped False Positives (X items)</summary>

- **~~Potential race condition~~** - Dropped: State is only accessed synchronously in this context
- **~~Missing null check~~** - Dropped: Value is guaranteed non-null by the caller's validation

</details>

---

_Generated by Coneybot multi-agent code review_
```

**Always post a summary**, even if no issues are found. In that case:

```markdown
## :mag: Coneybot Code Review Summary

**Verdict: :white_check_mark: YES - Ready to merge**

:white_check_mark: No issues found by multi-agent review.

---

_Generated by Coneybot multi-agent code review_
```

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
  "commit_id": "<HEAD_SHA from PR metadata>",
  "body": "Multi-agent review: X issue(s) found",
  "event": "COMMENT",
  "comments": [
    {
      "path": "src/auth.ts",
      "line": 45,
      "body": "**:red_circle: HIGH** | security\n\n**SQL injection in login**\n\nDescription of the issue...\n\n:bulb: **Suggestion:** Use parameterized queries"
    }
  ]
}
```

## Severity Guidelines

Across all reviewers:

- **HIGH**: Security vulnerabilities, data loss risks, crashes, broken functionality, race conditions, UX blockers
- **MEDIUM**: Logic errors, unhandled edge cases, performance issues, sloppy code that hurts maintainability, poor error messages, missing loading/empty states, accessibility gaps
- **LOW**: Minor style issues, naming nitpicks, optional polish improvements

**Philosophy**: Sloppy code that hurts maintainability is MEDIUM, not LOW. We care about code health.

## File Structure

```
references/
  correctness-reviewer.md  - Role description for the correctness expert
  code-health-reviewer.md  - Role description for the code health expert
  ux-reviewer.md           - Role description for the UX wizard
  issue_schema.md          - JSON schema for issue output
```

## Configuration Notes

- **No Python scripts needed**: This skill executes entirely through Claude Code tools
- **No ANTHROPIC_API_KEY needed**: Sub-agents spawned via Task tool have automatic access
- **GITHUB_TOKEN required**: For PR access and commenting (usually already configured)
