// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ finish: vi.fn(), interrupt: vi.fn() }));
vi.mock("../external_model_usage", () => ({
  finishExternalModelUsageBatch: mocks.finish,
  interruptExternalModelUsage: mocks.interrupt,
}));
import { reportClaudeUsage } from "./accounting";
beforeEach(() => vi.clearAllMocks());
it("reports disjoint main and auxiliary usage, counting cache tokens once", async () => {
  const value = await reportClaudeUsage("turn", {
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
  expect(value.status).toBe("attempted");
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
  expect((await reportClaudeUsage("turn", undefined)).status).toBe(
    "unavailable",
  );
  expect(mocks.interrupt).toHaveBeenCalledWith("turn");
  expect(mocks.finish).not.toHaveBeenCalled();
});
it("identifies a Pro-off turn as unbilled", async () => {
  expect((await reportClaudeUsage(undefined, undefined)).status).toBe(
    "unbilled",
  );
});
