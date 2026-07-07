// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
//
// Migrated from e2e-tests/main.spec.ts, then converted from the node
// chat-flow harness to the HYBRID harness (real <ChatPanel> over the real IPC
// stack). The e2e spec sent two prompts and snapshotted the rendered messages
// list; this drives the same round trip through the real UI (type -> click the
// real Send button) and asserts the streamed assistant text lands in the DOM,
// then keeps the original db / file / git assertions after stream end.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: async () => {} },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";

function errorEvents(harness: HybridChatHarness) {
  return harness.bridge.sentEvents.filter(
    (e) => e.channel === "chat:response:error",
  );
}

describe("main chat flow (hybrid)", () => {
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

  it("simple message to custom test model", async () => {
    harness.mount();

    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Type + click the real Send button (the whole path is real from here).
    const { send } = await harness.typeInChat("hi");
    send();

    // The user's prompt renders first...
    await waitFor(() => expect(screen.getByText("hi")).toBeTruthy(), {
      timeout: 15_000,
    });
    // ...then the streamed assistant response. The canned response's dyad-write
    // tag is parsed into a DyadWrite card; the trailing literal text ("EOM")
    // renders directly and is what we can assert on in the DOM.
    await waitFor(() => expect(screen.getByText(/EOM/)).toBeTruthy(), {
      timeout: 20_000,
    });

    // Gate main-side assertions on the real end-of-stream event.
    await harness.waitForStreamEnd(harness.chatId);
    expect(errorEvents(harness)).toHaveLength(0);

    // Original node-harness assertions, preserved:
    const messages = await harness.db.query.messages.findMany();
    expect(messages).toHaveLength(2);
    const [userMessage, assistantMessage] = messages;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("hi");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toContain('<dyad-write path="file1.txt">');
    expect(assistantMessage.content).toContain("EOM");

    // The dyad-write was applied and committed (auto-approve).
    expect(harness.readAppFile("file1.txt").trim()).toBe("A file (2)");
    expect(assistantMessage.approvalState).toBe("approved");
    expect(assistantMessage.commitHash).toBeTruthy();

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);

  it("basic message to custom test model", async () => {
    // RTL auto-cleanup (global afterEach) unmounted the previous test's tree, so
    // remount. The same chat is reloaded from the db (it already has the 2
    // messages from the first turn); this second turn appends to it, exactly
    // like the node harness's sequential streamChat.
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=basic");
    send();

    await waitFor(() => expect(screen.getByText("tc=basic")).toBeTruthy(), {
      timeout: 15_000,
    });
    await waitFor(
      () =>
        expect(
          screen.getByText(/This is a simple basic response/),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    await harness.waitForStreamEnd(harness.chatId);
    expect(errorEvents(harness)).toHaveLength(0);

    // Second turn appends to the same chat.
    const messages = await harness.db.query.messages.findMany();
    expect(messages).toHaveLength(4);
    const userMessage = messages[2];
    const assistantMessage = messages[3];
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("tc=basic");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content.trim()).toBe(
      "This is a simple basic response",
    );
  }, 60_000);
});
