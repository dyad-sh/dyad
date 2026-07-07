// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
//
// Migrated from e2e-tests/retry.spec.ts, then converted from the node chat-flow
// harness to the HYBRID harness. This is the maximum-fidelity conversion: after
// the first response renders, it finds the REAL "Retry" button in the rendered
// message list and clicks it (MessagesList.tsx), instead of invoking
// chat:stream with redo=true directly.
//
// The Retry button re-streams the last user prompt with `redo: true`, which
// makes chat:stream delete the most recent user+assistant pair before streaming
// again. The fake server's "[increment]" prompt returns a monotonic counter, so
// a successful retry replaces "counter=1" with "counter=2" instead of appending
// a new message pair.
//
// Fidelity note: with only one turn on the chat, `versions` (loaded once on
// mount) holds just the fixture's initial commit, so the Retry handler's
// `versions[0].oid === lastMessage.commitHash` check is false and it takes the
// plain `redo: true` path — the exact behavior the node test invoked directly.
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

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";

describe("retry (hybrid)", () => {
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

  it("retry - should work", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // First turn: the fake server responds with counter=1.
    const { send } = await harness.typeInChat("[increment]");
    send();
    await waitFor(() => expect(screen.getByText(/counter=1/)).toBeTruthy(), {
      timeout: 20_000,
    });
    await harness.waitForStreamEnd(harness.chatId);

    // Original db assertions for the first turn.
    const firstMessages = await harness.db.query.messages.findMany();
    expect(firstMessages).toHaveLength(2);
    expect(firstMessages[0].role).toBe("user");
    expect(firstMessages[0].content).toBe("[increment]");
    expect(firstMessages[1].role).toBe("assistant");
    expect(firstMessages[1].content).toContain("counter=1");

    // Click the REAL Retry button (rendered in the footer once streaming ends).
    const retryButton = await screen.findByRole("button", { name: /Retry/ });
    // Baseline-aware gate: snapshot the current end-count BEFORE clicking retry,
    // then await a NEW chat:response:end. Plain waitForStreamEnd would resolve
    // immediately on the first turn's stale event.
    const retriedStreamEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(retryButton);

    // The retried request replaces counter=1 with counter=2 in the DOM.
    await waitFor(
      () => {
        expect(screen.getByText(/counter=2/)).toBeTruthy();
        expect(screen.queryByText(/counter=1/)).toBeNull();
      },
      { timeout: 20_000 },
    );

    // Wait for the retry's OWN end-of-stream before asserting main-side outcomes.
    await retriedStreamEnd;

    // No error events were emitted during the flow.
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // Still exactly one user+assistant pair — the retry replaced, not appended.
    const retriedMessages = await harness.db.query.messages.findMany();
    expect(retriedMessages).toHaveLength(2);
    expect(retriedMessages[0].role).toBe("user");
    expect(retriedMessages[0].content).toBe("[increment]");
    expect(retriedMessages[1].role).toBe("assistant");

    // The counter was incremented by the retried request.
    expect(retriedMessages[1].content).toContain("counter=2");
    expect(retriedMessages[1].content).not.toContain("counter=1");

    // The replacement rows are new db rows (old pair was deleted).
    expect(retriedMessages[0].id).not.toBe(firstMessages[0].id);
    expect(retriedMessages[1].id).not.toBe(firstMessages[1].id);
  }, 60_000);
});
