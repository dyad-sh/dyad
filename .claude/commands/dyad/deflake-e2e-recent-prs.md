# Deflake E2E Tests from Recent PRs

Automatically gather flaky E2E tests from recent PR Playwright summary comments and deflake them.

## Arguments

- `$ARGUMENTS`: (Optional) Number of recent PRs to scan (default: 20)

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each major step below. Mark each task as `in_progress` when you start it and `completed` when you finish.

## Instructions

1. **Gather flaky tests from recent PRs:**

   Use `gh` to find recent PRs that have Playwright summary comments (search for PRs with `github-actions[bot]` Playwright comments):

   ```
   gh pr list --search 'commenter:github-actions[bot] "Playwright Test Results" in:comments' --state all --limit <PR_COUNT> --json number
   ```

   Use `$ARGUMENTS` as the PR count, defaulting to 20 if not provided.

   For each PR, fetch comments from `github-actions[bot]` that contain the Playwright test results.

   **Note:** `{owner}` and `{repo}` are auto-replaced by `gh` CLI. Replace `<pr_number>` with the actual PR number.

   ```
   gh api repos/{owner}/{repo}/issues/<pr_number>/comments --paginate --jq '.[] | select(.user.login == "github-actions[bot]") | select(.body | contains("Playwright Test Results")) | .body'
   ```

2. **Parse flaky tests from comments:**

   Extract flaky test names from the "Flaky Tests" section of each comment. Flaky tests appear in this format:

   ```
   - `<spec_file.spec.ts> > <test name>` (passed after N retry/retries)
   ```

   Parse each line with this pattern to extract the spec file and test name. The spec file is everything before the first `>`.

3. **Deduplicate and rank by frequency:**

   Count how many times each test appears as flaky across all PRs. Sort by frequency (most flaky first). Group tests by their spec file.

   Print a summary table:

   ```
   Flaky test summary:
   - setup_flow.spec.ts > Setup Flow > setup banner shows correct state... (7 occurrences)
   - select_component.spec.ts > select component next.js (5 occurrences)
   ...
   ```

4. **Skip if no flaky tests found:**

   If no flaky tests are found, report "No flaky tests found in recent PRs" and stop.

5. **Install dependencies and build:**

   ```
   npm install
   npm run build
   ```

   **IMPORTANT:** This build step is required before running E2E tests. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build`.

6. **Deflake each flaky test spec file (sequentially):**

   For each unique spec file that has flaky tests (ordered by total flaky occurrences, most flaky first):

   a. Run the spec file 10 times to confirm flakiness (note: `<spec_file>` already includes the `.spec.ts` extension from parsing):

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --repeat-each=10
   ```

   b. If the test passes all 10 runs, skip it (it may have been fixed already).

   c. If the test fails at least once, investigate with debug logs:

   ```
   DEBUG=pw:browser PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file>
   ```

   d. Fix the flaky test following Playwright best practices:
   - Use `await expect(locator).toBeVisible()` before interacting with elements
   - Use `await page.waitForLoadState('networkidle')` for network-dependent tests
   - Use stable selectors (data-testid, role, text) instead of fragile CSS selectors
   - Add explicit waits for animations: `await page.waitForTimeout(300)` (use sparingly)
   - Use `await expect(locator).toHaveScreenshot()` options like `maxDiffPixelRatio` for visual tests
   - Ensure proper test isolation (clean state before/after tests)

   **IMPORTANT:** Do NOT change any application code. Only modify test files and snapshot baselines.

   e. Update snapshot baselines if needed:

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --update-snapshots
   ```

   f. Verify the fix by running 10 times again:

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --repeat-each=10
   ```

   g. If the test still fails after your fix attempt, revert any changes to that spec file and move on to the next one. Do not spend more than 2 attempts fixing a single spec file.

7. **Summarize results:**

   Report:
   - Total flaky tests found across PRs
   - Which tests were successfully deflaked
   - What fixes were applied to each
   - Which tests could not be fixed (and why)
   - Verification results

8. **Create PR with fixes:**

   If any fixes were made, run `/dyad:pr-push` to commit, lint, test, and push the changes as a PR.

   Use a branch name like `deflake-e2e-<date>` (e.g., `deflake-e2e-2025-01-15`).

   The PR title should be: `fix: deflake E2E tests (<list of spec files>)`
