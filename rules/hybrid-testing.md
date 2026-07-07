# Vitest Integration Testing

Use Vitest integration tests for cross-module behavior that can run inside the
test process with deterministic fakes. Name these files
`*.integration.test.ts` or `*.integration.test.tsx`.

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
