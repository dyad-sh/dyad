import { describe, expect, it } from "vitest";
import { streamText, isStepCount, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { z } from "zod";
import {
  getStepMessageBaseline,
  prepareStepMessages,
  type InjectedMessage,
} from "./prepare_step_utils";
import {
  fastTextOutput,
  cancelOrphanedBaseStream,
} from "@/ipc/utils/stream_text_utils";
import type { UserMessageContentPart } from "./tools/types";

describe("AI SDK v7 multi-step compatibility", () => {
  it("replays injections once and retains every step's response and final-step usage", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const step = calls++;
        const content: LanguageModelV4StreamPart[] =
          step < 2
            ? [
                {
                  type: "tool-call",
                  toolCallId: `call-${step}`,
                  toolName: "inspect",
                  input: "{}",
                },
              ]
            : [
                { type: "text-start", id: "text" },
                { type: "text-delta", id: "text", delta: "Done" },
                { type: "text-end", id: "text" },
              ];
        return {
          stream: simulateReadableStream<LanguageModelV4StreamPart>({
            chunks: [
              { type: "stream-start", warnings: [] },
              ...content,
              {
                type: "finish",
                finishReason: {
                  unified: step < 2 ? "tool-calls" : "stop",
                  raw: undefined,
                },
                usage: {
                  inputTokens: {
                    total: 10,
                    noCache: 8,
                    cacheRead: 2,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
                },
              },
            ],
          }),
        };
      },
    });
    const injections: InjectedMessage[] = [];
    const pending: UserMessageContentPart[][] = [];
    const prepared: ModelMessage[][] = [];
    let finalContextTokens: number | undefined;
    const result = streamText({
      model,
      output: fastTextOutput(),
      instructions: "Inspect then report.",
      messages: [{ role: "user", content: "Start" }],
      tools: {
        inspect: tool({ inputSchema: z.object({}), execute: async () => "ok" }),
      },
      stopWhen: isStepCount(3),
      prepareStep: (options) => {
        if (options.stepNumber === 1)
          pending.push([{ type: "text", text: "Injected reminder" }]);
        const baseline = {
          ...options,
          messages: getStepMessageBaseline(options),
        };
        const next =
          prepareStepMessages(baseline, pending, injections) ?? baseline;
        prepared.push(next.messages);
        return next;
      },
      onEnd: (event) => {
        finalContextTokens = event.finalStep.usage.totalTokens;
      },
    });
    const stream = result.stream;
    cancelOrphanedBaseStream(result);
    for await (const _part of stream) {
      /* Drain the real SDK stream. */
    }
    expect(await result.text).toBe("Done");
    expect(calls).toBe(3);
    const reminders = (messages: ModelMessage[]) =>
      JSON.stringify(messages).split("Injected reminder").length - 1;
    expect(prepared.map(reminders)).toEqual([0, 1, 1]);
    expect(
      model.doStreamCalls.map((call) =>
        reminders(call.prompt as ModelMessage[]),
      ),
    ).toEqual([0, 1, 1]);
    const steps = await result.steps;
    expect(steps.map((step) => step.response.messages.length)).toEqual([
      2, 2, 1,
    ]);
    expect(await result.responseMessages).toHaveLength(5);
    expect((await result.usage).totalTokens).toBe(36);
    expect(finalContextTokens).toBe(12);
  });
});
