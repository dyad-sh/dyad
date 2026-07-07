# Hybrid chat harness — rendering the real UI over the real IPC stack

`setupHybridChatHarness` renders the **real** `<ChatPanel>` (React Testing
Library under happy-dom) wired to the **real** main-process IPC handlers in the
same Node process. Clicking the real Send button drives the whole stack — real
fake-LLM HTTP, real tag processor, real file writes / git / sqlite — and the
streamed assistant message renders in the DOM, exactly like production.

It is a superset of the node [`setupChatFlowHarness`](./CHAT_FLOW_HARNESS.md):
it reuses that harness verbatim (server, db, git checkout, `chat:stream`) and
adds `registerIpcHandlers()` (every channel the UI invokes) + a fake
`window.electron` bridge + a `mount()` helper.

---

## 1. When to use hybrid vs node

Default to the **node** harness. It is faster (no DOM), simpler, and covers
almost everything a migrated `chat:stream` spec asserts.

| Use the **node** harness (`setupChatFlowHarness`) when…    | Use the **hybrid** harness when…                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| You assert on files / git / db / the LLM request `[dump]`. | You assert on **rendered UI** (a streamed message, a banner, a badge).                                           |
| You call `chat:stream` directly and inspect its events.    | The behavior can only be driven through a **real UI event** (clicking Send, an approval button, input clearing). |
| You don't care how the renderer displays anything.         | You are porting a Playwright spec whose assertions are DOM-shaped.                                               |

If a test would pass with the node harness, use the node harness.

---

## 2. Test-file skeleton

Hybrid tests are named `*.hybrid.test.ts`. The Vitest `hybrid` project supplies
the happy-dom environment, `disableSameOriginPolicy`, the shared `electron` /
PostHog / i18n mocks, `NODE_ENV=development`, and failure DOM dumps via
`src/testing/hybrid.setup.ts`.

```tsx
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { screen, waitFor } from "@testing-library/react";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("my UI feature (hybrid)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("renders the streamed message", async () => {
    harness.mount();
    const { send } = await harness.typeInChat("tc=dyad-write-angle");
    send();
    await waitFor(() => expect(screen.getByText(/AFTER TAG/)).toBeTruthy());
    await harness.waitForStreamEnd(harness.chatId); // BEFORE any main-side assert
    expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
  }, 60_000);
});
```

Notes:

- `settings: { isTestMode: true }` makes `MessagesList` render a plain
  (non-Virtuoso) list — the same path the Playwright suite renders and the one
  `screen.getByText` can see.
