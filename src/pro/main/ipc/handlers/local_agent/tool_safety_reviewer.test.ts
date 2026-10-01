import type { UserSettings } from "@/lib/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  getModelClient: vi.fn(),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  streamText: mocks.streamText,
}));
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.getModelClient,
}));
import { reviewToolAction } from "./tool_safety_reviewer";
const input = {
  settings: {} as UserSettings,
  system: "policy",
  fallback: "block" as const,
  prepare: async () => ({ payload: "exact command" }),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
});
describe("mandatory tool reviewer", () => {
  it.each([
    "garbage",
    '{"decision":"allow"}',
    'Here: {"reason":"x","decision":"allow"}',
  ])("blocks invalid shell verdict %s", async (text) => {
    mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
    expect(await reviewToolAction(input)).toEqual({
      decision: "block",
      unavailable: true,
      reason: "The safety reviewer returned an invalid verdict.",
    });
  });
  it("accepts a structured allow and preserves exact command data", async () => {
    mocks.streamText.mockReturnValue({
      text: Promise.resolve('{"reason":"Bounded task","decision":"allow"}'),
    });
    expect((await reviewToolAction(input)).decision).toBe("allow");
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      { name: "gpt-6-luna", provider: "openai" },
      input.settings,
    );
    expect(mocks.streamText.mock.calls[0][0].messages[0].content).toBe(
      "exact command",
    );
  });
  it("times out model setup as well as generation", async () => {
    vi.useFakeTimers();
    try {
      mocks.getModelClient.mockReturnValue(new Promise(() => {}));
      const pending = reviewToolAction(input);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toEqual({
        decision: "block",
        unavailable: true,
        reason: "Tool safety review timed out.",
      });
      expect(mocks.streamText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels evidence collection and never starts inference afterward", async () => {
    let finish!: () => void;
    const controller = new AbortController();
    const pending = reviewToolAction({
      ...input,
      signal: controller.signal,
      prepare: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { payload: "data" };
      },
    });
    controller.abort();
    expect(await pending).toEqual({
      decision: "block",
      unavailable: true,
      reason: "Tool safety review was cancelled.",
    });
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getModelClient).not.toHaveBeenCalled();
  });
});

it("accepts a structured ask verdict for shell authorization", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve(
      '{"decision":"ask","reason":"Delete the production service; approval required."}',
    ),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "ask",
    reason: "Delete the production service; approval required.",
  });
});
