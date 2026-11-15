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

/** One inspection round whose reasoning and tool call carry OpenAI itemIds. */
function inspectThenVerdict(onFollowUp: (prompt: unknown) => void) {
  let calls = 0;
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const usage = {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      };
      if (++calls === 1) {
        const openai = { itemId: "rs_1", reasoningEncryptedContent: "enc" };
        const chunks: LanguageModelV3StreamPart[] = [
          { type: "stream-start", warnings: [] },
          { type: "reasoning-start", id: "r", providerMetadata: { openai } },
          { type: "reasoning-end", id: "r", providerMetadata: { openai } },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "inspect_app_path",
            input: "{}",
            providerMetadata: { openai: { itemId: "fc_1" } },
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage,
          },
        ];
        return { stream: simulateReadableStream({ chunks }) };
      }
      onFollowUp(options.prompt);
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "v" },
        {
          type: "text-delta",
          id: "v",
          delta: '{"decision":"allow","reason":"Inspected package.json"}',
        },
        { type: "text-end", id: "v" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage,
        },
      ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

async function reviewWithInspection(model: MockLanguageModelV3) {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  mocks.streamText.mockImplementation(actual.streamText);
  mocks.getModelClient.mockResolvedValue({ modelClient: { model } });
  return reviewToolAction({
    ...input,
    prepare: async () => ({
      payload: "cd web && pnpm lint",
      tools: {
        inspect_app_path: actual.tool({
          inputSchema: z.object({}),
          execute: async () => "ordinary app file",
        }),
      },
    }),
  });
}

it("does not replay OpenAI itemIds after an inspection round", async () => {
  // The engine sends `store: false`, so a replayed itemId becomes an
  // item_reference that the provider rejects with "Item ... not found".
  let followUp = "";
  const result = await reviewWithInspection(
    inspectThenVerdict((prompt) => {
      followUp = JSON.stringify(prompt);
    }),
  );
  expect(result).toEqual({
    decision: "allow",
    reason: "Inspected package.json",
  });
  expect(followUp).toContain('"toolName":"inspect_app_path"');
  expect(followUp).not.toContain("itemId");
  // Reasoning still travels inline as encrypted content.
  expect(followUp).toContain('"reasoningEncryptedContent":"enc"');
});

it("reports a failed follow-up request instead of an invalid verdict", async () => {
  const result = await reviewWithInspection(
    inspectThenVerdict(() => {
      throw new Error("Item with id 'rs_1' not found.");
    }),
  );
  expect(result).toEqual({
    decision: "block",
    unavailable: true,
    reason: "Tool safety review failed during generation.",
  });
});
