---
name: coney:debug-with-playwright
description: Debug E2E tests by taking screenshots at key points to visually inspect application state.
---

# Debug with Playwright Screenshots

Debug E2E tests by taking screenshots at key points to visually inspect application state.

## Arguments

- `$ARGUMENTS`: (Optional) Specific E2E test file to debug (e.g., `main.spec.ts` or `e2e-tests/main.spec.ts`). If not provided, will ask the user which test to debug.

## Background

Coney uses Electron + Playwright for E2E tests. Because Playwright's built-in `screenshot: "on"` option does NOT work with Electron (see https://github.com/microsoft/playwright/issues/8208), you must take screenshots manually via `page.screenshot()`.

The test fixtures in `e2e-tests/helpers/fixtures.ts` already auto-capture a screenshot on test failure and attach it to the test report. But for debugging, you often need screenshots at specific points during test execution.

## Instructions

1. **Identify the test to debug:**

   If `$ARGUMENTS` is empty, ask the user which test file they want to debug.
   - If provided without the `e2e-tests/` prefix, add it
   - If provided without the `.spec.ts` suffix, add it

2. **Read the test file:**

   Read the test file to understand what it does and where it might be failing.

3. **Add debug screenshots to the test:**

   Add `page.screenshot()` calls at key points in the test to capture visual state. Access the page from the `po` fixture:

   ```typescript
   // Get the page from the electronApp fixture
   const page = await electronApp.firstWindow();

   // Or if you only have `po`, access the page directly:
   // po is a PageObject which has a `page` property
   ```

   **Screenshot patterns for debugging:**

   ```typescript
   import * as fs from "fs";
   import * as path from "path";

   // Create a debug screenshots directory
   const debugDir = path.join(__dirname, "debug-screenshots");
   if (!fs.existsSync(debugDir)) {
     fs.mkdirSync(debugDir, { recursive: true });
   }

   // Take a full-page screenshot
   await page.screenshot({
     path: path.join(debugDir, "01-before-action.png"),
   });

   // Take a screenshot of a specific element
   const element = page.locator('[data-testid="chat-input"]');
   await element.screenshot({
     path: path.join(debugDir, "02-chat-input.png"),
   });

   // Take a screenshot after some action
   await po.sendPrompt("hi");
   await page.screenshot({
     path: path.join(debugDir, "03-after-send.png"),
   });
   ```

   **Important:** The test fixture signature provides `{ electronApp, po }`. To get the page:
   - Use `await electronApp.firstWindow()` to get the page
   - Or use `po.page` if PageObject exposes it

   Add screenshots before and after the failing step to understand what the UI looks like at that point.

4. **Build the app (if needed):**

   E2E tests run against the built binary. If you made any application code changes:

   ```
   npm run build
   ```

   If you only changed test files, you can skip this step.

5. **Run the test:**

   ```
   PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<testfile>.spec.ts
   ```

6. **View the screenshots:**

   Use the Read tool to view the captured PNG screenshots. Claude Code can read and display images directly:

   ```
   Read the PNG files in e2e-tests/debug-screenshots/
   ```

   Analyze the screenshots to understand:
   - Is the expected UI element visible?
   - Is there an error dialog or unexpected state?
   - Is a loading spinner still showing?
   - Is the layout correct?

7. **Check the Playwright trace (for additional context):**

   The Playwright config has `trace: "retain-on-failure"`. If the test failed, a trace file will be in `test-results/`. You can reference this for additional debugging context.

8. **Iterate:**

   Based on what you see in the screenshots:
   - Add more targeted screenshots if needed
   - Fix the issue in the test or application code
   - Re-run to verify

9. **Clean up:**

   After debugging is complete, remove the debug screenshots and any temporary screenshot code you added to the test:

   ```
   rm -rf e2e-tests/debug-screenshots/
   ```

   Remove any `page.screenshot()` calls you added for debugging purposes.

10. **Report findings:**

    Tell the user:
    - What the screenshots revealed about the test failure
    - What fix was applied (if any)
    - Whether the test now passes
