import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { InvalidToolInputError, streamText, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";

describe("AI SDK pre-execution tool errors", () => {
  it("stringifies validation errors in tool-error stream parts", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-read-chat",
              toolName: "read_chat",
              input: JSON.stringify({ before: 6, after: 3 }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 0, reasoning: 0 },
              },
            },
          ],
        }),
      }),
    });

    const result = streamText({
      model,
      prompt: "Read the cited chat.",
      tools: {
        read_chat: tool({
          inputSchema: z.object({
            chat_id: z.number().int().positive(),
          }),
        }),
      },
    });

    const parts: Array<Record<string, unknown>> = [];
    for await (const part of result.fullStream) {
      parts.push(part as unknown as Record<string, unknown>);
    }

    const invalidToolCall = parts.find(
      (part) =>
        part.type === "tool-call" && part.toolCallId === "call-read-chat",
    );
    expect(invalidToolCall).toMatchObject({
      type: "tool-call",
      toolCallId: "call-read-chat",
      toolName: "read_chat",
      invalid: true,
      dynamic: true,
    });
    expect(InvalidToolInputError.isInstance(invalidToolCall?.error)).toBe(true);

    const toolError = parts.find(
      (part) =>
        part.type === "tool-error" && part.toolCallId === "call-read-chat",
    );
    expect(toolError).toMatchObject({
      type: "tool-error",
      toolCallId: "call-read-chat",
      toolName: "read_chat",
      dynamic: true,
    });
    expect(typeof toolError?.error).toBe("string");
    expect(toolError?.error).toContain("Invalid input for tool read_chat");
  });
});
