// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  finish: vi.fn(),
  interrupt: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ debug: mocks.debug, warn: mocks.warn }) },
}));
vi.mock("../external_model_usage", () => ({
  finishExternalModelUsageBatch: mocks.finish,
  interruptExternalModelUsage: mocks.interrupt,
}));
import { reportClaudeUsage } from "./accounting";
beforeEach(() => vi.clearAllMocks());
it("reports disjoint main and auxiliary usage, counting cache tokens once", async () => {
  await reportClaudeUsage("turn", {
    modelUsage: {
      "claude-sonnet": {
        inputTokens: 2,
        outputTokens: 3,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 7,
      },
      "claude-haiku": {
        inputTokens: 11,
        outputTokens: 13,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
    usage: {
      input_tokens: 999,
      output_tokens: 999,
      cache_read_input_tokens: 999,
      cache_creation_input_tokens: 999,
    },
  });
  expect(mocks.debug).toHaveBeenCalledWith("Claude Code billing usage", {
    billingEventId: "turn",
    modelId: "claude-sonnet",
    modelProvider: "anthropic",
    connection: "subscription",
    totalTokens: 17,
    cachedInputTokens: 5,
    uncachedInputTokens: 9,
    outputTokens: 3,
  });
  expect(mocks.debug).toHaveBeenCalledTimes(2);
  expect(mocks.finish).toHaveBeenCalledWith("turn", [
    {
      model: "claude-sonnet",
      usage: {
        inputTokens: { total: 14, noCache: 2, cacheRead: 5, cacheWrite: 7 },
        outputTokens: { total: 3, text: undefined, reasoning: undefined },
      },
    },
    {
      model: "claude-haiku",
      usage: {
        inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 13, text: undefined, reasoning: undefined },
      },
    },
  ]);
});
it("missing or cancelled usage never invents counts or blocks subsequent turns", async () => {
  await reportClaudeUsage("turn", undefined);
  expect(mocks.interrupt).toHaveBeenCalledWith("turn");
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(mocks.debug).not.toHaveBeenCalled();
});
it("does not invent billable usage for a Pro-off interrupted turn", async () => {
  await reportClaudeUsage(undefined, undefined);
  expect(mocks.interrupt).toHaveBeenCalledWith(undefined);
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(mocks.debug).not.toHaveBeenCalled();
});

it("checkpoints the session before reporting only the resumed turn delta", async () => {
  const previous = {
    opus: {
      inputTokens: 6,
      outputTokens: 1219,
      cacheReadInputTokens: 52274,
      cacheCreationInputTokens: 37567,
    },
  };
  const current = {
    opus: {
      inputTokens: 10,
      outputTokens: 3011,
      cacheReadInputTokens: 128366,
      cacheCreationInputTokens: 42281,
    },
  };
  const save = vi.fn(async () => {
    expect(mocks.finish).not.toHaveBeenCalled();
  });
  await reportClaudeUsage(
    "resumed",
    { modelUsage: current },
    { previous, save },
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(current);
  expect(mocks.debug).toHaveBeenCalledWith(
    "Claude Code billing usage",
    expect.objectContaining({ totalTokens: 82602, outputTokens: 1792 }),
  );
  expect(mocks.finish).toHaveBeenCalledWith("resumed", [
    {
      model: "opus",
      usage: {
        inputTokens: {
          total: 80810,
          noCache: 4,
          cacheRead: 76092,
          cacheWrite: 4714,
        },
        outputTokens: { total: 1792, text: undefined, reasoning: undefined },
      },
    },
  ]);
});
it("advances the baseline despite billing failure and never replays those tokens", async () => {
  let previous = {};
  const current = {
    opus: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 4,
    },
  };
  const save = vi.fn(async (baseline) => {
    previous = baseline;
  });
  mocks.finish.mockRejectedValueOnce(new Error("billing failed"));
  await expect(
    reportClaudeUsage("failed", { modelUsage: current }, { previous, save }),
  ).rejects.toThrow("billing failed");
  await reportClaudeUsage("next", { modelUsage: current }, { previous, save });
  expect(mocks.finish).toHaveBeenLastCalledWith("next", []);
});
it("does not debit or reject when the baseline cannot be saved", async () => {
  const save = vi.fn(async () => {
    throw new Error("checkpoint failed");
  });
  await expect(
    reportClaudeUsage(
      "turn",
      {
        modelUsage: {
          opus: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 4,
          },
        },
      },
      { previous: {}, save },
    ),
  ).resolves.toBeUndefined();
  expect(mocks.warn).toHaveBeenCalledOnce();
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(mocks.interrupt).toHaveBeenCalledWith("turn");
});
it("skips models that were only used in earlier turns", async () => {
  const unchanged = {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadInputTokens: 3,
    cacheCreationInputTokens: 4,
  };
  const save = vi.fn(async () => {});
  await reportClaudeUsage(
    "resumed",
    {
      modelUsage: {
        opus: unchanged,
        sonnet: {
          inputTokens: 5,
          outputTokens: 6,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    },
    { previous: { opus: unchanged }, save },
  );
  expect(mocks.finish).toHaveBeenCalledWith("resumed", [
    {
      model: "sonnet",
      usage: {
        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 6, text: undefined, reasoning: undefined },
      },
    },
  ]);
});
it("still checkpoints consistent counters when usage cannot be billed", async () => {
  const save = vi.fn(async () => {});
  await reportClaudeUsage("turn", { modelUsage: {} }, { previous: {}, save });
  expect(save).toHaveBeenCalledExactlyOnceWith({});
  expect(mocks.interrupt).toHaveBeenCalledWith("turn");
  expect(mocks.finish).not.toHaveBeenCalled();
});
it("does not checkpoint inconsistent counters", async () => {
  const save = vi.fn(async () => {});
  await reportClaudeUsage(
    "turn",
    {
      modelUsage: {
        opus: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 1,
          cacheCreationInputTokens: 1,
        },
      },
    },
    {
      previous: {
        opus: {
          inputTokens: 5,
          outputTokens: 5,
          cacheReadInputTokens: 5,
          cacheCreationInputTokens: 5,
        },
      },
      save,
    },
  );
  expect(save).not.toHaveBeenCalled();
  expect(mocks.interrupt).toHaveBeenCalledWith("turn");
  expect(mocks.finish).not.toHaveBeenCalled();
});
