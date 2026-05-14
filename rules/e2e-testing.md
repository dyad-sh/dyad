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

For app features that fetch `api.dyad.sh` directly, add a test-only env override in app code and point it at the worker-specific fake server during E2E. Without that override, E2E tests cannot deterministically exercise both the remote-success and local-fallback paths.

## CI scaffold dependency installs

If an E2E CI shard fails before Playwright starts with `[ERR_PNPM_IGNORED_BUILDS]` during `cd scaffold && pnpm install` or `cd nextjs-template && pnpm install`, check the workflow pnpm version first. `pnpm@latest` can change build-script policy between major versions; pin the workflow pnpm version or explicitly update the build-script policy instead of debugging test code.

## Sandbox-related Electron launch failures

Packaged Electron E2E runs may fail inside the Codex sandbox before any test logic executes, with Playwright reporting `electron.launch: Process failed to launch!` and the Electron process exiting with `SIGABRT`.

The same sandbox issue can appear earlier as a Playwright `config.webServer` startup failure, for example `Error: listen EPERM: operation not permitted 0.0.0.0:3500` from the fake LLM server. Re-run the same E2E command outside the sandbox before treating it as a product regression.

If this happens:

1. Verify whether the failure reproduces on an existing known-good E2E spec.
2. Re-run the same `npm run e2e -- e2e-tests/<spec>` command outside the sandbox before treating it as an app regression.
3. If the test passes outside the sandbox, treat the sandbox launch failure as environmental rather than a product bug.

## Native rebuild Python issues during E2E builds

If `npm run build` fails while rebuilding native modules with `ImportError` from Homebrew Python 3.14's `pyexpat` (for example `Symbol not found: _XML_SetAllocTrackerActivationThreshold`), rerun the build with the system Python: `PYTHON=/usr/bin/python3 npm run build`.

## Common flaky test patterns and fixes

