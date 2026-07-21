# Vitest Integration Testing

Use Vitest integration tests for cross-module behavior that can run inside the
test process with deterministic fakes. Name these files
`*.integration.test.ts` or `*.integration.test.tsx` — any such file under
`src/` is routed to the `integration` Vitest project (happy-dom, the shared
electron/posthog/react-i18next mocks from `src/testing/hybrid.setup.ts`, and
the forks pool). One deliberate exception: node-layer harness tests that
self-manage their environment (an `@vitest-environment node` pragma plus their
own `vi.mock("electron")`, e.g. `src/testing/chat_flow_harness.smoke.test.ts`)
keep a plain `.test.ts` suffix and run in the unit project, because the
integration project's setup mocks would conflict with theirs.

Prefer a Vitest integration test over Playwright E2E when the test can prove the
behavior through real IPC handlers, sqlite, git, fake LLM/Engine/Gateway routes,
or the renderer+IPC chat harness without needing the packaged Electron app.
These tests are faster, easier to debug, and avoid Electron launch/package
overhead.

Use Playwright E2E when the behavior depends on the packaged Electron runtime,
real browser/Electron behavior, native dialogs, screenshots/visual layout,
Monaco or Lexical browser interactions, drag/click/focus behavior that
happy-dom cannot model, or a full user journey across app shell navigation.

Base UI dropdown actions have `role="menuitem"`, while
`HybridChatHarness.clickMenuItem()` currently looks for `role="button"`. For
dropdown tests, query the open menu with `within(...).getByRole("menuitem")`
unless the harness helper has been expanded to support both roles.

`HybridChatHarness` keeps its mounted Jotai store private. When a regression
test must seed or inspect atom state, add a narrow domain helper to the harness
instead of assuming a public `harness.store` property.

Default to the node chat-flow harness when assertions are about files, git, db
rows, IPC events, or LLM request dumps. Use the renderer+IPC hybrid harness only
when assertions are about rendered UI or a flow that must be driven through a
real UI event in the mounted React tree.

Do not drive overlapping `chat:stream` calls for the same chat through the
chat-flow or hybrid harness. Both invocations read and write the same persisted
conversation, so one stream's user/tool messages can change the other stream's
fake-fixture routing or turn count and make timing-based tests hang. Cover
per-invocation tracking with a focused unit test, and use separate chats for
integration coverage of app-wide cancellation.

When a renderer+IPC hybrid or chat-flow harness test passes `engine: true`,
production code must read Dyad Engine/Gateway URLs at call time. If a test still
logs `POST https://engine.dyad.sh/v1/... 401 (Unauthorized)`, search for
module-scope `DYAD_ENGINE_URL` constants and switch those call sites to
`getDyadEngineBaseUrl()`.

## Test log noise

- `src/testing/hybrid.setup.ts` caps electron-log's console transport at
  `warn` (its default prints everything, including `logger.debug`). Set
  `DYAD_TEST_LOG_LEVEL=debug` to see info/debug logs while debugging a test.
  New per-request logging in app code should be `logger.debug`, not
  `logger.info`/`logger.log`.
- In `testing/fake-llm-server/`, informational logs must go through
  `fakeLlmLog` from `./log` (silenced by `FAKE_LLM_QUIET=1`, which the vitest
  harnesses set). Reserve raw `console.error` for genuine failures — it is
  never suppressed.
- TypeScript fixtures under `e2e-tests/fixtures/` are loaded by the fake LLM
  server through `ts-node` with its default library target. Avoid newer built-in
  methods such as `String.prototype.padStart`, which can fail type-checking
  before the fixture runs even though the main Vitest compiler accepts them.
- Some unit tests mock electron-log with an explicit method object
  (`vi.mock("electron-log", ... { scope: () => ({ info, log, warn, error }) })`).
  Calling a logger method the mock omits fails with e.g. "logger.debug is not
  a function" — grep `vi.mock("electron-log"` when changing log levels.
