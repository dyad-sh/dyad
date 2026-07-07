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

Hybrid harness tests are named `*.integration.test.ts` or
`*.integration.test.tsx`. The Vitest `integration` project supplies
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
- If a test needs genuinely import-time env such as `E2E_TEST_BUILD`, keep a
  small local `vi.hoisted` block before app imports and still pass
  `electronMock: h` from `@/testing/hybrid.setup`.
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

| Option                    | Default | Purpose                                                                                    |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `silenceActWarnings`      | `true`  | Wrap bridge event dispatch in `act` so async stream events don't log "not wrapped in act". |
| `assertNoMissingChannels` | `true`  | Fail teardown if renderer code invoked an unregistered IPC channel.                        |

Common option recipes:

- **seed settings** — `settings: { isTestMode: true, autoApproveChanges: false, ... }`.
- **auto-approve off** — `autoApprove: false` (proposals stay pending; assert the
  approval UI, then drive it).
- **a specific chat mode** — `chatMode: "ask"` seeds `selectedChatMode`; per-turn
  overrides go on `streamChat({ requestedChatMode })` or come from the real chat
  mode selector in the UI.
- **multiple chats** — `const c2 = await harness.createChat()` then
  `harness.mount({ chatId: c2 })`.
- **Dyad Pro / engine routes** — pass `engine: true` so
  `DYAD_ENGINE_URL` / `DYAD_GATEWAY_URL` point at the harness fake server.

### The harness object