- The setup file's three mocks are the **only** shared mocks needed: `electron`
  (the shared node-mock),
  `posthog-js/react` (offline telemetry), `react-i18next` (so `t()` works without
  the renderer's i18next bootstrap). Lexical, framer-motion, and Virtuoso mount
  cleanly — do not mock them.
- If a test needs import-time env such as `DYAD_ENGINE_URL` or
  `E2E_TEST_BUILD`, keep a small local `vi.hoisted` block before app imports and
  still pass `electronMock: h` from `@/testing/hybrid.setup`.
- On test failure, `src/testing/hybrid.setup.ts` prints
  `prettyDOM(document.body, 20_000)`. Bridge event history is still available on
  `harness.bridge.sentEvents`; automatic failure printing of those events needs
  a future harness/bridge hook to expose the active bridge to the setup file.

---

## 3. API reference

### `setupHybridChatHarness(options): Promise<HybridChatHarness>`

`options` extends [`ChatFlowHarnessOptions`](./CHAT_FLOW_HARNESS.md#2-setupchatflowharnessoptions)
(so `electronMock` is required, and `fixtureApp`, `autoApprove`, `chatMode`,
`selectedModel`, `provider`, `model`, `settings`, … all pass straight through),
plus:

| Option               | Default | Purpose                                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `silenceActWarnings` | `true`  | Wrap bridge event dispatch in `act` so async stream events don't log "not wrapped in act". |

Common option recipes:

- **seed settings** — `settings: { isTestMode: true, autoApproveChanges: false, ... }`.
- **auto-approve off** — `autoApprove: false` (proposals stay pending; assert the
  approval UI, then drive it).
- **a specific chat mode** — `chatMode: "ask"` seeds `selectedChatMode`; per-turn
  overrides go on `streamChat({ requestedChatMode })` or come from the real chat
  mode selector in the UI.
- **multiple chats** — `const c2 = await harness.createChat()` then
  `harness.mount({ chatId: c2 })`.

### The harness object

Everything on [`ChatFlowHarness`](./CHAT_FLOW_HARNESS.md#harness-object) is
re-exported unchanged (`db`, `appDir`, `appId`, `chatId`, `userDataDir`,
`fakeLlmUrl`, `streamChat`, `getServerDump`, `getAppFiles`, `readAppFile`,
`appFileExists`, `gitLog`, …), plus:

```ts
harness.bridge          // RendererIpcBridge: missingChannels, sentEvents, settleInFlight, pendingCount
harness.mount(opts?)    // render <ChatPanel>; opts: { chatId?, appId? }. Returns RTL RenderResult.
harness.typeInChat(text, opts?)       // seed input + wait for Send enabled -> { sendButton, send() }
harness.waitForStreamEnd(chatId?, ms?)      // resolve on the FIRST chat:response:end (turn 1 only)
harness.waitForNextStreamEnd(chatId?, ms?)  // baseline-aware: resolve on a NEW end (turn 2+, retries)
harness.eventCount(channel)                 // how many events on `channel` the bridge has seen (a baseline)
harness.waitForEvent(channel, predicate?, ms?) // resolve on the first matching bridge event
harness.selectFromBaseUiSelect(trigger, optionMatcher)  // drive a Base UI <Select> in happy-dom
harness.selectChatMode("build" | "ask" | "plan" | "local-agent") // open the chat-mode selector + pick
harness.createChat(appId?)            // insert a chats row -> new chatId
harness.dispose()                     // race-free teardown (see §6)
```

- `mount()` seeds the jotai default store (`selectedAppIdAtom`,
  `selectedChatIdAtom`) and builds a private tanstack route tree with a `/chat`
  route at `/chat?id=<chatId>&appId=<appId>`, because `useStreamChat`/`ChatInput`
  call `useSearch({ from: "/chat" })`. It imports the REAL search schema
  (`chatSearchSchema` from `src/routes/chatSearchSchema.ts`) so the replica can't
  drift from production. It renders `<ChatPanel>` directly — **not** `<ChatPage>`,
  which would drag in `PreviewPanel` (Monaco, iframe runtime).
- `waitForEvent`/`waitForStreamEnd`/`waitForNextStreamEnd` read
  `bridge.sentEvents` (every `event.sender.send` the main process pushed to the
  renderer). The payload is `event.args[0]`.
- **Second turn / retry in one `it`? Use `waitForNextStreamEnd`.**
  `waitForStreamEnd` matches the FIRST `chat:response:end`, so a second turn or a
  retry resolves **immediately** on the previous turn's stale event and your
  main-side asserts race the real work. `waitForNextStreamEnd(chatId?)` snapshots
  the current end-count **synchronously** and resolves only when a NEW one
  arrives. Call it (or capture its promise) **before** the action that starts the
  new turn:
  ```ts
  const nextEnd = harness.waitForNextStreamEnd(harness.chatId); // snapshot baseline now
  fireEvent.click(retryButton); // start the new turn
  await waitFor(() => expect(screen.getByText(/counter=2/)).toBeTruthy());
  await nextEnd; // gate on the NEW end
  ```
  `eventCount(channel)` is the general-purpose baseline primitive if you need it
  for a non-end channel.
- **Driving a Base UI (Radix) `<Select>`** (the chat-mode selector, model picker,
  etc.): a bare `fireEvent.click` on the trigger or option does nothing in
  happy-dom. Use `selectFromBaseUiSelect(trigger, /OptionText/)`, which focuses +
  ArrowDowns to open the popup, then pointerDown+pointerUp+click+Enter on the
  matched option to commit. `selectChatMode(mode)` wraps it for the chat-mode
  selector and waits for the trigger's `aria-label` to reflect the pick (which is
  what persists `chatMode` onto the chat row).

---

## 3b. Cookbook: patterns you'll reuse

### Call `mount()` in EVERY `it` (RTL auto-cleanup)

`globals: true` in `vitest.config.ts` auto-registers React Testing Library's
`afterEach(cleanup)`, which **unmounts the tree after every `it`**. So each test
starts with an empty DOM — a `mount()` in `beforeAll`/`beforeEach` or a previous
`it` is already gone. Mount inside the test:

```ts
it("first turn", async () => {
  harness.mount(); // required
  const { send } = await harness.typeInChat("hi");
  send();
  // ...
});

it("second turn", async () => {
  harness.mount(); // required again — the first it's tree was unmounted.
  // The same chat reloads from the db (its earlier messages are still there),
  // so this turn appends, exactly like the node harness's sequential streamChat.
  // ...
});
```

The db, git checkout, and fake server live on the single `beforeAll` harness and
persist across `it`s; only the **React tree** is per-`it`.

### Keep describe/it names identical → snapshots become a cross-harness oracle

When you convert a node `chat:stream` test that has `toMatchSnapshot()`, keep the
`describe` and `it` names **byte-identical** to the node version and reuse the
same `__snapshots__/*.snap` file. The snapshot key is derived from those names,
so the existing (node-written) snapshot now also gates the UI-driven payload —
proving that clicking the real Send button sends the LLM **exactly** the same
`getServerDump()` bytes the node harness did. A drift shows up as a snapshot
diff. `chat_mode.hybrid.test.ts` does this: its
`chat-mode-build-all-messages` / `chat-mode-ask-all-messages` snapshots are
unchanged from the node era. Do not rewrite or `-u` these on conversion — an
unchanged snapshot is the whole point.

---

## 4. The typing concession

happy-dom cannot type into Lexical's `contenteditable`, so `typeInChat` does not
simulate keystrokes. It writes exactly what `LexicalChatInput`'s `onChange`
writes — `chatInputValuesByIdAtom[chatId] = text` — then waits for the real Send
button to enable and hands you a `send()` that clicks it. From the click onward
the path is 100% real (`ChatInput.handleSubmit` → `chat:stream`).

This means you exercise everything **except** the Lexical editor's own
keystroke→state plumbing. If a test's entire point is Lexical input behavior,
it stays a Playwright E2E test.

---

## 5. The stream-end teardown rule

The streamed assistant **text** reaches the DOM before the main-process
post-stream work (tag processing, file writes, git commit, approval) finishes.
So a test that asserts on files/git/db **must** await the real end-of-stream
event first:

```ts
await waitFor(() => expect(screen.getByText(/AFTER TAG/)).toBeTruthy());
await harness.waitForStreamEnd(harness.chatId); // <-- gate main-side asserts on this
expect(harness.gitLog().length).toBeGreaterThan(1);
```

Skipping this races the commit/approval and yields flakes or "Database not
initialized" during teardown.

---

## 6. Race-free teardown (handled for you)

`harness.dispose()` unwinds in a fixed order so background UI queries can't hit a
closed db:

1. `cleanup()` — unmount the React tree (stops new UI-driven invokes);
2. `bridge.settleInFlight()` — await every in-flight `invoke` (the UI fires
   background queries — proposals, token counts, codebase scans — whose handlers
   read the db);
3. `queryClient.clear()` for each mounted tree + reset the shared jotai store;
4. `bridge.uninstall()` (remove `window.electron`);
5. the node harness `dispose()` (closes the db, removes the temp dir).

You just call `await harness.dispose()` in `afterAll`. Because the jotai default
store and the app `db` are process singletons, the same rule as the node harness
applies: **one harness per test file**, run under the default forks pool.

---

## 7. Pitfalls

- **Missing `waitForStreamEnd` before main-side asserts** → flaky files/git/db
  and teardown "Database not initialized". See §5.
- **Mounting `ChatPage` instead of `ChatPanel`** → pulls in Monaco/iframe and
  hangs. Always mount via `harness.mount()`.
- **Trying to type into the editor** → happy-dom can't. Use `typeInChat`. See §4.
- **Reordering harness imports** → `hybrid_chat_harness.tsx` imports
  `./chat_flow_harness` **before** `@/components/ChatPanel` on purpose: loading an
  app module first initializes `tslib`'s CJS interop, without which ChatPanel's
  transitive `react-remove-scroll` throws `tslib_1.__importStar is not a function`
  at load. Don't reorder those imports.
- **`get-proposal` / `checkProblems` / cloud-sandbox / desktop-config log lines**
  are benign. Registering the full handler set means the UI polls handlers that
  have nothing to do (no tsc worker in the vitest bundle, no Pro key, a
  CORS-blocked `api.dyad.sh/v1/desktop-config`). They are caught and logged, not
  failures. The act, pnpm-install, and DB-teardown noise **is** handled (§6, §8).

---

## 8. Product-code touchpoints (test-only guards)

Two product modules short-circuit an eager side effect under test so it can't
fire during a hybrid run. Both are inert in production/dev/E2E and must stay:

- **Implicit pnpm install** — the UI's `nodejs-status` query, when pnpm is
  missing, schedules a **real** background `npm install pnpm`.
  `node_handlers.ts`'s `scheduleManagedPnpmInstall` returns early when
  `process.env.DYAD_SKIP_MANAGED_PNPM_INSTALL === "true"` (the harness sets it).
  It only skips the _implicit_ convenience install; an explicit `installPnpm`
  handler call is unaffected, and production never sets the flag.
- **Monaco eager init** — `src/components/chat/monaco.ts` runs `loader.init()` at
  module load to register editor themes. The chat message tree imports it
  transitively (`DyadWrite` → `FileEditor`), so a hybrid test pulls it in even
  though it never renders an editor. The async (CDN) load gets **canceled on
  teardown**, surfacing as a `Canceled` **unhandled rejection** that fails the
  whole run (non-zero exit) even when every `it` passed. `monaco.ts` now guards
  the `loader.init()` call behind `process.env.VITEST !== "true"`. Do not remove
  this guard, and do not "fix" a `Canceled: Canceled` rejection by re-enabling it.

---

## 9. Pro / engine routing (import-time env)

Same limitation as the node harness (see
[CHAT_FLOW_HARNESS.md §7](./CHAT_FLOW_HARNESS.md#7-known-gaps-and-quirks)):
`get_model_client` reads `DYAD_ENGINE_URL` / `DYAD_GATEWAY_URL` at
module-import time, before the harness's ephemeral fake-server port exists. To
exercise engine/gateway routes, start a second fake-LLM server (or relay) inside
`vi.hoisted` and set the env vars there, before any app module imports:

```tsx
const engineServer = await vi.hoisted(async () => {
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const server = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${server.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${server.url}/gateway/v1`;
  return server;
});
```

A first-class harness option for this is a welcome follow-up; for now the
`vi.hoisted` relay is the pattern for both harnesses.

---

## 10. Limitations: assertions that must stay on the node harness

- **Request-header assertions are node-only.** The hybrid env enables fetch via
  `disableSameOriginPolicy`, but happy-dom's fetch still **strips
  CORS-forbidden request headers** (notably `Authorization`) before the
  main-process HTTP call goes out. So a test that asserts on the request headers
  the fake server received — e.g. engine/gateway auth via
  `getServerDump().headers` / `dump.headers` — will see them missing under the
  hybrid harness even though production sends them. Keep those assertions on the
  **node** `setupChatFlowHarness` (no DOM, real Node fetch, headers intact). The
  hybrid harness is for asserting on the rendered UI, not on outbound auth
  headers.
- **Cancel-mid-stream tests are node-only.** Aborting the chat's
  `AbortController` does not reliably tear down an in-flight happy-dom fetch to
  the fake server — the abort is only observed when the next chunk arrives, so
  a stalled/slow fixture keeps the stream (and teardown) alive for tens of
  seconds. Tests that cancel while a response is still streaming (e.g.
  `local_agent_cancel_todos`) stay on the node harness. (A cancel that races a
  short, fast response — `cancelled_message` — works because the stream ends
  promptly either way.)
- **`chatMode` option trap.** The harness `chatMode` option only seeds
  `settings.selectedChatMode`; `ChatInput` submits the chat row's mode /
  effective default, and with Dyad Pro enabled the effective default is
  `local-agent`. An ask-mode hybrid test silently runs in local-agent mode
  unless it drives the real selector: `await harness.selectChatMode("ask")`
  (see `local_agent_ask.hybrid.test.ts`).
- **Post-stream DOM duplication.** Around stream end, assistant text can
  transiently render in two nodes (streamed + persisted renderings), so
  `getByText` may throw "found multiple elements". Use
  `getAllByText(...).length > 0` in `waitFor` for text that lands near
  `chat:response:end` (see `context_compaction.hybrid.test.ts`).
