---
name: dyad:multi-pr-review
description: Multi-agent code review system that spawns three independent Claude sub-agents to review PR diffs. Each agent receives files in different randomized order to reduce ordering bias. One agent focuses specifically on code health and maintainability. Issues are classified as high/medium/low severity (sloppy code that hurts maintainability is MEDIUM). After collecting all agent findings, the orchestrator reasons through each issue to validate whether it's a real problem and whether the severity is merited—rather than relying on simple consensus voting. Automatically deduplicates against existing PR comments. Posts a summary with merge confidence verdict (YES/NOT SURE/NO) and low priority issues in a collapsible section.
---

# Multi-Agent PR Review

This skill creates three independent sub-agents to review code changes, then reasons through each finding to validate it and determine the correct severity.

## Overview

1. Fetch PR diff files and existing comments
2. Spawn 3 sub-agents with specialized personas, each receiving files in different randomized order
   - **Correctness Expert**: Bugs, edge cases, control flow, security, error handling
   - **Code Health Expert**: Dead code, duplication, complexity, meaningful comments, abstractions
   - **UX Wizard**: User experience, consistency, accessibility, error states, delight
3. Each agent reviews and classifies issues (high/medium/low criticality)
4. Reason through each reported issue: validate whether it's a real problem, assess if the severity is merited, drop false positives
5. Determine merge confidence verdict (YES / NOT SURE / NO)
6. Filter out issues already commented on (deduplication)
7. Post findings: summary with merge verdict + inline comments for HIGH/MEDIUM issues

## Workflow

### Step 1: Fetch PR Diff

**IMPORTANT:** Always save files to the current working directory (e.g. `./pr_diff.patch`), never to `/tmp/` or other directories outside the repo. In CI, only the repo working directory is accessible.

```bash
# Get changed files from PR (save to current working directory, NOT /tmp/)
gh pr diff <PR_NUMBER> --repo <OWNER/REPO> > ./pr_diff.patch

# Or get list of changed files
gh pr view <PR_NUMBER> --repo <OWNER/REPO> --json files -q '.files[].path'
```

### Step 2: Run Multi-Agent Review

Execute the orchestrator script:

```bash
python3 scripts/orchestrate_review.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --diff-file ./pr_diff.patch
```

The orchestrator:

1. Parses the diff into individual file changes
2. Creates 3 shuffled orderings of the files
3. Spawns 3 parallel sub-agent API calls
4. Collects and aggregates results

### Step 3: Review Prompt Templates

Sub-agents receive role-specific prompts from `references/`:

**Correctness Expert** (`references/correctness-reviewer.md`):

- Focuses on bugs, edge cases, control flow, security, error handling
- Thinks beyond the diff to consider impact on callers and dependent code
- Rates user-impacting bugs as HIGH, potential bugs as MEDIUM

**Code Health Expert** (`references/code-health-reviewer.md`):

- Focuses on dead code, duplication, complexity, meaningful comments, abstractions
- Rates sloppy code that hurts maintainability as MEDIUM severity
- Checks for unused infrastructure (tables/columns no code uses)

**UX Wizard** (`references/ux-reviewer.md`):

- Focuses on user experience, consistency, accessibility, error states
- Reviews from the user's perspective - what will they experience?
- Rates UX issues that confuse or block users as HIGH

```
Severity levels:
HIGH: Security vulnerabilities, data loss risks, crashes, broken functionality, UX blockers
MEDIUM: Logic errors, edge cases, performance issues, sloppy code that hurts maintainability,
        UX issues that degrade the experience
LOW: Minor style issues, nitpicks, minor polish improvements

Output JSON array of issues.
```

### Step 4: Reasoned Validation & Deduplication

After collecting all agent findings, the orchestrator reasons through each reported issue independently. Do NOT rely on simple consensus voting (i.e., "2+ agents agree so it must be real"). Instead:

1. **Merge duplicates**: Group issues from different agents that refer to the same code location and problem.
2. **Validate each issue**: For each unique issue, reason about whether it's a real problem:
   - Is this actually a bug, or is the agent misunderstanding the code?
   - Does the code context (surrounding logic, framework conventions, existing patterns) make this a non-issue?
   - Could this be a false positive from the agent not having full project context?
3. **Assess severity**: For each validated issue, determine if the assigned severity is merited:
   - Is a HIGH really a security vulnerability / data loss / crash, or is it overstated?
   - Is a MEDIUM really impactful, or is it a stylistic preference disguised as a real issue?
   - Downgrade or upgrade severity based on actual impact analysis.
