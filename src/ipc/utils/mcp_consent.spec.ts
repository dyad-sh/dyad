import { describe, it, expect, vi } from "vitest";

// getStoredConsent reads from the db; an empty result means "ask", which is the
// path that runs the classifier race.
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));
vi.mock("../../db/schema", () => ({ mcpToolConsents: {} }));

import {
  waitForConsent,
  resolveConsent,
  clearPendingMcpConsentsForChat,
  requireMcpToolConsent,
} from "./mcp_consent";

describe("clearPendingMcpConsentsForChat", () => {
  it("resolves pending consents for the chat as declined", async () => {
    const pending = waitForConsent("r1", 42);
    clearPendingMcpConsentsForChat(42);
    await expect(pending).resolves.toBe("decline");
  });

  it("leaves consents for other chats pending", async () => {
    const pending = waitForConsent("r2", 99);
    clearPendingMcpConsentsForChat(42);
    // Not cleared; still resolvable normally.
    resolveConsent("r2", "accept-once");
    await expect(pending).resolves.toBe("accept-once");
  });
});

describe("requireMcpToolConsent (classifier race)", () => {
  const baseParams = {
    serverId: 1,
    serverName: "srv",
    toolName: "tool",
    toolDescription: "does a thing",
    inputPreview: "{}",
    chatId: 7,
  };

  function makeEvent() {
    const send = vi.fn();
    return { event: { sender: { send } } as any, send };
  }

  function lastRequestId(send: ReturnType<typeof vi.fn>): string {
    return send.mock.calls[0][1].requestId as string;
  }

  it("sends a pending prompt, then dismisses it on auto-approve", async () => {
    const { event, send } = makeEvent();
    const result = await requireMcpToolConsent(event, {
      ...baseParams,
      autoApprove: async () => ({ approved: true, reason: "safe" }),
    });

    expect(result).toEqual({ approved: true, autoApprovedReason: "safe" });
    expect(send).toHaveBeenCalledWith(
      "mcp:tool-consent-request",
      expect.objectContaining({ classifierPending: true }),
    );
    expect(send).toHaveBeenCalledWith(
      "mcp:tool-consent-resolved",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("surfaces the reason and waits for the user when the classifier asks", async () => {
    const { event, send } = makeEvent();
    const pending = requireMcpToolConsent(event, {
      ...baseParams,
      autoApprove: async () => ({ approved: false, reason: "risky" }),
    });

    // The classifier wins the race with "ask" and emits the classified event.
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        "mcp:tool-consent-classified",
        expect.objectContaining({ reason: "risky" }),
      ),
    );
    resolveConsent(lastRequestId(send), "accept-once");
    await expect(pending).resolves.toEqual({ approved: true });
  });

  it("lets the user decide before the classifier finishes", async () => {
    const { event, send } = makeEvent();
    // Classifier never resolves; only the user can settle the prompt.
    const pending = requireMcpToolConsent(event, {
      ...baseParams,
      autoApprove: () => new Promise(() => {}),
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    resolveConsent(lastRequestId(send), "decline");
    await expect(pending).resolves.toEqual({ approved: false });
    expect(send).not.toHaveBeenCalledWith(
      "mcp:tool-consent-resolved",
      expect.anything(),
    );
  });
});
