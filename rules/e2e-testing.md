# E2E Testing

Use E2E testing when you need to test a complete user flow for a feature.

If you would need to mock a lot of things to unit test a feature, prefer to write an E2E test instead.

Do NOT write lots of e2e test cases for one feature. Each e2e test case adds a significant amount of overhead, so instead prefer just one or two E2E test cases that each have broad coverage of the feature in question.

**IMPORTANT: You MUST run `npm run build` before running E2E tests.** E2E tests run against the built application binary, not the source code. If you make any changes to application code (anything outside of `e2e-tests/`), you MUST re-run `npm run build` before running E2E tests, otherwise you'll be testing the old version of the application.

```sh
npm run build
```

To run e2e tests without opening the HTML report (which blocks the terminal), use:

```sh
PLAYWRIGHT_HTML_OPEN=never npm run e2e
```

To get additional debug logs when a test is failing, use:

```sh
DEBUG=pw:browser PLAYWRIGHT_HTML_OPEN=never npm run e2e
```

## PageObject sub-component pattern

The `PageObject` (aliased as `po` in tests) delegates most methods to sub-component page objects. Don't call methods directly on `po` unless they are explicitly defined on `PageObject` itself:

```ts
// Wrong: methods don't exist on po directly
await po.getTitleBarAppNameButton().click();
await po.getCurrentAppPath();
await po.goToChatTab();

// Correct: use the appropriate sub-component
await po.appManagement.getTitleBarAppNameButton().click();
await po.appManagement.getCurrentAppPath();
await po.navigation.goToChatTab();
```

Key sub-components: `po.appManagement`, `po.navigation`, `po.chatActions`, `po.previewPanel`, `po.codeEditor`, `po.githubConnector`, `po.toastNotifications`, `po.settings`, `po.securityReview`, `po.modelPicker`.

## Base UI Radio component selection in Playwright

Base UI Radio components render a hidden native `<input type="radio">` with `aria-hidden="true"`. Both `getByRole('radio', { name: '...' })` and `getByLabel('...')` find this hidden input but can't click it (element is outside viewport). Use `getByText` to click the visible label text instead.

```ts
// Correct: click the visible label text
await page.getByText("Vue", { exact: true }).click();

// Won't work: finds hidden input, can't click
await page.getByRole("radio", { name: "Vue" }).click();
await page.getByLabel("Vue").click();
```

## Lexical editor in Playwright E2E tests

The chat input uses a Lexical editor (contenteditable). Standard Playwright methods don't always work:

- **Clearing input**: `fill("")` doesn't reliably clear Lexical. Use keyboard shortcuts instead: `Meta+a` then `Backspace`.
- **Timing issues**: Lexical may need time to update its internal state. Use `toPass()` with retries for resilient tests.
- **Helper methods**: Use `po.clearChatInput()` and `po.openChatHistoryMenu()` from test_helper.ts for reliable Lexical interactions.

```ts
// Wrong: may not clear Lexical editor
await chatInput.fill("");

// Correct: use helper with retry logic
await po.clearChatInput();

// For history menu (needs clear + ArrowUp with retries)
await po.openChatHistoryMenu();
```

## PageObject accessor pattern

`PageObject` delegates methods to sub-objects. Always use the correct sub-object accessor:

```ts
// Correct:
await po.appManagement.getTitleBarAppNameButton().click();
await po.appManagement.getCurrentAppPath();
await po.navigation.goToChatTab();

// Wrong (these methods don't exist on PageObject directly):
await po.getTitleBarAppNameButton().click();
await po.getCurrentAppPath();
await po.goToChatTab();
```

If `npm run ts` reports `Property 'X' does not exist on type 'PageObject'`, check `e2e-tests/helpers/page-objects/components/` for which sub-object owns that method.

## Snapshot testing

**NEVER update snapshot files (e.g. `.txt`, `.yml`) by hand.** Always use `--update-snapshots` to regenerate them.

Snapshots must be **deterministic** and **platform-agnostic**. They must not contain:

- Timestamps
- Temporary folder paths (e.g. `/tmp/...`, `/var/folders/...`)
- Randomly generated values (UUIDs, nonces, etc.)
- OS-specific paths or line endings

If the output under test contains non-deterministic or platform-specific content, add sanitization logic in the test helper (e.g. in `test_helper.ts`) to normalize it before snapshotting.

## Accordion-wrapped settings in E2E tests

The Pro mode build settings (Web Access, Turbo Edits, Smart Context) are inside a collapsed `<Accordion>` in `ProModeSelector`. E2E test helpers must expand the accordion before interacting with elements inside it. The `ProModesDialog` class in `e2e-tests/helpers/page-objects/dialogs/ProModesDialog.ts` has an `expandBuildModeSettings()` method that handles this — call it before clicking any build mode setting buttons.

## Parallel test port isolation

Each parallel Playwright worker gets its own fake LLM server on port `FAKE_LLM_BASE_PORT + parallelIndex`. The base port constant lives in `e2e-tests/helpers/test-ports.ts` (not in `playwright.config.ts`) to avoid importing the Playwright config from test code.

When adding new test server URLs, update **both** the test fixtures (`e2e-tests/helpers/fixtures.ts`) and the Electron app source that consumes them. The app reads `process.env.FAKE_LLM_PORT` to build its `TEST_SERVER_BASE` URL — if you hardcode a port in app source, parallel workers will all hit the same server.

## Common flaky test patterns and fixes

- **After `page.reload()`**: Always add `await page.waitForLoadState("domcontentloaded")` before interacting with elements. Without this, the page may not have re-rendered yet.
- **Keyboard navigation events (ArrowUp/ArrowDown)**: Add `await page.waitForTimeout(100)` between sequential keyboard presses to let the UI state settle. Rapid keypresses can cause race conditions in menu navigation.
- **Navigation to tabs**: Use `await expect(link).toBeVisible({ timeout: Timeout.EXTRA_LONG })` before clicking tab links (especially in `goToAppsTab()`). Electron sidebar links can take time to render during app initialization.
- **Confirming flakiness**: Use `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec> --repeat-each=10` to reproduce flaky tests. `PLAYWRIGHT_RETRIES=0` is critical — CI defaults to 2 retries, hiding flakiness.

## Waiting for button state transitions

When clicking a button that triggers an async operation and changes its text/state (e.g., "Run Security Review" → "Running Security Review..."), wait for the loading state to appear and disappear rather than just waiting for the original button to be hidden:

```ts
// Wrong: waiting for original button to be hidden may race
const button = page.getByRole("button", { name: "Run Security Review" });
await button.click();
await button.waitFor({ state: "hidden" }); // Unreliable

// Correct: wait for loading state to appear then disappear
const button = page.getByRole("button", { name: "Run Security Review" });
await button.click();
const loadingButton = page.getByRole("button", {
  name: "Running Security Review...",
});
await loadingButton.waitFor({ state: "visible" });
await loadingButton.waitFor({ state: "hidden" });
```

This pattern provides a more reliable signal that the async operation has completed, because:

1. It confirms the operation actually started (loading state appeared)
2. It confirms the operation finished (loading state disappeared)
3. It avoids race conditions where the button might briefly be in the DOM but not yet updated

## E2E test fixtures with .dyad directories

When adding E2E test fixtures that need a `.dyad` directory for testing:

- The `.dyad` directory is git-ignored by default in test fixtures
- Use `git add -f path/to/.dyad/file` to force-add files inside `.dyad` directories
- If `mkdir` is blocked on `.dyad` paths due to security restrictions, use the Write tool to create files directly (which auto-creates parent directories)