- `runTypeScriptCheck` is stubbed to `{ problems: [] }` in
  `hybrid.setup.ts`: it launches the app-local TypeScript CLI and depends on
  project files that the renderer harness does not provide. Integration tests
  cannot assert on real TypeScript problem reports.
- Suppress known-noisy test console output (React `act(...)` warnings,
  TanStack `useRouter` provider warnings) via `noisyConsolePatterns` in
  `vitest.config.ts` rather than letting it accumulate.

Full `npm test` runs can fail inside the Codex sandbox before test logic runs
when OAuth, proxy, or hybrid harness suites bind/connect to loopback ports. If
the failure is `listen EPERM` or `connect EPERM` for `127.0.0.1`, `localhost`,
or `::1`, re-run the same command outside the sandbox before debugging tests.

OAuth integration callback listeners must use OS-assigned available ports, not
fixed high ports. Windows commonly assigns dynamic ports in the 49152-65535
range, so a fixed callback port there can collide only under CI load and make
`runOAuthFlow` return immediately with a misleading authentication failure.

Tests that intentionally stream large files should declare a timeout sized for
loaded Windows CI runners. Keep the large fixture when it proves bounded-memory
behavior; raising that individual test's timeout is preferable to weakening the
streaming regression coverage or raising the timeout suite-wide.

If the unsandboxed rerun reaches the harness but fails loading
`better-sqlite3` with a `NODE_MODULE_VERSION` mismatch, follow the
`npm rebuild better-sqlite3` recovery in `rules/native-modules.md` (single
source of truth for native-module rebuild guidance) before debugging tests.

When a hybrid test needs `IS_TEST_BUILD` behavior from modules that capture
`process.env.E2E_TEST_BUILD` at import time, set it in a `vi.hoisted()` block
before app imports. `setupHybridChatHarness({ testBuild: true })` sets the flag
before dynamic IPC registration, but it cannot fix static imports that already
loaded modules such as the Neon management client.

The shared Electron mock's `utilityProcess.fork()` is intentionally inert and
never emits `spawn`, `message`, or `exit`. If a hybrid flow reaches a packaged
utility-process boundary, mock that processor in `hybrid.setup.ts` with a
deterministic fallback; otherwise the handler waits for its production timeout
and teardown reports a misleading pending `chat:stream`.

If a chat-flow or hybrid harness suite passes all tests but fails during
`dispose()` with `ENOTEMPTY` for a `dyad-chat-flow-*` temp directory, look for a
launched app process still writing under that root (often `pnpm install`). Stop
running apps and await process closure before removing the harness temp dir.

When a hybrid test involving git passes locally but fails in CI with messages
like `Failed to resolve ref 'main'` or a branch banner showing `master`, check
the fixture repo's `git init` default branch. Either make production code use
the current branch instead of assuming `main`, or force the fixture branch name
in the test so local and CI exercise the same branch layout.

Git integration fixtures must also use filenames that are valid on Windows.
When testing literal pathspec handling, keep the POSIX `:(glob)` case on Unix
and use a Windows-safe metacharacter filename such as `literal[1].txt` on
Windows. For executable restores, assert the returned Git mode on every
platform and assert filesystem execute bits only on POSIX. Temporary Git repos
can retain handles briefly on Windows, so teardown should use bounded
`fs.rm` retries (`maxRetries` plus `retryDelay`) rather than making successful
test logic fail with a transient `EBUSY`.

For cross-platform path assertions, match the path contract being exercised.
Use `path.normalize()` when the code preserves a rooted path such as `/tmp/...`;
`path.resolve()` adds the runner's current drive on Windows and is only correct
when production code also resolves the path to an absolute drive-qualified one.

For asynchronous Git actions driven through the renderer, file existence can
change before the underlying Git subprocess finishes. Wait for the expected
branch and a clean `git status --porcelain` before making follow-up mutations or
ending the test.
