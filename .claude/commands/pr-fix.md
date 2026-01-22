# PR Fix

Address review comments and failing checks on a GitHub Pull Request.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Instructions

1. **Determine the PR to work on:**
   - If `$ARGUMENTS` contains a PR number or URL, use that
   - Otherwise, get the current branch's PR using `gh pr view --json number,url,title,body --jq '.'`
   - If no PR is found, inform the user and stop

2. **Fetch all PR review comments:**

   ```
   gh pr view <PR_NUMBER> --json reviews,comments --jq '.'
   gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments
   ```

3. **Analyze the PR comments and identify actionable items:**
   - Look for code review comments that request changes
   - Look for general review comments with feedback
   - Prioritize comments from reviewers that are:
     - Requesting specific code changes
     - Pointing out bugs or issues
     - Suggesting improvements that should be addressed
   - Ignore comments that are:
     - Simple acknowledgments or approvals
     - Questions that have already been answered
     - Nitpicks explicitly marked as optional

4. **Check for failing CI checks:**

   ```
   gh pr checks <PR_NUMBER>
   ```

   Note which checks are failing, particularly Playwright/E2E tests.

5. **For each actionable review comment:**
   - Read the relevant file(s) mentioned in the comment
   - Understand the context and the requested change
   - Make the necessary code changes to address the feedback
   - Keep track of what was changed

6. **If there are failing Playwright/E2E tests:**
   - Check if the failures are snapshot-related by examining the PR comments for Playwright test results
   - If snapshots need updating, run the `/e2e-rebase` skill to fix them
   - If the failures are not snapshot-related, investigate and fix the underlying test issues

7. **After making all changes, verify the fixes:**
   - Run relevant linters: `npm run lint:fix`
   - Run type checks if TypeScript files were modified: `npm run ts`
   - Run any relevant unit tests for modified code

8. **Review all changes made:**

   ```
   git diff
   git status
   ```

   Ensure the changes are reasonable and address the review feedback appropriately.

9. **Commit and push the changes:**
   - Stage all modified files
   - Create a commit with a descriptive message summarizing what was addressed:

     ```
     git add -A
     git commit -m "Address PR review feedback

     - <summary of change 1>
     - <summary of change 2>
     ...

     Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
     git push
     ```

10. **Provide a summary to the user:**
    - List the review comments that were addressed
    - List any failing checks that were fixed
    - Note any comments that were intentionally not addressed and why
    - Mention if any issues could not be resolved and require human attention
