---
name: coney:check-workflows
description: Check GitHub Actions workflow runs from the past day, identify severe or consistent failures, and file an issue if actionable problems are found.
---

# Check Workflows

Check GitHub Actions workflow runs from the past day for severe or consistent failures and file a GitHub issue if actionable problems are found.

## Arguments

- `$ARGUMENTS`: (Optional) Number of hours to look back (default: 24)

## Instructions

### 1. Gather recent workflow runs

Fetch all workflow runs from the past N hours (default 24):

```
gh run list --limit 100 --json workflowName,status,conclusion,event,headBranch,createdAt,databaseId,url,name
```

Filter to only runs created within the lookback window. Group runs by workflow name.

### 2. Classify each failure

For each failed run, determine if it is **expected** or **actionable** by checking these rules:

#### Expected failures (IGNORE these):

1. **Nightly Runner Cleanup**: This workflow intentionally reboots self-hosted macOS runners, which kills the runner process mid-job. It will almost always show as "failed" even when working correctly. **Always skip this workflow entirely.**

2. **Cascading failures from CI**: When the main CI workflow fails, these downstream workflows will also fail because they depend on CI artifacts (e.g. `html-report`, blob reports). This is noise, not an independent problem:
   - Playwright Report Comment (fails with "artifact not found")
   - Upload to Flakiness.io (fails when no flakiness reports exist)
   - Merge PR when ready (skipped/fails when CI hasn't passed)

3. **CLA Assistant**: Failures just mean a contributor hasn't signed the CLA yet. This resolves on its own.

4. **Cancelled runs**: Runs cancelled due to concurrency groups (newer push cancels older run) are normal.

5. **`action_required` / `neutral` conclusions**: Standard GitHub behavior for fork PRs or first-time contributors needing manual approval.

6. **CI failures on non-main branches**: Individual PR CI failures are expected — contributors may have formatting issues, lockfile mismatches, test failures, etc. These are the contributor's responsibility.

7. **Claude Deflake E2E**: This workflow is expected to sometimes have long runs or partial failures as it investigates flaky tests.

#### Actionable failures (FLAG these):

1. **Permission errors**: Workflow can't access secrets, missing `GITHUB_TOKEN`, 403/401 errors on API calls that should be authenticated, `Resource not accessible by integration` errors.

2. **Consistent CI failures on main branch**: If the CI workflow fails on 2+ consecutive pushes to main, something is likely broken. Check if different commits are failing for the same reason.

3. **Infrastructure failures**: Self-hosted runners not coming back online (check if Nightly Runner Cleanup's verify steps are failing), runners consistently unavailable, disk space issues.

4. **Repeated rate limiting**: If GitHub API rate limiting is causing the same workflow to fail across multiple runs (not just a one-off).

5. **Action version issues**: Deprecated or broken GitHub Action versions causing failures.

6. **Workflow configuration errors**: YAML syntax errors, invalid inputs, missing required secrets (distinct from permission issues).

7. **Scheduled workflow failures**: If a scheduled/cron workflow (other than Nightly Runner Cleanup) fails consistently, it likely indicates a systemic issue.

### 3. Investigate actionable failures

For each potentially actionable failure, get more details:

```
gh run view <run_id> --log-failed 2>/dev/null | head -100
```

Look for:

- The specific error message
- Whether the failure is in a setup step (infrastructure) vs. a test/build step (code)
- Whether the same failure appears across multiple runs

### 4. Determine severity

After investigation, categorize actionable failures:

- **SEVERE**: Permission errors, infrastructure down, main branch consistently broken, workflow configuration errors
- **MODERATE**: Repeated rate limiting, deprecated action warnings, intermittent infrastructure issues
- **LOW**: One-off transient failures that resolved on retry

Only proceed to file an issue if there are SEVERE or MODERATE findings.

### 5. Check for existing issues

Before creating a new issue, check if there's already an open issue about workflow problems:

```
gh issue list --label "workflow-health" --state open --json number,title,body
```

If an existing issue covers the same problems, do not create a duplicate. Instead, add a comment to the existing issue with the latest findings.

### 6. File a GitHub issue

If there are actionable findings (SEVERE or MODERATE), create a GitHub issue:

```
gh issue create --title "Workflow issues: <X>, <Y>, and <Z>" --label "workflow-health" --body "$(cat <<'EOF'
## Workflow Health Report

**Period:** <start_time> to <end_time>
**Total runs checked:** <N>
**Failures found:** <N actionable> actionable, <N expected> expected (ignored)

## Issues Found

### <Issue 1 Title>
- **Workflow:** <workflow name>
- **Severity:** SEVERE / MODERATE
- **Failed runs:**
  - [Run #<id>](<url>) — <date>
  - [Run #<id>](<url>) — <date>
- **Error:** <brief error description>
- **Suggested fix:** <how to resolve>

### <Issue 2 Title>
...

## Expected Failures (Ignored)
<Brief summary of expected failures that were skipped and why>

---
*This issue was automatically created by the daily workflow health check.*
EOF
)"
```

The issue title should list the specific problems found (e.g., "Workflow issues: CI permissions error, flakiness upload rate-limited"). Keep it concise but descriptive.

### 7. Report results

Summarize:

- How many workflow runs were checked
- How many were expected failures (and which categories)
- How many were actionable (and what was found)
- Whether an issue was filed (with link) or if everything looks healthy
- If no actionable issues were found, report "All workflows healthy" and do not create an issue
