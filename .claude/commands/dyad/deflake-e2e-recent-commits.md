# Deflake E2E Tests from Recent Commits

Automatically gather flaky E2E tests from recent CI runs on the main branch and deflake them.

## Arguments

- `$ARGUMENTS`: (Optional) Number of recent commits to scan (default: 10)

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each major step below. Mark each task as `in_progress` when you start it and `completed` when you finish.

## Instructions

1. **Gather flaky tests from recent CI runs on main:**

   List recent CI workflow runs triggered by pushes to main:

   ```
   gh api "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=<COMMIT_COUNT>&status=completed" --jq '.workflow_runs[] | {id, head_sha, conclusion}'
   ```

   Use `$ARGUMENTS` as the commit count, defaulting to 10 if not provided.

   For each completed run, download the `html-report` artifact which contains `results.json` with the full Playwright test results:

   a. Find the html-report artifact for the run:

   ```
   gh api "repos/{owner}/{repo}/actions/runs/<run_id>/artifacts?per_page=30" --jq '.artifacts[] | select(.name | startswith("html-report")) | .name'
   ```

   b. Download it using `gh run download`:

   ```
   gh run download <run_id> --name <artifact_name> --dir /tmp/playwright-report-<run_id>
   ```

   c. Parse `/tmp/playwright-report-<run_id>/results.json` to extract flaky tests. Write a Python script inside the `.claude/` directory to do this parsing. Flaky tests are those where the final result status is `"passed"` but a prior result has status `"failed"`, `"timedOut"`, or `"interrupted"`. The test title is built by joining parent suite titles with `>` separators plus the spec title.

   d. Clean up the downloaded artifact directory after parsing.

   **Note:** Some runs may not have an html-report artifact (e.g., if they were cancelled early or the merge-reports job didn't complete). Skip these runs.

2. **Parse flaky tests from results:**

   From each `results.json`, extract flaky test names. A test is flaky if:
   - It has multiple results (retries occurred)
   - The final result status is `"passed"`
   - At least one prior result has status `"failed"`, `"timedOut"`, or `"interrupted"`

   The test title format is: `<spec_file.spec.ts> > <Suite Name> > <Test Name>`

   Parse each title to extract the spec file (everything before the first `>`).

3. **Deduplicate and rank by frequency:**

   Count how many times each test appears as flaky across all CI runs. Sort by frequency (most flaky first). Group tests by their spec file.

   Print a summary table:

   ```
   Flaky test summary:
   - setup_flow.spec.ts > Setup Flow > setup banner shows correct state... (7 occurrences)
   - select_component.spec.ts > select component next.js (5 occurrences)
   ...
   ```

4. **Skip if no flaky tests found:**

   If no flaky tests are found, report "No flaky tests found in recent commits" and stop.

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
   PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --repeat-each=10
   ```

   **IMPORTANT:** `PLAYWRIGHT_RETRIES=0` is required to disable automatic retries. Without it, CI environments (where `CI=true`) default to 2 retries, causing flaky tests to pass on retry and be incorrectly skipped.

   b. If the test passes all 10 runs, skip it (it may have been fixed already).

   c. If the test fails at least once, investigate with debug logs:

   ```
   DEBUG=pw:browser PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file>
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
   PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --update-snapshots
   ```

   f. Verify the fix by running 10 times again:

   ```
   PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec_file> --repeat-each=10
   ```

   g. If the test still fails after your fix attempt, revert any changes to that spec file and move on to the next one. Do not spend more than 2 attempts fixing a single spec file.

7. **Summarize results:**

   Report:
   - Total flaky tests found across commits
   - Which tests were successfully deflaked
   - What fixes were applied to each
   - Which tests could not be fixed (and why)
   - Verification results

8. **Create PR with fixes:**

   If any fixes were made, run `/dyad:pr-push` to commit, lint, test, and push the changes as a PR.

   Use a branch name like `deflake-e2e-<date>` (e.g., `deflake-e2e-2025-01-15`).

   The PR title should be: `fix: deflake E2E tests (<list of spec files>)`
