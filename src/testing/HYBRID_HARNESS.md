# Hybrid Chat Harness

`setupHybridChatHarness` mounts real React surfaces under happy-dom and wires
them to the real main-process IPC handlers in the same process. It composes the
node chat-flow harness, full IPC registration, and a renderer IPC bridge.

Use it only when the behavior must be observed through rendered UI or driven
through a real renderer event. Prefer the node harness for files, Git, database,
stream protocol, or request payload assertions.

## Test skeleton

```tsx
import { cleanup, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("rendered chat behavior", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    await harness.dispose();
  });

  it("renders a streamed response", async () => {
    harness.mount();
    const { send } = await harness.typeInChat("tc=agent/simple-response");
    send();
    await harness.waitForStreamEnd(harness.chatId);
    expect(await screen.findByTestId("messages-list")).toBeTruthy();
  });
});
```

Call `mount()` or `mountSurface()` in every test. Each mount gets a new Jotai
store. React Testing Library cleanup removes the tree but does not dispose the
main-process harness.

## Setup options

All node harness options are available. Hybrid-specific options are:

- `silenceActWarnings`: wrap bridge dispatch in `act`; defaults to
  `true`.
- `assertNoMissingChannels`: fail disposal if renderer code called an
  unregistered channel; defaults to `true`.
- `testBuild`: set call-time E2E environment for fake GitHub/catalog routes.
  Modules that capture `IS_TEST_BUILD` at import time still require a
  `vi.hoisted` environment assignment before imports.

## Mounting

`mount()` renders ChatPanel. `mountSurface()` supports the home, chat,
app-details, database, import, settings, provider-settings, and media routes.
Mount options can add plan/security panels, app/chat lists, the privacy banner,
title bar, and renderer event wiring.

## Common helpers

- `typeInChat`, `setChatInputValue`, `pressEnterInChat`
- `setChatAttachments`
- `waitForStreamEnd`, `waitForNextStreamEnd`, `waitForEvent`
- `waitForRenderedText`
- `openPopover`, `clickMenuItem`, `findDialog`, `confirmDialog`
- `setSwitch`, `selectFromBaseUiSelect`, `selectChatMode`
- `createChat`
- `bridge.settleInFlight()`
- route, plan-handoff, stream-residue, and app-runtime state helpers

Happy-dom cannot type into the Lexical contenteditable reliably, so chat input
helpers seed the same Jotai state that Lexical's `onChange` owns, then drive
the real submit path. Base UI popovers and selects also require the harness
helpers because a bare click is insufficient in happy-dom.

## Stream synchronization

Rendered text can appear before main-process finalization, Git commits, and
database post-effects complete. Await `waitForStreamEnd` before asserting
main-side outcomes.

For a second turn in the same test, create the promise with
`waitForNextStreamEnd` immediately before the action. It captures an event
baseline so an earlier terminal event cannot satisfy the new wait.

Call `bridge.settleInFlight()` when a renderer action awaits IPC post-effects
that can outlive the first visible DOM change.

## Teardown and isolation

- Use one harness per test file.
- Do not overlap streams for the same chat.
- Always call `cleanup()` after each mounted test and `dispose()` after all
  tests.
- Keep provider roots and machine providers in the harness mount; do not add
  production fallbacks solely for tests.
- The shared Electron utility-process mock is inert. Mock a processor in
  `hybrid.setup.ts` when a tested surface crosses a packaged worker boundary.
- Missing IPC channels are product or harness wiring failures. Do not suppress
  them unless the test intentionally exercises that failure.