- **After `po.importApp(...)`**: Some imports trigger an initial assistant turn (for example `minimal` generating `AI_RULES.md`) that can leave a visible `Retry` button in the chat. If the test is about a later prompt, first wait for that import-time turn to finish, then start a new chat before calling `sendPrompt()`, or helper methods that wait on `Retry` visibility may return too early.
- **Context Files Picker add/remove actions**: After clicking `Add` for manual, auto-include, or exclude paths, wait for the new row text to appear before adding or removing another path. Likewise, after clicking a remove button, wait for the row count to drop before the next click. Chained clicks can race React state updates and only fail on later `--repeat-each` runs.
- **After `page.reload()`**: Always add `await page.waitForLoadState("domcontentloaded")` before interacting with elements. Without this, the page may not have re-rendered yet.
- **Keyboard navigation events (ArrowUp/ArrowDown)**: Add `await page.waitForTimeout(100)` between sequential keyboard presses to let the UI state settle. Rapid keypresses can cause race conditions in menu navigation.
- **Navigation to tabs**: Use `await expect(link).toBeVisible({ timeout: Timeout.EXTRA_LONG })` before clicking tab links (especially in `goToAppsTab()`). Electron sidebar links can take time to render during app initialization.
- **Collapsed sidebar app/chat lists**: App and chat sub-lists may be hidden until the sidebar rail item is hovered. Use page-object helpers such as `po.appManagement.showAppList()` or `po.chatActions.clickNewChat()` instead of asserting list items are visible immediately after navigation.
- **Confirming flakiness**: Use `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec> --repeat-each=10` to reproduce flaky tests. `PLAYWRIGHT_RETRIES=0` is critical — CI defaults to 2 retries, hiding flakiness.
- **`expect(...).toPass()` wrappers**: Give inner Playwright actions/assertions short explicit timeouts. Default 30s click/expect timeouts can consume the whole `toPass()` budget, so the retry wrapper never actually retries.
- **Chat prompt submit retries**: A send-button click can time out after the prompt was already submitted. Before retrying `sendPrompt()` flows, check for the prompt in `messages-list` or an empty input with `Cancel generation`; otherwise the retry can race into an active stream/proposal and leave the next prompt disabled.
- **Setup-screen tests and provider env vars**: E2E worker processes reuse `process.env`, so tests that set fake provider keys (for example `OPENAI_API_KEY`) can affect later tests in the same worker. When a fixture intentionally shows the setup screen, explicitly clear any env key that would make the provider appear configured.
- **Custom model setup dialog**: When adding a custom model in Settings helpers, scope inputs to the "Add Custom Model" dialog, assert `#model-id` and `#model-name` values before clicking `Add Model`, and wrap the fill/click in `expect.toPass()`. Fast repeats can otherwise leave the name field empty or append text to the wrong field.
- **Local model picker assertions**: Ollama/LM Studio menu items can expose accessible names that combine display name and model id (for example `Testollama testollama` or `lmstudio-model-1 lmstudio-model-1`). Exact test locators should account for this duplicated label/id shape.
- **Settings-dependent prompts**: After toggling a setting that affects the next chat request (for example Smart Context mode), wait for the persisted settings state with `expect.poll(() => po.settings.recordSettings().someKey)` before sending the prompt. UI clicks can return before the main-process settings write is visible to the request path.
- **Experiment-gated local-agent tools**: Tool consent does not expose tools disabled by experiments. If an E2E fixture expects an experiment-gated local-agent tool (for example `execute_sandbox_script`), set the experiment through `set-user-settings` or the Settings UI before sending the prompt.
- **Settings-dependent app filesystem paths**: After selecting or resetting the custom apps folder, wait for `po.settings.recordSettings().customAppsFolder` to match the expected value before creating, importing, or reopening apps. The folder picker IPC can return before later app-creation paths observe the persisted setting.
- **Monaco file-switch assertions**: For code-editor tests, don't stop at waiting for the editor textbox to appear. Wait until Monaco's active model URI matches the file you clicked; otherwise the test can type into a still-switching editor model and miss real file-switch races.
- **Monaco race repros**: If a file-editor bug only appears during quick tab/file changes, alternate between the affected files several times in one test before declaring it non-reproducible. A single switch often misses save-vs-switch timing bugs that show up immediately under `--repeat-each`.
- **GitHub sync success assertions**: Scope "Successfully pushed to GitHub!" assertions to `getByTestId("github-connected-repo")`; the same text can also appear in a toast, causing Playwright strict-mode failures.
- **Uncommitted-files banner after manual commit**: Commit-triggered app screenshots write under `.dyad/screenshot`. If native-git banner tests still show one uncommitted change after a successful commit, inspect whether Dyad-managed `.dyad/` files are being excluded from Git status before blaming query invalidation.
- **Visual image swap URLs**: Use a reachable fake-server image URL for visual editing URL-swap tests. Broken external URLs (for example `example.com/*.png`) trigger `dyad-image-load-error`, remove the pending image change, and make "component modified" assertions time out.
- **Cloud sandbox snapshot assertions**: Preview iframe visibility can happen before the fake cloud sandbox has accepted the latest upload. When asserting remote snapshot changes, poll `get-cloud-sandbox-status` and wait for `syncRevision` to advance before reading the iframe digest; the first full sync can be revision `1` even when it already includes the prompt change.

## Real Socket Firewall E2E tests

- If you change the add-dependency/socket-firewall command launch path (for example `spawn` vs PTY execution), proactively run `npm run e2e e2e-tests/socket_firewall.spec.ts` after `npm run build`. Unit tests and package builds do not cover the real packaged-Electron Socket Firewall flow.
- When exercising the real `sfw` binary in E2E, set fresh per-test `npm_config_cache`, `npm_config_store_dir`, and `pnpm_config_store_dir` in the launch hooks. Reused caches/stores can make Socket Firewall report that it did not detect package fetches, which turns blocked-package tests into false negatives.
- For real-path blocked-package coverage, prefer `axois` over `lodahs`. `lodahs` can resolve to `0.0.1-security` and install successfully under `pnpm`, so it does not reliably reach the blocked-package UI.

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

For streamed progress indicators that may complete quickly, allow the assertion to match either the transient in-progress text or the final completed text, then assert the final state after the operation completes.

## E2E test fixtures with .dyad directories

When adding E2E test fixtures that need a `.dyad` directory for testing:

- The `.dyad` directory is git-ignored by default in test fixtures
- Use `git add -f path/to/.dyad/file` to force-add files inside `.dyad` directories
- If `mkdir` is blocked on `.dyad` paths due to security restrictions, use the Write tool to create files directly (which auto-creates parent directories)