4. **Drop false positives**: Remove issues that don't hold up under scrutiny, even if multiple agents flagged them.

**Deduplication:** Before posting, fetch existing PR comments and filter out issues that have already been commented on (matching by file, line, and issue keywords). This prevents duplicate comments when re-running the review.

### Step 5: Determine Merge Verdict

Based on the validated issues, determine a merge confidence verdict:

- **:white_check_mark: YES - Ready to merge**: No HIGH issues, at most minor MEDIUM issues that are judgment calls
- **:thinking: NOT SURE - Potential issues**: Has MEDIUM issues that should probably be addressed, but none are clear blockers
- **:no_entry: NO - Do NOT merge**: Has HIGH severity issues or multiple serious MEDIUM issues that NEED to be fixed

### Step 6: Post PR Comments

The script posts two types of comments:

1. **Summary comment**: Overview table with issue counts (always posted, even if no new issues)
2. **Inline comments**: Detailed feedback on specific lines (HIGH/MEDIUM only)

```bash
python3 scripts/post_comment.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --results consensus_results.json
```

Options:

- `--dry-run`: Preview comments without posting
- `--summary-only`: Only post summary, skip inline comments

#### Example Summary Comment

```markdown
## :mag: Dyadbot Code Review Summary

**Verdict: :no_entry: NO - Do NOT merge**

Reviewed by 3 specialized agents: Correctness Expert, Code Health Expert, UX Wizard.
Found **4** new issue(s) after reasoned validation.
(2 issue(s) skipped - already commented)

### Summary

| Severity               | Count |
| ---------------------- | ----- |
| :red_circle: HIGH      | 1     |
| :yellow_circle: MEDIUM | 2     |
| :green_circle: LOW     | 1     |

### Issues to Address

| #   | Severity               | File                     | Issue                                    |
| --- | ---------------------- | ------------------------ | ---------------------------------------- |
| 1   | :red_circle: HIGH      | `src/auth/login.ts:45`   | SQL injection in user lookup             |
| 2   | :yellow_circle: MEDIUM | `src/utils/cache.ts:112` | Missing error handling for Redis failure |
| 3   | :yellow_circle: MEDIUM | `src/api/handler.ts:89`  | Confusing control flow - hard to debug   |

<details>
<summary>:green_circle: Low Priority Issues (1 items)</summary>

- **Inconsistent naming convention** - `src/utils/helpers.ts:23`

</details>

<details>
<summary>:no_entry_sign: Dropped Issues (1 items)</summary>

- **~~Potential null pointer~~** - Dropped: Framework guarantees non-null in this context

</details>

See inline comments for details.

_Generated by Dyadbot code review_
```

## File Structure

```
scripts/
  orchestrate_review.py  - Main orchestrator, spawns sub-agents
  validate_results.py    - Reasoned validation logic
  post_comment.py        - Posts findings to GitHub PR
references/
  correctness-reviewer.md - Role description for the correctness expert
  code-health-reviewer.md - Role description for the code health expert
  ux-reviewer.md          - Role description for the UX wizard
  issue_schema.md         - JSON schema for issue output
```

## Configuration

Environment variables:

- `GITHUB_TOKEN` - Required for PR access and commenting

Note: `ANTHROPIC_API_KEY` is **not required** - sub-agents spawned via the Task tool automatically have access to Anthropic.

Optional tuning in `orchestrate_review.py`:

- `NUM_AGENTS` - Number of sub-agents (default: 3)
- `MIN_SEVERITY` - Minimum severity to report (default: MEDIUM)
- `THINKING_BUDGET_TOKENS` - Extended thinking budget (default: 128000)
- `MAX_TOKENS` - Maximum output tokens (default: 128000)

## Extended Thinking

This skill uses **extended thinking (interleaved thinking)** with **max effort** by default. Each sub-agent leverages Claude's extended thinking capability for deeper code analysis:

- **Budget**: 128,000 thinking tokens per agent for thorough reasoning
- **Max output**: 128,000 tokens for comprehensive issue reports

To disable extended thinking (faster but less thorough):

```bash
python3 scripts/orchestrate_review.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --diff-file ./pr_diff.patch \
  --no-thinking
```

To customize thinking budget:

```bash
python3 scripts/orchestrate_review.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --diff-file ./pr_diff.patch \
  --thinking-budget 50000
```
