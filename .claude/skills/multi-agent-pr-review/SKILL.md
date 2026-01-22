---
name: multi-agent-pr-review
description: Multi-agent code review system that spawns three independent Claude sub-agents to review PR diffs. Each agent receives files in different randomized order to reduce ordering bias. Issues are classified as high/medium/low criticality. Results are aggregated using consensus voting - only issues flagged by 2+ agents as medium or higher criticality are reported and posted as PR comments. Use when reviewing PRs, performing code review with multiple perspectives, or when consensus-based issue detection is needed.
---

# Multi-Agent PR Review

This skill creates three independent sub-agents to review code changes, then aggregates their findings using consensus voting.

## Overview

1. Fetch PR diff files
2. Spawn 3 sub-agents, each receiving files in different randomized order
3. Each agent reviews and classifies issues (high/medium/low criticality)
4. Aggregate results: report issues where 2+ agents agree on medium+ severity
5. Post consensus findings as PR comment

## Workflow

### Step 1: Fetch PR Diff

```bash
# Get changed files from PR
gh pr diff <PR_NUMBER> --repo <OWNER/REPO> > pr_diff.patch

# Or get list of changed files
gh pr view <PR_NUMBER> --repo <OWNER/REPO> --json files -q '.files[].path'
```

### Step 2: Run Multi-Agent Review

Execute the orchestrator script:

```bash
python3 scripts/orchestrate_review.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --diff-file pr_diff.patch
```

The orchestrator:

1. Parses the diff into individual file changes
2. Creates 3 shuffled orderings of the files
3. Spawns 3 parallel sub-agent API calls
4. Collects and aggregates results

### Step 3: Review Prompt Template

Each sub-agent receives this prompt (see `references/review_prompt.md`):

```
Review these code changes for correctness issues. For each issue found:
1. Identify the file and line(s)
2. Describe the issue
3. Classify criticality: HIGH / MEDIUM / LOW

HIGH: Security vulnerabilities, data loss risks, crashes, broken core functionality
MEDIUM: Logic errors, edge cases, performance issues, maintainability concerns
LOW: Style issues, minor improvements, documentation gaps

Output JSON array of issues.
```

### Step 4: Consensus Aggregation

Issues are matched across agents by file + approximate line range + issue type. An issue is reported only if:

- 2+ agents identified it AND
- At least one agent rated it MEDIUM or higher

### Step 5: Post PR Comment

```bash
python3 scripts/post_comment.py \
  --pr-number <PR_NUMBER> \
  --repo <OWNER/REPO> \
  --results consensus_results.json
```

## File Structure

```
scripts/
  orchestrate_review.py  - Main orchestrator, spawns sub-agents
  aggregate_results.py   - Consensus voting logic
  post_comment.py        - Posts findings to GitHub PR
references/
  review_prompt.md       - Sub-agent review prompt template
  issue_schema.md        - JSON schema for issue output
```

## Configuration

Environment variables:

- `ANTHROPIC_API_KEY` - Required for sub-agent API calls
- `GITHUB_TOKEN` - Required for PR access and commenting

Optional tuning in `orchestrate_review.py`:

- `NUM_AGENTS` - Number of sub-agents (default: 3)
- `CONSENSUS_THRESHOLD` - Min agents to agree (default: 2)
- `MIN_SEVERITY` - Minimum severity to report (default: MEDIUM)
