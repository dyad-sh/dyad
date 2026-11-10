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
      mocks.streamText.mockReturnValue({
        text: Promise.resolve(text),
        steps: Promise.resolve([{ text }]),
      });
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
      steps: Promise.resolve([
        { text: '{"reason":"Bounded task","decision":"allow"}' },
      ]),
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
    steps: Promise.resolve([
      {
        text: '{"decision":"ask","reason":"Delete the production service; approval required."}',
      },
    ]),
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
  mocks.streamText.mockReturnValue({
    text: Promise.resolve(text),
    steps: Promise.resolve([{ text }]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "allow",
    reason: "safe read",
  });
});
it("uses the newest step verdict when the final step is empty", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve(""),
    steps: Promise.resolve([
      { text: '{"reason":"Checked files","decision":"allow"}' },
      { text: "" },
    ]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "allow",
    reason: "Checked files",
  });
});
it("fails closed when the only allow is in the inspection step and the final step is empty", async () => {
  // Text in a step that called inspect_app_path was generated before the
  // inspection result arrived, so it cannot classify the inspected
  // script. With no verdict after the inspection, fail closed.
  mocks.streamText.mockReturnValue({
    text: Promise.resolve(""),
    steps: Promise.resolve([
      {
        text: '{"reason":"Looks fine","decision":"allow"}',
        toolCalls: [
          {
            toolCallId: "inspect-1",
            toolName: "inspect_app_path",
            input: "{}",
          },
        ],
      },
      { text: "" },
    ]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "block",
    unavailable: true,
    reason: "The safety reviewer returned an invalid verdict.",
  });
});
it("prefers a post-inspection verdict over a pre-inspection allow in the inspection step", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve('{"reason":"Blocked","decision":"block"}'),
    steps: Promise.resolve([
      {
        text: '{"reason":"Looks fine","decision":"allow"}',
        toolCalls: [
          {
            toolCallId: "inspect-1",
            toolName: "inspect_app_path",
            input: "{}",
          },
        ],
      },
      { text: '{"reason":"Blocked","decision":"block"}' },
    ]),
  });
  expect((await reviewToolAction(input)).decision).toBe("block");
});
it("accepts a verdict from the step after an inspection step with no text", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve('{"reason":"Checked files","decision":"allow"}'),
    steps: Promise.resolve([
      {
        text: "",
        toolCalls: [
          {
            toolCallId: "inspect-1",
            toolName: "inspect_app_path",
            input: "{}",
          },
        ],
      },
      { text: '{"reason":"Checked files","decision":"allow"}' },
    ]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "allow",
    reason: "Checked files",
  });
});
it("prefers the newest verdict over an earlier one", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve('{"reason":"Blocked","decision":"block"}'),
    steps: Promise.resolve([
      { text: '{"reason":"Looks fine","decision":"allow"}' },
      { text: '{"reason":"Blocked","decision":"block"}' },
    ]),
  });
  expect((await reviewToolAction(input)).decision).toBe("block");
});
it("fails closed when the newest nonempty step is malformed", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve('{"decision":"blo'),
    steps: Promise.resolve([
      { text: '{"reason":"Looks fine","decision":"allow"}' },
      { text: '{"decision":"blo' },
    ]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "block",
    unavailable: true,
    reason: "The safety reviewer returned an invalid verdict.",
  });
});
it("fails closed when the newest nonempty step has no verdict", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve("Just checking the file."),
    steps: Promise.resolve([
      { text: '{"reason":"Looks fine","decision":"allow"}' },
      { text: "Just checking the file." },
    ]),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "block",
    unavailable: true,
    reason: "The safety reviewer returned an invalid verdict.",
  });
});
it("fails closed when a later review stream errors after an earlier allow", async () => {
  mocks.streamText.mockImplementation(
    (options: { onError: (event: { error: Error }) => void }) => {
      options.onError({ error: new Error("stream failed") });
      return {
        text: Promise.resolve('{"reason":"Looks fine","decision":"allow"}'),
        steps: Promise.resolve([
          { text: '{"reason":"Looks fine","decision":"allow"}' },
        ]),
      };
    },
  );
  expect(await reviewToolAction(input)).toEqual({
    decision: "block",
    unavailable: true,
    reason: "Tool safety review failed during generation.",
  });
});
it("fails closed when onError fires with a falsy error after an earlier allow", async () => {
  mocks.streamText.mockImplementation(
    (options: { onError: (event: { error: unknown }) => void }) => {
      options.onError({ error: undefined });
      return {
        text: Promise.resolve('{"reason":"Looks fine","decision":"allow"}'),
        steps: Promise.resolve([
          { text: '{"reason":"Looks fine","decision":"allow"}' },
        ]),
      };
    },
  );
  expect(await reviewToolAction(input)).toEqual({
    decision: "block",
    unavailable: true,
    reason: "Tool safety review failed during generation.",
  });
});
it("gives shell preparation and multi-step inference time beyond the MCP deadline", async () => {
  vi.useFakeTimers();
  try {
    mocks.streamText.mockImplementation(() => {
      const textPromise = new Promise<string>((resolve) =>
        setTimeout(
          () => resolve('{"decision":"allow","reason":"Inspected migration"}'),
          20000,
        ),
      );
      return {
        text: textPromise,
        steps: textPromise.then((text) => [{ text }]),
      };
    });
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

import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { z } from "zod";
it("reserves a verdict step after six inspections across three tool rounds", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  mocks.streamText.mockImplementation(actual.streamText);
  const inspect = vi.fn(async () => "ordinary app file");
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls++;
      const inspecting = !!options.tools?.length;
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
      ];
      if (inspecting) {
        for (let i = 0; i < 2; i++)
          chunks.push({
            type: "tool-call",
            toolCallId: `inspect-${calls}-${i}`,
            toolName: "inspect_app_path",
            input: "{}",
          });
      } else {
        chunks.push(
          { type: "text-start", id: "verdict" },
          {
            type: "text-delta",
            id: "verdict",
            delta: '{"decision":"allow","reason":"Inspected six files"}',
          },
          { type: "text-end", id: "verdict" },
        );
      }
      chunks.push({
        type: "finish",
        finishReason: {
          unified: inspecting ? "tool-calls" : "stop",
          raw: inspecting ? "tool_calls" : "stop",
        },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  mocks.getModelClient.mockResolvedValue({ modelClient: { model } });
  const result = await reviewToolAction({
    ...input,
    prepare: async () => ({
      payload: "inspect script",
      tools: {
        inspect_app_path: actual.tool({
          inputSchema: z.object({}),
          execute: inspect,
        }),
      },
    }),
  });
  expect(result).toEqual({ decision: "allow", reason: "Inspected six files" });
  expect(inspect).toHaveBeenCalledTimes(6);
  expect(calls).toBe(4);
});
