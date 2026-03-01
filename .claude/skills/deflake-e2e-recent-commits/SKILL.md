---
name: coney:deflake-e2e-recent-commits
description: Automatically gather flaky E2E tests from recent CI runs on the main branch and from recent PRs by wwwillchen/wwwillchen-bot, then deflake them.
---

# Deflake E2E Tests from Recent Commits

Automatically gather flaky E2E tests from recent CI runs on the main branch and from recent PRs by wwwillchen/wwwillchen-bot, then deflake them.

## Arguments

- `$ARGUMENTS`: (Optional) Number of recent commits to scan (default: 10)

## Task Tracking

**You MUST use the TodoWrite tool to track your progress.** At the start, create todos for each major step below. Mark each todo as `in_progress` when you start it and `completed` when you finish.

## Instructions

1. **Gather flaky tests from recent CI runs on main:**

   List recent CI workflow runs triggered by pushes to main:

   ```
   gh api "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=<COMMIT_COUNT * 3>&status=completed" --jq '.workflow_runs[] | select(.conclusion == "success" or .conclusion == "failure") | {id, head_sha, conclusion}'
   ```

   **Note:** We fetch 3x the desired commit count because many runs may be `cancelled` (due to concurrency groups). Filter to only `success` and `failure` conclusions to get runs that actually completed and have artifacts.

   Use `$ARGUMENTS` as the commit count, defaulting to 10 if not provided.

   For each completed run, download the `html-report` artifact which contains `results.json` with the full Playwright test results:

   a. Find the html-report artifact for the run:

   ```
   gh api "repos/{owner}/{repo}/actions/runs/<run_id>/artifacts?per_page=30" --jq '.artifacts[] | select(.name | startswith("html-report")) | select(.expired == false) | .name'
   ```

   b. Download it using `gh run download`:

   ```
   gh run download <run_id> --name <artifact_name> --dir /tmp/playwright-report-<run_id>
   ```

   c. Parse `/tmp/playwright-report-<run_id>/results.json` to extract flaky tests. Write a Node.js script inside the `.claude/` directory to do this parsing. Flaky tests are those where the final result status is `"passed"` but a prior result has status `"failed"`, `"timedOut"`, or `"interrupted"`. The test title is built by joining parent suite titles (including the spec file path) and the test title, separated by `>`.

   d. Clean up the downloaded artifact directory after parsing.

   **Note:** Some runs may not have an html-report artifact (e.g., if they were cancelled early, the merge-reports job didn't complete, or artifacts have expired past the 3-day retention period). Skip these runs and continue to the next one.

2. **Gather flaky tests from recent PRs by wwwillchen and wwwillchen-bot:**

   In addition to main branch CI runs, scan recent open PRs authored by `wwwillchen` or `wwwillchen-bot` for flaky tests reported in Playwright report comments.

   a. List recent open PRs by these authors:

   ```
   gh pr list --author wwwillchen --state open --limit 10 --json number,title
   gh pr list --author wwwillchen-bot --state open --limit 10 --json number,title
   ```

   b. For each PR, find the most recent Playwright Test Results comment (posted by a bot, containing "🎭 Playwright Test Results"):

   ```
   gh api "repos/{owner}/{repo}/issues/<pr_number>/comments" --jq '[.[] | select(.user.type == "Bot" and (.body | contains("Playwright Test Results")))] | last'
   ```

   c. Parse the comment body to extract flaky tests. The comment format includes a "⚠️ Flaky Tests" section with test names in backticks:
   - Look for lines matching the pattern: ``- `<test_title>` (passed after N retries)``
   - Extract the test title from within the backticks
   - The test title format is: `<spec_file.spec.ts> > <Suite Name> > <Test Name>`

   d. Add these flaky tests to the overall collection, noting they came from PR #N for the summary

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

   If no flaky tests are found, report "No flaky tests found in recent commits or PRs" and stop.

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
   - Total flaky tests found across main branch commits and PRs
   - Sources of flaky tests (main branch CI runs vs. PR comments from wwwillchen/wwwillchen-bot)
   - Which tests were successfully deflaked
   - What fixes were applied to each
   - Which tests could not be fixed (and why)
   - Verification results

8. **Create PR with fixes:**

   If any fixes were made, run `/coney:pr-push` to commit, lint, test, and push the changes as a PR.

   Use a branch name like `deflake-e2e-<date>` (e.g., `deflake-e2e-2025-01-15`).

   The PR title should be: `fix: deflake E2E tests (<list of spec files>)`
