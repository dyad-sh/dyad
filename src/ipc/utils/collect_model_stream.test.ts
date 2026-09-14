import { describe, expect, it, vi } from "vitest";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { collectModelStream } from "./collect_model_stream";

const finish: Extract<LanguageModelV3StreamPart, { type: "finish" }> = {
  type: "finish",
  finishReason: { unified: "tool-calls", raw: undefined },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 1, reasoning: 2 },
  },
  providerMetadata: { openai: { responseId: "response-id" } },
};
function stream(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}
describe("collectModelStream", () => {
  it("preserves reasoning metadata, ordered content, tools and usage", async () => {
    const tool = {
      type: "tool-call" as const,
      toolCallId: "call-id",
      toolName: "read_file",
      input: '{"path":"a"}',
    };
    const result = await collectModelStream({
      stream: stream([
        { type: "stream-start", warnings: [] },
        {
          type: "response-metadata",
          modelId: "actual-model",
          id: "response-id",
        },
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", delta: "Think" },
        {
          type: "reasoning-end",
          id: "r",
          providerMetadata: {
            openai: { reasoningEncryptedContent: "encrypted" },
          },
        },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Hello" },
        { type: "text-delta", id: "t", delta: "!" },
        { type: "text-end", id: "t" },
        tool,
        finish,
      ]),
    });
    expect(result.content).toEqual([
      {
        type: "reasoning",
        text: "Think",
        providerMetadata: {
          openai: { reasoningEncryptedContent: "encrypted" },
        },
      },
      { type: "text", text: "Hello!", providerMetadata: undefined },
      tool,
    ]);
    expect(result).toMatchObject({
      response: { modelId: "actual-model", id: "response-id" },
      usage: finish.usage,
      finishReason: finish.finishReason,
      providerMetadata: finish.providerMetadata,
    });
  });
  it("rejects incomplete streams instead of returning partial success", async () => {
    await expect(collectModelStream({ stream: stream([]) })).rejects.toThrow(
      "without a completion",
    );
  });
  it("propagates stream errors and cancels the reader", async () => {
    const error = new Error("subscription denied");
    const cancel = vi.fn();
    const source = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "error", error });
      },
      cancel,
    });
    await expect(collectModelStream({ stream: source })).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
