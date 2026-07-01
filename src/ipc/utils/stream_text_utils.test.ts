import { describe, expect, it } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { fastTextOutput } from "./stream_text_utils";

describe("fastTextOutput", () => {
  it("returns the text length (a number) as the partial output", async () => {
    const output = fastTextOutput();
    const result = await output.parsePartialOutput({ text: "hello" });
    expect(result).toEqual({ partial: 5 });
    expect(typeof (result as { partial: unknown }).partial).toBe("number");
  });

  it("produces a value that grows as the accumulated text grows", async () => {
    const output = fastTextOutput();
    const shorter = await output.parsePartialOutput({ text: "ab" });
    const longer = await output.parsePartialOutput({ text: "abcd" });
    const shorterPartial = (shorter as unknown as { partial: number }).partial;
    const longerPartial = (longer as unknown as { partial: number }).partial;
    expect(longerPartial).toBeGreaterThan(shorterPartial);
  });

  it("preserves the base Output.text() behavior", async () => {
    const output = fastTextOutput() as unknown as {
      name: string;
      responseFormat: Promise<unknown>;
      parseCompleteOutput: (opts: { text: string }) => Promise<string>;
    };
    expect(output.name).toBe("text");
    await expect(output.responseFormat).resolves.toEqual({ type: "text" });
    // Completion still yields the full text, not the length.
    await expect(
      output.parseCompleteOutput({ text: "full response" }),
    ).resolves.toBe("full response");
  });

  // Guards the streaming mechanism the number partial depends on: the SDK's
  // output transform publishes a text chunk only when the partial value changes.
  // If an SDK change broke that for a number partial, text would batch to the
  // end (or error) instead of flushing per chunk, and this test would fail.
  it("streams text incrementally through streamText with the number partial", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "Hello " },
            { type: "text-delta", id: "1", delta: "world" },
            { type: "text-delta", id: "1", delta: "!" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 3, text: 3, reasoning: 0 },
              },
            },
          ],
        }),
      }),
    });

    const result = streamText({
      model,
      output: fastTextOutput(),
      prompt: "hi",
    });

    const deltas: string[] = [];
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") deltas.push(part.text);
    }

    // One delta per input chunk = incremental, not batched at the end.
    expect(deltas).toEqual(["Hello ", "world", "!"]);
    await expect(result.text).resolves.toBe("Hello world!");
  });
});
