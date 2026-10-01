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
import {
  reviewToolAction,
  SHELL_REVIEW_TIMEOUT_MS,
} from "./tool_safety_reviewer";
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
  it.each(["garbage", '{"decision":"allow"}'])(
    "blocks invalid shell verdict %s",
    async (text) => {
      mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
      expect(await reviewToolAction(input)).toEqual({
        decision: "block",
        unavailable: true,
        reason: "The safety reviewer returned an invalid verdict.",
      });
    },
  );
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

it.each([
  'Here: {"reason":"safe read","decision":"allow"}',
  '```json\n{"reason":"safe read","decision":"allow"}\n```',
])("accepts a wrapped shell verdict: %s", async (text) => {
  mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
  expect(await reviewToolAction(input)).toEqual({
    decision: "allow",
    reason: "safe read",
  });
});
it("gives shell preparation and multi-step inference time beyond the MCP deadline", async () => {
  vi.useFakeTimers();
  try {
    mocks.streamText.mockImplementation(() => ({
      text: new Promise((resolve) =>
        setTimeout(
          () => resolve('{"decision":"allow","reason":"Inspected migration"}'),
          20000,
        ),
      ),
    }));
    const pending = reviewToolAction({
      ...input,
      timeoutMs: SHELL_REVIEW_TIMEOUT_MS,
      prepare: async () => {
        await new Promise((resolve) => setTimeout(resolve, 9000));
        return { payload: "migration" };
      },
    });
    await vi.advanceTimersByTimeAsync(29000);
    expect(await pending).toEqual({
      decision: "allow",
      reason: "Inspected migration",
    });
  } finally {
    vi.useRealTimers();
  }
});
it("bounds stalled shell setup by its own deadline and never starts inference", async () => {
  vi.useFakeTimers();
  try {
    mocks.getModelClient.mockReturnValue(new Promise(() => {}));
    const pending = reviewToolAction({
      ...input,
      timeoutMs: SHELL_REVIEW_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(SHELL_REVIEW_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      unavailable: true,
      reason: "Tool safety review timed out.",
    });
    expect(mocks.streamText).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

import { ShellReviewCatalogTooLargeError } from "./tool_safety_reviewer";
it("surfaces actionable catalog overflow without starting paid inference", async () => {
  const result = await reviewToolAction({
    ...input,
    prepare: async () => {
      throw new ShellReviewCatalogTooLargeError();
    },
  });
  expect(result).toMatchObject({
    decision: "block",
    unavailable: true,
    reason: expect.stringContaining("Disconnect unused MCP servers"),
  });
  expect(mocks.getModelClient).not.toHaveBeenCalled();
  expect(mocks.streamText).not.toHaveBeenCalled();
});
