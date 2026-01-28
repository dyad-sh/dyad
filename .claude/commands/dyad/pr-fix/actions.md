# PR Fix: Actions

Fix failing CI checks and GitHub Actions on a Pull Request.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Instructions

1. **Determine the PR to work on:**
   - If `$ARGUMENTS` contains a PR number or URL, use that
   - Otherwise, get the current branch's PR using `gh pr view --json number,url,title,body --jq '.'`
   - If no PR is found, inform the user and stop

2. **Check for failing CI checks:**

   ```
   gh pr checks <PR_NUMBER>
   ```

   Identify which checks are failing:
   - Lint/formatting checks
   - Type checks
   - Unit tests
   - E2E/Playwright tests
   - Build checks

3. **For failing lint/formatting checks:**
   - Run `npm run lint:fix` to auto-fix lint issues
   - Run `npm run fmt` to fix formatting
   - Review the changes made

4. **For failing type checks:**
   - Run `npm run ts` to identify type errors
   - Read the relevant files and fix the type issues
   - Re-run type checks to verify fixes

5. **For failing unit tests:**
   - Run the failing tests locally to reproduce:
     ```
     npm run test -- <test-file-pattern>
     ```
   - Investigate the test failures
   - Fix the underlying code issues or update tests if the behavior change is intentional

6. **For failing Playwright/E2E tests:**
   - Check if the failures are snapshot-related by examining the CI logs or PR comments
   - If snapshots need updating, run the `/dyad:e2e-rebase` skill to fix them
   - If the failures are not snapshot-related:
     - **IMPORTANT:** First build the application before running E2E tests:
       ```
       npm run build
       ```
       E2E tests run against the built binary. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build` before running E2E tests again.
     - Run the failing tests locally with debug output:
       ```
       DEBUG=pw:browser PLAYWRIGHT_HTML_OPEN=never npm run e2e -- <test-file>
       ```
     - Investigate and fix the underlying issues

7. **For failing build checks:**
   - Run the build locally:
     ```
     npm run build
     ```
   - Fix any build errors that appear

8. **After making all fixes, verify:**
   - Run the full lint check: `npm run lint`
   - Run type checks: `npm run ts`
   - Run relevant unit tests
   - Optionally run E2E tests locally if they were failing

9. **Commit and push the changes:**

   If any changes were made:

   ```
   git add -A
   git commit -m "Fix failing CI checks

   - <summary of fix 1>
   - <summary of fix 2>
   ...

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```

   Then run `/dyad:pr-push` to push the changes.

10. **Provide a summary to the user:**
    - List which checks were failing
    - Describe what was fixed for each
    - Note any checks that could not be fixed and require human attention
