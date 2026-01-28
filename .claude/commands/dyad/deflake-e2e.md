# Deflake E2E Tests

Identify and fix flaky E2E tests by running them repeatedly and investigating failures.

## Arguments

- `$ARGUMENTS`: (Optional) Specific E2E test file(s) to deflake (e.g., `main.spec.ts` or `e2e-tests/main.spec.ts`). If not provided, will prompt to deflake the entire test suite.

## Instructions

1. **Check if specific tests are provided:**

   If `$ARGUMENTS` is empty or not provided, ask the user:

   > "No specific tests provided. Do you want to deflake the entire E2E test suite? This can take a very long time as each test will be run 10 times."

   Wait for user confirmation before proceeding. If they decline, ask them to provide specific test files.

2. **Install dependencies:**

   ```
   npm install
   ```

3. **Build the app binary:**

   ```
   npm run build
   ```

   **IMPORTANT:** This step is required before running E2E tests. E2E tests run against the built binary. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build` before running E2E tests again, otherwise you'll be testing the old version.

4. **Run tests repeatedly to detect flakiness:**

   For each test file, run it 10 times:

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<testfile>.spec.ts --repeat-each=10
   ```

   Notes:
   - If `$ARGUMENTS` is provided without the `e2e-tests/` prefix, add it
   - If `$ARGUMENTS` is provided without the `.spec.ts` suffix, add it
   - A test is considered **flaky** if it fails at least once out of 10 runs

5. **For each flaky test, investigate with debug logs:**

   Run the failing test with Playwright browser debugging enabled:

   ```
   DEBUG=pw:browser PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<testfile>.spec.ts
   ```

   Analyze the debug output to understand:
   - Timing issues (race conditions, elements not ready)
   - Animation/transition interference
   - Network timing variability
   - State leaking between tests
   - Snapshot comparison differences

6. **Fix the flaky test:**

   Common fixes following Playwright best practices:
   - Use `await expect(locator).toBeVisible()` before interacting with elements
   - Use `await page.waitForLoadState('networkidle')` for network-dependent tests
   - Use stable selectors (data-testid, role, text) instead of fragile CSS selectors
   - Add explicit waits for animations: `await page.waitForTimeout(300)` (use sparingly)
   - Use `await expect(locator).toHaveScreenshot()` options like `maxDiffPixelRatio` for visual tests
   - Ensure proper test isolation (clean state before/after tests)

   **IMPORTANT:** Do NOT change any application code. Assume the application code is correct. Only modify test files and snapshot baselines.

7. **Update snapshot baselines if needed:**

   If the flakiness is due to legitimate visual differences:

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<testfile>.spec.ts --update-snapshots
   ```

8. **Verify the fix:**

   Re-run the test 10 times to confirm it's no longer flaky:

   ```
   PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<testfile>.spec.ts --repeat-each=10
   ```

   The test should pass all 10 runs consistently.

9. **Summarize results:**

   Report to the user:
   - Which tests were identified as flaky
   - What was causing the flakiness
   - What fixes were applied
   - Verification results (all 10 runs passing)
   - Any tests that could not be fixed and need further investigation
