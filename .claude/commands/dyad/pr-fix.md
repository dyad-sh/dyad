# PR Fix

Address all outstanding issues on a GitHub Pull Request by handling both review comments and failing CI checks.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Instructions

This is a meta-skill that orchestrates two sub-skills to comprehensively fix PR issues.

1. **Run `/dyad:pr-fix:comments`** to handle all unresolved review comments:
   - Address valid code review concerns
   - Resolve invalid concerns with explanations
   - Flag ambiguous issues for human attention

2. **Run `/dyad:pr-fix:actions`** to handle failing CI checks:
   - Fix failing tests (unit and E2E)
   - Update snapshots if needed
   - Ensure all checks pass

3. **Post Summary Comment:**
   After both sub-skills complete, post a comment on the PR with a consolidated summary using `gh pr comment`. The comment should include:
   - A header indicating success (✅) or failure (❌)
   - Review comments addressed, resolved, or flagged
   - CI checks that were fixed
   - Any remaining issues requiring human attention
   - Use `<details>` tags to collapse verbose details (e.g., full error messages, lengthy explanations)
   - If there were any errors, include specific error messages in the collapsed details

   Example format:

   ```
   ## ✅ Claude Code completed successfully

   ### Summary
   - Fixed 2 review comments
   - Resolved 1 CI failure (lint error in `src/foo.ts`)

   <details>
   <summary>Details</summary>

   ... detailed information here ...

   </details>

   ---
   [Workflow run](https://github.com/dyad-sh/dyad/actions/runs/12345678)
   ```

   Note: Include a link to the workflow run at the end. Use the `GITHUB_REPOSITORY` and `GITHUB_RUN_ID` environment variables to construct the URL: `https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID`
