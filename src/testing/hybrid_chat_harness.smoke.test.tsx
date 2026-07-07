// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
//
// Smoke test for setupHybridChatHarness — the real React <ChatPanel> (RTL under
// happy-dom) wired to the REAL main-process IPC handlers in the same Node
// process. It is the reference conversion for the hybrid harness.
//
// Flow under test: click the real Send button -> real `chat:stream` handler ->
// in-process fake-LLM server (HTTP) -> real tag processor / file writes / git /
// sqlite -> `chat:response:chunk` events fan back through the bridge -> jotai
// atoms update -> the assistant message renders in the DOM.
//
// happy-dom (not node) is required for RTL. `fetch.disableSameOriginPolicy`
// relaxes happy-dom's CORS simulation for main-process fetches; the env-options
// docblock must be at the very TOP of the file (vitest only reads it from the
// first comment). One benign warning still logs at settings-load — the
// api.dyad.sh/v1/desktop-config fetch is CORS-blocked; it is caught and
// harmless. See HYBRID_HARNESS.md.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// Keep telemetry offline.
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

// The app initializes i18next in renderer.tsx (not imported here); a minimal
// mock keeps every component's `t()` working.
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

describe("hybrid chat harness (smoke)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      // isTestMode makes MessagesList render a plain (non-Virtuoso) list — the
      // same rendering path the Playwright E2E suite exercises.
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("clicking Send drives the real chat:stream handler and renders the streamed assistant message", async () => {
    harness.mount();

    // The chat UI mounted with the real (empty) chat loaded over real IPC.
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const prompt = "tc=dyad-write-angle";
    const { send } = await harness.typeInChat(prompt);
    send();

    // The user's message shows up first...
    await waitFor(() => expect(screen.getByText(prompt)).toBeTruthy(), {
      timeout: 15_000,
    });
    // ...then the streamed assistant response text renders in the DOM.
    await waitFor(() => expect(screen.getByText(/AFTER TAG/)).toBeTruthy(), {
      timeout: 20_000,
    });

    // The streamed text hits the DOM before the main-process post-stream work
    // (tag processing, file writes, commit, approval) completes — wait for the
    // real end-of-stream event before asserting main-side outcomes.
    await harness.waitForStreamEnd(harness.chatId);

    // Prove it went through the REAL main-process pipeline:
    // 1. The dyad-write tag was executed against the real app checkout.
    expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
    expect(harness.readAppFile("src/foo/bar.tsx").trim()).toBe(
      "// BEGINNING OF FILE",
    );
    // 2. A real commit was made.
    expect(harness.gitLog().length).toBeGreaterThan(1);
    // 3. Real db rows exist and were auto-approved.
    const messages = await harness.db.query.messages.findMany();
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant!.content).toContain("AFTER TAG");
    expect(assistant!.approvalState).toBe("approved");
    expect(assistant!.commitHash).toBeTruthy();
    // 4. The renderer got the stream events through the bridge.
    expect(bridgeSawChunk(harness)).toBe(true);
    // 5. Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});

function bridgeSawChunk(harness: HybridChatHarness): boolean {
  return harness.bridge.sentEvents.some(
    (e) => e.channel === "chat:response:chunk",
  );
}
