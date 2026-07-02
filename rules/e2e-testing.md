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

When regenerating one failing snapshot by running an entire spec file, review `git diff` before committing. Neighboring request-dump snapshots in the same file can be rewritten too; keep only the updates needed for the failing assertion unless the broader fixture output intentionally changed.

If a helper moves from Playwright's `toMatchAriaSnapshot()` to a custom `toMatchSnapshot()` filename, rerun affected specs with `--update-snapshots` and review later raw `.aria.yml` snapshots in the same test. The helper no longer consumes Playwright's ARIA snapshot counter, so subsequent raw ARIA baselines can shift even when the UI did not change.

When a test uses both raw Playwright `toMatchAriaSnapshot()` and `po.snapshotMessages()` with the same test title, give `snapshotMessages` an explicit `name`. Otherwise the custom message snapshot can collide with Playwright's numbered component snapshot files and overwrite unrelated baselines.

Snapshot sanitizers should normalize the captured snapshot text, not mutate React-owned DOM with `innerHTML` before snapshotting. DOM mutation during E2E can trigger React `NotFoundError: Failed to execute 'removeChild' on 'Node'` on the next render.

Custom snapshot helpers that read/write baseline files directly must fail the test after writing a missing baseline (Playwright's default `updateSnapshots: "missing"` writes the file AND fails). Returning silently after the write lets a renamed or typo'd snapshot name pass green on CI without ever comparing.

Snapshot normalizers must be idempotent — `normalize(normalize(x)) === normalize(x)` — and should have a unit test asserting it. In particular, when re-formatting YAML single-quoted lines from `ariaSnapshot()`, unescape doubled `''` to `'` before re-escaping, or quotes double on every pass (`''` → `''''`). To find baselines affected by a normalizer change, run the normalizer over all committed `.aria.yml` files and diff: normalizer-produced baselines should be fixed points (raw `toMatchAriaSnapshot` baselines will differ and can be ignored).

If app-file snapshots unexpectedly include `dist/` assets after running `pnpm --dir scaffold build`, delete `scaffold/dist` and rerun `npm run build` before regenerating E2E baselines. The packaged Electron app snapshots the scaffold contents from the last package build, so a stale packaged `scaffold/dist` can keep contaminating snapshots even after the source directory is cleaned.
When changing provider request model IDs, search all request-dump snapshots for the old model value. Local-agent snapshots can include the same engine model payloads as `engine.spec.ts`, so updating only the obvious engine snapshot may leave stale expected dumps.
If CI shows E2E snapshot drift but a local `--update-snapshots` run produces no diff, rebuild the packaged app with `npm run build` and rerun the updater. A stale packaged Electron app can make local snapshot updates compare against old source behavior and hide required baseline changes.
If a test-only E2E fix fails locally because a new source locator or UI element is missing, check whether the branch already had app-code changes that were never packaged. Rebuild with `npm run build` even if your current diff only touches tests.

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

If Playwright's `config.webServer` exits while building `testing/fake-llm-server` with missing `express`/`cors` type declarations (`TS7016`) or implicit `req`/`res` errors, run `npm install` inside `testing/fake-llm-server` before rerunning E2E.

If this happens:

1. Verify whether the failure reproduces on an existing known-good E2E spec.
2. Re-run the same `npm run e2e -- e2e-tests/<spec>` command outside the sandbox before treating it as an app regression.
3. If the test passes outside the sandbox, treat the sandbox launch failure as environmental rather than a product bug.

## Packaged Electron launch hangs

If an E2E test times out while setting up `electronApp` after `Debugger listening` but before Chromium prints `DevTools listening`, the packaged app may be blocked behind a native startup alert before any BrowserWindow exists. Sample the process; `NSAlert runModal` on the main thread confirms this.

To expose the hidden error, launch the packaged executable with `--inspect-brk=0 --remote-debugging-port=0` and attach a Node inspector client that enables `Debugger.setPauseOnExceptions` before `Runtime.runIfWaitingForDebugger`. Errors like `ENOENT, node_modules/<pkg>/package.json not found in .../app.asar` usually mean `forge.config.ts`'s runtime dependency allowlist is missing a transitive package.

On macOS, do not isolate packaged Electron tests or benchmark launches by overriding `HOME` to a fresh temp directory. The app can start and print main-process logs, but Playwright may never complete `electron.launch`; isolate `--user-data-dir`, `XDG_CONFIG_HOME`, and `GIT_CONFIG_GLOBAL` instead.

## Native rebuild Python issues during E2E builds

If `npm run build` fails while rebuilding native modules with `ImportError` from Homebrew Python 3.14's `pyexpat` (for example `Symbol not found: _XML_SetAllocTrackerActivationThreshold`), rerun the build with the system Python: `PYTHON=/usr/bin/python3 npm run build`.

## Missing dependencies during E2E builds

If `npm run build` / Electron Forge packaging fails with `Failed to locate module "<package>"` but `package.json` and `package-lock.json` already declare that package, run `npm install` to restore `node_modules` before debugging app code.

If a targeted E2E fails before launch with `ENOENT: no such file or directory, scandir '<repo>/out'`, verify `ls out` immediately after `npm run build`. If Forge logs end around `Finalizing package` and `electron-forge:plugin:vite handling process exit` but no `out/` directory exists, treat it as a packaging-environment issue and do not debug the spec assertions yet.

## Common flaky test patterns and fixes

- **After `po.importApp(...)`**: Some imports trigger an initial assistant turn (for example `minimal` generating `AI_RULES.md`) that can leave a visible `Retry` button in the chat. If the test is about a later prompt, first wait for that import-time turn to finish, then start a new chat before calling `sendPrompt()`, or helper methods that wait on `Retry` visibility may return too early.
- **Context Files Picker add/remove actions**: After clicking `Add` for manual, auto-include, or exclude paths, wait for the new row text to appear before adding or removing another path. Likewise, after clicking a remove button, wait for the row count to drop before the next click. Chained clicks can race React state updates and only fail on later `--repeat-each` runs.
- **After `page.reload()`**: Always add `await page.waitForLoadState("domcontentloaded")` before interacting with elements. Without this, the page may not have re-rendered yet.
- **Keyboard navigation events (ArrowUp/ArrowDown)**: Add `await page.waitForTimeout(100)` between sequential keyboard presses to let the UI state settle. Rapid keypresses can cause race conditions in menu navigation.
- **Navigation to tabs**: Use `await expect(link).toBeVisible({ timeout: Timeout.EXTRA_LONG })` before clicking tab links (especially in `goToAppsTab()`). Electron sidebar links can take time to render during app initialization.
- **Collapsed sidebar app/chat lists**: App and chat sub-lists may be hidden until the sidebar rail item is hovered. Use page-object helpers such as `po.appManagement.showAppList()` or `po.chatActions.clickNewChat()` instead of asserting list items are visible immediately after navigation.
- **Imported chat tab state**: Import flows should select the newly created chat through `useSelectChat().selectChat(...)`, not direct `navigate({ to: "/chat" })`, so current-session chat tabs are seeded consistently.
- **Selecting a specific existing chat after app switches**: Do not use raw `window.history.pushState` to force `/chat` route state; TanStack Router search validation may not observe/coerce it like in-app navigation. Select the app through UI helpers, hover the Apps rail to reveal the chat list, then click `data-testid="chat-list-item-<chatId>"` when the test needs an exact chat. Avoid "Open in Chat" when multiple chats exist because it can open a different chat than the scenario owns.
- **Mention menu item clicks**: Lexical mention menu items can be visible in the accessibility tree but outside Playwright's clickable viewport. Prefer narrowing the typed query and pressing `Enter`, or use a helper that selects the visible active item instead of raw `menuItem.click()`.
- **Confirming flakiness**: Use `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec> --repeat-each=10` to reproduce flaky tests. `PLAYWRIGHT_RETRIES=0` is critical — CI defaults to 2 retries, hiding flakiness.
- **`expect(...).toPass()` wrappers**: Give inner Playwright actions/assertions short explicit timeouts. Default 30s click/expect timeouts can consume the whole `toPass()` budget, so the retry wrapper never actually retries.
- **Chat prompt submit retries**: A send-button click can time out after the prompt was already submitted. Before retrying `sendPrompt()` flows, check for the prompt in `messages-list` or an empty input with `Cancel generation`; otherwise the retry can race into an active stream/proposal and leave the next prompt disabled.
- **Setup-screen tests and provider env vars**: E2E worker processes reuse `process.env`, so tests that set fake provider keys (for example `OPENAI_API_KEY`) can affect later tests in the same worker. When a fixture intentionally shows the setup screen, explicitly clear any env key that would make the provider appear configured.
- **AI setup dialog tests**: `showSetupScreen: true` only prevents the fixture from injecting an API key; the home page opens the AI setup dialog after submitting a prompt with no provider configured. The dialog contains both a hidden `DialogTitle` and visible banner heading with "You're almost ready to build", so assert unique body copy or provider option buttons instead of a broad heading locator.
- **First-provider setup resume tests**: Saving the first provider key while a home prompt is pending now navigates home and auto-submits that prompt. E2E tests that only verify setup navigation should avoid saving a first key; tests that exercise the resume path should assert the prompt appears in `messages-list` and the selected app is set.
- **Custom model setup dialog**: When adding a custom model in Settings helpers, scope inputs to the "Add Custom Model" dialog, assert `#model-id` and `#model-name` values before clicking `Add Model`, and wrap the fill/click in `expect.toPass()`. Fast repeats can otherwise leave the name field empty or append text to the wrong field.
- **Local model picker assertions**: Ollama/LM Studio menu items can expose accessible names that combine display name and model id (for example `Testollama testollama` or `lmstudio-model-1 lmstudio-model-1`). Exact test locators should account for this duplicated label/id shape.
- **Settings-dependent prompts**: After toggling a setting that affects the next chat request (for example Smart Context mode), wait for the persisted settings state with `expect.poll(() => po.settings.recordSettings().someKey)` before sending the prompt. UI clicks can return before the main-process settings write is visible to the request path.
- **Experiment-gated local-agent tools**: Tool consent does not expose tools disabled by experiments. If an E2E fixture expects an experiment-gated local-agent tool (for example `execute_sandbox_script`), set the experiment through `set-user-settings` or the Settings UI before sending the prompt.
- **Local-agent MCP fixtures**: When `execute_sandbox_script` is enabled, MCP tools are exposed as sandbox host functions, not direct model tools. Fixture tool calls should invoke `execute_sandbox_script` and call the generated JS-safe function name (for example `testing_mcp_server__calculator_add(...)`), and the test should wait for MCP tool discovery before sending the prompt.
- **Settings-dependent app filesystem paths**: After selecting or resetting the custom apps folder, wait for `po.settings.recordSettings().customAppsFolder` to match the expected value before creating, importing, or reopening apps. The folder picker IPC can return before later app-creation paths observe the persisted setting.
- **Security review fix chat snapshots**: Clicking `Fix Issue` in the Security panel creates and selects a new chat asynchronously. Before snapshotting messages, wait for the fix prompt plus `Version N:` in `messages-list`; otherwise the snapshot can race between the original review chat and the fix chat.
- **Monaco file-switch assertions**: For code-editor tests, don't stop at waiting for the editor textbox to appear. Wait until Monaco's active model URI matches the file you clicked; otherwise the test can type into a still-switching editor model and miss real file-switch races.
- **Monaco race repros**: If a file-editor bug only appears during quick tab/file changes, alternate between the affected files several times in one test before declaring it non-reproducible. A single switch often misses save-vs-switch timing bugs that show up immediately under `--repeat-each`.
- **GitHub sync success assertions**: Scope "Successfully pushed to GitHub!" assertions to `getByTestId("github-connected-repo")`; the same text can also appear in a toast, causing Playwright strict-mode failures.
- **GitHub fake device flow**: After clicking "Connect to GitHub", setup-repo UI assertions can race the fake auth polling loop. The setup section may render just after a 5s default assertion timeout, so use a medium timeout for "Set up your GitHub repo" / "Create new repo" assertions that depend on connection success.
- **Supabase connection flows**: After clicking the Supabase connect button in E2E, wait for the connected project UI (for example the fake project name) before navigating away or snapshotting. The connect helper can return before renderer state reflects the new integration.
- **Uncommitted-files banner after manual commit**: Commit-triggered app screenshots write under `.dyad/screenshot`. If native-git banner tests still show one uncommitted change after a successful commit, inspect whether Dyad-managed `.dyad/` files are being excluded from Git status before blaming query invalidation.
- **Manual git commits inside app repos**: If an E2E helper runs `git commit` directly, configure `user.email`, `user.name`, and `commit.gpgsign=false` in that app repo first. Windows CI runners may not have a git identity, causing `Author identity unknown` before UI assertions run.
- **Toast-obscured clicks**: Sonner toasts can intercept clicks after settings saves. Prefer waiting for the expected toast/state transition and clicking a scoped stable target; avoid relying on forced DOM removal when app state may re-render immediately afterward.
- **Visual image swap URLs**: Use a reachable fake-server image URL for visual editing URL-swap tests. Broken external URLs (for example `example.com/*.png`) trigger `dyad-image-load-error`, remove the pending image change, and make "component modified" assertions time out.
- **Preview loading screen assertions**: Use `po.previewPanel.locatePreviewLoadingScreen()` / `locateLoadingAppPreview()` test IDs instead of asserting exact loading copy. The user-facing status text can change independently of the loading state contract.
- **Blank preview after restart**: If a restart E2E trace shows `ERR_CONNECTION_REFUSED`, then a later `proxy-server-start`, and the failure screenshot has a blank preview, check whether the renderer reloads the iframe on the proxy-ready app-output event. A longer snapshot timeout will not fix a frame that already navigated to the dead proxy URL.
- **Preview error fixtures**: If a fixture only needs to remove the dev script, use targeted `dyad-search-replace` against `package.json`; rewriting the whole file can create `ERR_PNPM_OUTDATED_LOCKFILE` and mask the intended preview error.
- **Preview startup error logs**: `pnpm` can print actionable failures such as `ERR_PNPM_NO_SCRIPT Missing script: dev` on stdout, so don't assume only stderr/`level="error"` entries drive the loading-screen error banner. Re-run suspicious preview-error E2Es with `env -u NO_COLOR` because local `NO_COLOR`/`FORCE_COLOR` warnings can accidentally make assertions pass.
- **Cloud sandbox snapshot assertions**: Preview iframe visibility can happen before the fake cloud sandbox has accepted the latest upload. When asserting remote snapshot changes, poll `get-cloud-sandbox-status` and wait for `syncRevision` to advance before reading the iframe digest; if the next action can trigger a full sync or cancel pending work (for example Undo), wait for the revision to settle first so a debounced upload is not skipped. The first full sync can be revision `1` even when it already includes the prompt change.
- **App file snapshots and Dyad-managed runtime files**: If a spec snapshots app files but does not care about package-manager runtime config, scope `po.snapshotAppFiles({ files: [...] })` to the scenario-owned files. `pnpm-workspace.yaml` can be generated asynchronously by app startup and make otherwise unrelated snapshots timing-dependent.
- **Local-agent message version counts**: ARIA snapshots that include `Version N: (... files changed)` should use a regex for the file count unless the exact count is the behavior under test. Runtime-created files such as `pnpm-workspace.yaml` can change those counts without changing the scenario.
- **Stable message ARIA snapshots**: If snapshots intermittently miss version metadata even though the assistant turn finished, retry the ARIA capture itself. A retry wrapped only around comparing a pre-captured string cannot observe React Query metadata that arrives after the first capture.
- **Uncommitted-files banner clean state / renderer restarts**: If a prompt/app startup creates Dyad-managed runtime files before a banner test asserts a clean worktree, commit that runtime baseline first. Avoid `page.reload()` for packaged Electron app restart simulations; SPA file routes can fail with `net::ERR_FILE_NOT_FOUND`. If a test needs to recreate the renderer, ask the main process to `BrowserWindow.loadFile(path.join(app.getAppPath(), ".vite/renderer/main_window/index.html"))`.
- **Version restore clean state**: If a restore/switch-version test fails with `Cannot revert: working tree has uncommitted changes` from a runtime `pnpm-workspace.yaml`, and exact version numbers are under test, amend that runtime file into the current generated commit instead of adding a new baseline commit that shifts `Version N`.
- **Completion notifications for another chat**: When testing completion notifications while viewing a different chat, make the fake LLM response slow (for example `[sleep=medium]`) or otherwise prove navigation has settled before completion. Fast canned responses can complete while the route still points at the original chat, so the notification handler correctly treats it as the active chat.
- **Updating E2E snapshots**: Pass the update flag directly to the project script, e.g. `PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/<spec>.ts --update-snapshots`. Do not insert an extra `--` before `--update-snapshots`; Playwright will compare instead of updating.
- **Click timeouts with "subtree intercepts pointer events" across many specs**: When several unrelated specs all time out clicking the same button and the call log says another element's "subtree intercepts pointer events", it's a CSS layout overlap (often a flex item shrinking below its `flex-shrink-0` content — see rules/ui-styling.md), not a flaky test. Look at the failure screenshot first and fix the app layout instead of retrying clicks.
- **Filesystem-heavy IPC assertions**: Operations that delete or copy whole app directories (e.g. bulk app delete) can exceed the 5s default expect timeout on CI runners. Give the post-operation assertion an explicit `{ timeout: 30_000 }`.
- **Fake Anthropic engine routes**: When app code uses Anthropic direct passthrough, the fake LLM server must handle `/v1/messages` (and provider-prefixed variants like `/engine/v1/messages`), not just `/chat/completions`. Anthropic tool results come back as user messages with `tool_result` content blocks, so fixture turn counting must skip those as user prompts.
- **Legacy local-agent `code_search` coverage**: `code_search` is hidden when code explorer is enabled and ready, so specs that explicitly test `code_search` should set `enableCodeExplorer: false` and poll persisted settings before sending the fixture prompt. Otherwise local and CI can render different snapshots depending on code-explorer readiness.
- **Local-agent request-dump snapshots and code explorer**: If a request-dump spec is not testing `explore_code`, pin `enableCodeExplorer: false` and poll `po.settings.recordSettings().enableCodeExplorer` before sending the prompt. Otherwise the serialized prompt/tool list can flip between `code_search` and `explore_code` depending on whether indexing finished first.
- **Supabase destructive SQL migration proposals**: Auto-approve does not apply destructive SQL changes. If an E2E prompt returns a destructive SQL proposal (for example `DROP TABLE`), call `po.approveProposal()` before asserting that a migration file or app-file change exists.

## Triaging failures from a CI run's html-report

- In the merged `html-report` artifact's `results.json`, failure screenshots are embedded as base64 in `attachments[].body` (the `path` field is empty or CI-side); decode the body to view them. Trace zips live in the artifact's `data/` directory, keyed by the hash in the CI-side path.
- Before root-causing a failure on a PR branch, download the `html-report` from a recent main-branch CI run and check whether the same spec fails there — pre-existing main failures are out of scope for the PR's deflake.

## Real Socket Firewall E2E tests

- If you change the add-dependency/socket-firewall command launch path (for example `spawn` vs PTY execution), proactively run `npm run e2e e2e-tests/package_manager.spec.ts` after `npm run build`. Unit tests and package builds do not cover the real packaged-Electron Socket Firewall flow.
- When exercising the real `sfw` binary in E2E, set fresh per-test `npm_config_cache`, `npm_config_store_dir`, and `pnpm_config_store_dir` in the launch hooks. Reused caches/stores can make Socket Firewall report that it did not detect package fetches, which turns blocked-package tests into false negatives.
- With fresh npm caches, warm the pinned `sfw` npx package in the test hook before Electron launches. Otherwise the app's short Socket Firewall probe can fail cold-cache installation and fall back to a direct package-manager install.
- For `npx`-based `sfw` warmups, keep the fresh `npm_config_cache` but omit pnpm-only store env vars from the child process; inherited `npm_config_store_dir` produces unsupported npm config warnings and can obscure the real warmup failure.
- If `npx --prefer-offline --yes sfw@... --help` fails during warmup with `Failed to prepare firewall binary: Unable to fetch latest release and no valid cached release found`, keep the fresh per-test cache but add a short bounded retry around the warmup; the failure happens before Electron launches and can be a transient release-download issue.
- For real-path blocked-package coverage, prefer `axois` over `lodahs`. `lodahs` can resolve to `0.0.1-security` and install successfully under `pnpm`, so it does not reliably reach the blocked-package UI.
- In package-manager E2E shims, execute the resolved `pnpm` path directly. CI setup can provide a shell wrapper, and running that wrapper through `process.execPath` makes Node parse shell syntax instead of invoking pnpm.

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