Everything on [`ChatFlowHarness`](./CHAT_FLOW_HARNESS.md#harness-object) is
re-exported unchanged (`db`, `appDir`, `appId`, `chatId`, `userDataDir`,
`fakeLlmUrl`, `streamChat`, `getServerDump`, `getAppFiles`, `readAppFile`,
`appFileExists`, `gitLog`, …), plus:

```ts
harness.bridge          // RendererIpcBridge: missingChannels, sentEvents, settleInFlight, pendingCount
harness.mount(opts?)    // render <ChatPanel>; opts: { chatId?, appId? }. Returns RTL RenderResult.
harness.mountSurface(opts?) // render /chat, /app-details, /settings, /media, etc.
harness.typeInChat(text, opts?)       // seed input + wait for Send enabled -> { sendButton, send() }
harness.pressEnterInChat(text, opts?) // seed input + Lexical Enter submit (QUEUES while streaming)
harness.waitForStreamEnd(chatId?, ms?)      // consume the NEXT unconsumed chat:response:end (per chatId)
harness.waitForNextStreamEnd(chatId?, ms?)  // baseline-aware: resolve on a NEW end past the call point
harness.eventCount(channel)                 // how many events on `channel` the bridge has seen (a baseline)
harness.waitForEvent(channel, predicate?, ms?) // resolve on the first matching bridge event
harness.waitForRenderedText(textOrRegex, ms?)  // wait for text with stable match count
harness.selectFromBaseUiSelect(trigger, optionMatcher)  // drive a Base UI <Select> in happy-dom
harness.openPopover(trigger)             // drive a Base UI popover/menu trigger in happy-dom
harness.clickMenuItem(name)              // click a button item in an open popup/dialog
harness.findDialog(name)                 // find a named Base UI Dialog
harness.confirmDialog(dialog, button)    // click dialog action and wait for close
harness.setSwitch(element, checked)       // click a Base UI switch and wait for checked state
harness.selectChatMode("build" | "ask" | "plan" | "local-agent") // open the chat-mode selector + pick
harness.createChat(appId?)            // insert a chats row -> new chatId
harness.dispose()                     // race-free teardown (see §6)
```

- `mount()` creates a fresh Jotai store, seeds `selectedAppIdAtom` /
  `selectedChatIdAtom`, wires the same renderer IPC listeners as the app root,
  mounts the real `ThemeProvider` + `Toaster`, and builds a private tanstack
  route tree with a `/chat` route at `/chat?id=<chatId>&appId=<appId>`, because
  `useStreamChat`/`ChatInput` call `useSearch({ from: "/chat" })`. It imports the
  REAL search schema (`chatSearchSchema` from `src/routes/chatSearchSchema.ts`)
  so the replica can't drift from production. It renders `<ChatPanel>` directly
  — **not** `<ChatPage>`, which would drag in `PreviewPanel` (Monaco, iframe
  runtime).
- `waitForEvent`/`waitForStreamEnd`/`waitForNextStreamEnd` use the bridge's
  event-driven `once()` subscription while keeping `bridge.sentEvents` available
  for debugging/baselines. The payload is `event.args[0]`.
- **`waitForStreamEnd` consumes.** Each call (keyed by `chatId`) hands out the
  next not-yet-consumed `chat:response:end`: the first call in a test resolves
  on turn 1's end even if it already arrived; a second call genuinely waits for
  turn 2's end. A stale prior-turn event can never satisfy a later wait, so
  sequential multi-turn tests can just call it once per turn. For an explicit
  pre-action baseline (e.g. a Retry click where you want to capture the promise
  before acting), `waitForNextStreamEnd(chatId?)` snapshots the current
  end-count **synchronously** and resolves only when a NEW one arrives:
  ```ts
  const nextEnd = harness.waitForNextStreamEnd(harness.chatId); // snapshot baseline now
  fireEvent.click(retryButton); // start the new turn
  await waitFor(() => expect(screen.getByText(/counter=2/)).toBeTruthy());
  await nextEnd; // gate on the NEW end
  ```
  `eventCount(channel)` is the general-purpose baseline primitive if you need it
  for a non-end channel.
- **Driving Base UI popovers/dialogs**: use `openPopover(trigger)` before
  clicking items in overflow menus such as app-details more options. Use
  `clickMenuItem(/Copy app/)` for button-like menu items, `findDialog(/Copy/)`
  to wait for Base UI dialogs, and `confirmDialog(/Delete/, /Delete App/)` when
  the assertion should wait for the dialog to close. These helpers reproduce the
  pointer/focus sequence happy-dom needs; a bare click can leave Base UI popups
  closed.
- **Driving Base UI switches**: use `setSwitch(element, checked)` rather than a
  bare click when the assertion depends on a persisted settings update. It only
  clicks when the switch is not already in the requested state and waits for the
  `aria-checked` state to settle.
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
diff. `chat_mode.integration.test.ts` does this: its
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
3. `queryClient.clear()` for each mounted tree + drop the per-mount Jotai store;
4. `bridge.uninstall()` (remove `window.electron`);
5. the node harness `dispose()` (closes the db, removes the temp dir).

You just call `await harness.dispose()` in `afterAll`. The app `db` is a process
singleton, so the same rule as the node harness applies: **one harness per test
file**, run under the default forks pool. Both harnesses throw on a second setup
before the active one fully disposes.

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

## 9. Pro / engine routing

Pass `engine: true` to route Dyad Engine and Gateway calls to the harness fake
server. `get_model_client` and LM Studio URL reads happen at call time, so tests
no longer need a hoisted relay just to know the fake server's ephemeral port.

---

## 10. Limitations: assertions that must stay on the node harness

- **`chatMode` option trap.** The harness `chatMode` option only seeds
  `settings.selectedChatMode`; `ChatInput` submits the chat row's mode /
  effective default, and with Dyad Pro enabled the effective default is
  `local-agent`. An ask-mode hybrid test silently runs in local-agent mode
  unless it drives the real selector: `await harness.selectChatMode("ask")`
  (see `local_agent_ask.integration.test.ts`).
- **Post-stream DOM duplication.** Around stream end, assistant text can
  transiently render in two nodes (streamed + persisted renderings), so
  `getByText` may throw "found multiple elements". Use
  `harness.waitForRenderedText(...)` for text that lands near
  `chat:response:end` (see `context_compaction.integration.test.ts`).
