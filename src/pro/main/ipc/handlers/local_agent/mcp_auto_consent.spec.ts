import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  getModelClient: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: mocks.streamText };
});
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.getModelClient,
}));

import {
  buildMcpAutoApprove,
  classifyMcpToolConsent,
} from "./mcp_auto_consent";

function withText(text: string) {
  mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
  mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
}

const baseInput = {
  serverName: "srv",
  toolName: "tool",
  toolDescription: "does a thing",
  inputSchema: { type: "object" },
  args: { a: 1 },
  recentTurns: [],
  settings: {} as any,
};

describe("classifyMcpToolConsent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns allow and the reason for a valid allow decision", async () => {
    withText('{"reason":"safe read","decision":"allow"}');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("allow");
    expect(d.reason).toBe("safe read");
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      { name: "dyad/auto-approver", provider: "openai" },
      baseInput.settings,
    );
  });

  it("parses a decision wrapped in prose/code fences", async () => {
    withText('Here:\n```json\n{"reason":"x","decision":"ask"}\n```');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("fails closed (ask) on unparseable output", async () => {
    withText("no json here at all");
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("fails closed (ask) when the model call throws", async () => {
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
    mocks.streamText.mockImplementation(() => {
      throw new Error("network");
    });
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("ask");
  });

  it("defaults the reason when the model omits it", async () => {
    withText('{"decision":"allow"}');
    const d = await classifyMcpToolConsent(baseInput);
    expect(d.decision).toBe("allow");
    expect(d.reason).toBeTruthy();
  });

  it("fails closed (ask) when the model never responds (timeout)", async () => {
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
    // Stream that never resolves, so only the timeout can settle the race.
    mocks.streamText.mockReturnValue({ text: new Promise<string>(() => {}) });
    vi.useFakeTimers();
    try {
      const pending = classifyMcpToolConsent(baseInput);
      await vi.advanceTimersByTimeAsync(8000);
      const d = await pending;
      expect(d.decision).toBe("ask");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildMcpAutoApprove", () => {
  const baseParams = {
    settings: { autoApproveSafeMcpTools: true } as any,
    isDyadPro: true,
    chatId: 1,
    serverName: "srv",
    toolName: "tool",
    toolDescription: "does a thing",
    inputSchema: { type: "object" },
    args: { a: 1 },
  };

  it("does not build an auto-approve callback for Dyad Free turns", () => {
    const autoApprove = buildMcpAutoApprove({
      ...baseParams,
      freeModelMode: true,
    });

    expect(autoApprove).toBeUndefined();
  });

  it("builds an auto-approve callback for Pro non-free turns when enabled", () => {
    const autoApprove = buildMcpAutoApprove({
      ...baseParams,
      freeModelMode: false,
    });

    expect(autoApprove).toEqual(expect.any(Function));
  });
});
