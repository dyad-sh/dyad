// @vitest-environment node
//
// Migrated from e2e-tests/retry.spec.ts.
//
// The UI "Retry" button re-streams the last user prompt with `redo: true`
// (see MessagesList.tsx), which makes chat:stream delete the most recent
// user+assistant pair before streaming again. The fake server's "[increment]"
// prompt returns a monotonic counter, so a successful retry replaces
// "counter=1" with "counter=2" instead of appending a new message pair.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("retry (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("retry - should work", async () => {
    // First turn: the fake server responds with counter=1.
    const first = await harness.streamChat("[increment]");
    expect(first.result).toBe(harness.chatId);
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0].role).toBe("user");
    expect(first.messages[0].content).toBe("[increment]");
    expect(first.messages[1].role).toBe("assistant");
    expect(first.messages[1].content).toContain("counter=1");

    // Retry: re-stream the same prompt with redo=true (what the Retry button
    // does). The previous user+assistant pair is deleted and replaced.
    const retried = await harness.streamChat("[increment]", { redo: true });
    expect(retried.result).toBe(harness.chatId);
    expect(retried.eventsFor("chat:response:error")).toHaveLength(0);

    // Still exactly one user+assistant pair — not appended.
    expect(retried.messages).toHaveLength(2);
    expect(retried.messages[0].role).toBe("user");
    expect(retried.messages[0].content).toBe("[increment]");
    expect(retried.messages[1].role).toBe("assistant");

    // The counter was incremented by the retried request.
    expect(retried.messages[1].content).toContain("counter=2");
    expect(retried.messages[1].content).not.toContain("counter=1");

    // The replacement rows are new db rows (old pair was deleted).
    expect(retried.messages[0].id).not.toBe(first.messages[0].id);
    expect(retried.messages[1].id).not.toBe(first.messages[1].id);
  }, 30_000);
});
