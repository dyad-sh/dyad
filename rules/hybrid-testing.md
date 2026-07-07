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

Default to the node chat-flow harness when assertions are about files, git, db
rows, IPC events, or LLM request dumps. Use the renderer+IPC hybrid harness only
when assertions are about rendered UI or a flow that must be driven through a
real UI event in the mounted React tree.

When a renderer+IPC hybrid or chat-flow harness test passes `engine: true`,
production code must read Dyad Engine/Gateway URLs at call time. If a test still
logs `POST https://engine.dyad.sh/v1/... 401 (Unauthorized)`, search for
module-scope `DYAD_ENGINE_URL` constants and switch those call sites to
`getDyadEngineBaseUrl()`.

When a hybrid test needs `IS_TEST_BUILD` behavior from modules that capture
`process.env.E2E_TEST_BUILD` at import time, set it in a `vi.hoisted()` block
before app imports. `setupHybridChatHarness({ testBuild: true })` sets the flag
before dynamic IPC registration, but it cannot fix static imports that already
loaded modules such as the Neon management client.
