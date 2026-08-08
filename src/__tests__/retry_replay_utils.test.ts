import { describe, it, expect } from "vitest";
import {
  type RetryReplayEvent,
  buildRetryReplayMessages,
  maybeCaptureRetryReplayEvent,
  maybeCaptureRetryReplayText,
  toToolResultOutput,
} from "@/pro/main/ipc/handlers/local_agent/retry_replay_utils";

// ---------------------------------------------------------------------------
// buildRetryReplayMessages
// ---------------------------------------------------------------------------

describe("buildRetryReplayMessages", () => {
  it("returns empty array when no events are provided", () => {
    expect(buildRetryReplayMessages([])).toEqual([]);
  });

  it("replays a single completed tool exchange", () => {
    const events: RetryReplayEvent[] = [
      { type: "assistant-text", text: "Let me read that file." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "readFile",
        input: { path: "foo.ts" },
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "readFile",
        output: "file contents",
      },
    ];

    const messages = buildRetryReplayMessages(events);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toEqual([
      { type: "text", text: "Let me read that file." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "readFile",
        input: { path: "foo.ts" },
      },
    ]);
    expect(messages[1].role).toBe("tool");
    expect(messages[1].content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "readFile",
        output: { type: "text", value: "file contents" },
      },
    ]);
  });

  it("groups parallel tool results into a single tool message (fixes #3070)", () => {
    // Simulates 3 parallel tool calls: all calls emitted, then all results.
    const events: RetryReplayEvent[] = [
      { type: "assistant-text", text: "Reading files..." },
      {
        type: "tool-call",
        toolCallId: "call-A",
        toolName: "readFile",
        input: { path: "a.ts" },
      },
      {
        type: "tool-call",
        toolCallId: "call-B",
        toolName: "readFile",
        input: { path: "b.ts" },
      },
      {
        type: "tool-call",
        toolCallId: "call-C",
        toolName: "readFile",
        input: { path: "c.ts" },
      },
      {
        type: "tool-result",
        toolCallId: "call-A",
        toolName: "readFile",
        output: "contents-a",
      },
      {
        type: "tool-result",
        toolCallId: "call-B",
        toolName: "readFile",
        output: "contents-b",
      },
      {
        type: "tool-result",
        toolCallId: "call-C",
        toolName: "readFile",
        output: "contents-c",
      },
    ];

    const messages = buildRetryReplayMessages(events);

    // Should produce exactly: assistant[text, callA, callB, callC], tool[resultA, resultB, resultC]
    expect(messages).toHaveLength(2);

    expect(messages[0].role).toBe("assistant");
    const assistantContent = messages[0].content as Array<{
      type: string;
      toolCallId?: string;
    }>;
    expect(assistantContent).toHaveLength(4); // text + 3 calls
    expect(assistantContent[0].type).toBe("text");
    expect(assistantContent[1].toolCallId).toBe("call-A");
    expect(assistantContent[2].toolCallId).toBe("call-B");
    expect(assistantContent[3].toolCallId).toBe("call-C");

    expect(messages[1].role).toBe("tool");
    const toolContent = messages[1].content as Array<{
      type: string;
      toolCallId: string;
    }>;
    expect(toolContent).toHaveLength(3); // all 3 results grouped
    expect(toolContent[0].toolCallId).toBe("call-A");
    expect(toolContent[1].toolCallId).toBe("call-B");
    expect(toolContent[2].toolCallId).toBe("call-C");
  });

  it("handles sequential tool calls followed by parallel calls", () => {
    const events: RetryReplayEvent[] = [
      // Sequential call
      { type: "assistant-text", text: "Step 1" },
      {
        type: "tool-call",
        toolCallId: "seq-1",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: "seq-1",
        toolName: "readFile",
        output: "result-1",
      },
      // Parallel calls
      { type: "assistant-text", text: "Step 2" },
      {
        type: "tool-call",
        toolCallId: "par-A",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-call",
        toolCallId: "par-B",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: "par-A",
        toolName: "readFile",
        output: "result-A",
      },
      {
        type: "tool-result",
        toolCallId: "par-B",
        toolName: "readFile",
        output: "result-B",
      },
    ];

    const messages = buildRetryReplayMessages(events);
    expect(messages).toHaveLength(4);

    // Sequential: assistant[text, seq-1] → tool[seq-1-result]
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("tool");
    expect((messages[1].content as unknown[]).length).toBe(1);

    // Parallel: assistant[text, par-A, par-B] → tool[par-A-result, par-B-result]
    expect(messages[2].role).toBe("assistant");
    expect(messages[3].role).toBe("tool");
    expect((messages[3].content as unknown[]).length).toBe(2);
  });

  it("excludes incomplete tool exchanges (call without result)", () => {
    const events: RetryReplayEvent[] = [
      { type: "assistant-text", text: "Working..." },
      {
        type: "tool-call",
        toolCallId: "complete",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: "complete",
        toolName: "readFile",
        output: "done",
      },
      { type: "assistant-text", text: "More work..." },
      {
        type: "tool-call",
        toolCallId: "incomplete",
        toolName: "writeFile",
        input: {},
      },
      // No tool-result for "incomplete" — stream died
    ];

    const messages = buildRetryReplayMessages(events);
    // Only the completed exchange should appear
    expect(messages).toHaveLength(3); // assistant, tool, assistant (trailing text)

    expect(messages[0].role).toBe("assistant");
    const assistantContent = messages[0].content as Array<{
      type: string;
      toolCallId?: string;
    }>;
    expect(assistantContent.some((c) => c.toolCallId === "incomplete")).toBe(
      false,
    );

    expect(messages[2].role).toBe("assistant");
    expect(messages[2].content).toEqual([
      { type: "text", text: "More work..." },
    ]);
  });

  it("excludes incomplete parallel calls mixed with complete ones", () => {
    const events: RetryReplayEvent[] = [
      {
        type: "tool-call",
        toolCallId: "call-A",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-call",
        toolCallId: "call-B",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: "call-A",
        toolName: "readFile",
        output: "result-A",
      },
      // call-B has no result (stream died mid-batch)
    ];

    const messages = buildRetryReplayMessages(events);
    expect(messages).toHaveLength(2);

    // Only call-A should be in the assistant message
    const assistantContent = messages[0].content as Array<{
      type: string;
      toolCallId?: string;
    }>;
    expect(assistantContent).toHaveLength(1);
    expect(assistantContent[0].toolCallId).toBe("call-A");

    // Only result-A in the tool message
    const toolContent = messages[1].content as Array<{
      type: string;
      toolCallId: string;
    }>;
    expect(toolContent).toHaveLength(1);
    expect(toolContent[0].toolCallId).toBe("call-A");
  });

  it("skips whitespace-only text events", () => {
    const events: RetryReplayEvent[] = [
      { type: "assistant-text", text: "   " },
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "readFile",
        input: {},
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "readFile",
        output: "ok",
      },
    ];

    const messages = buildRetryReplayMessages(events);
    expect(messages).toHaveLength(2);
    // The assistant message should only have the tool-call, no whitespace text
    const assistantContent = messages[0].content as Array<{ type: string }>;
    expect(assistantContent).toHaveLength(1);
    expect(assistantContent[0].type).toBe("tool-call");
  });
});

// ---------------------------------------------------------------------------
// maybeCaptureRetryReplayEvent
// ---------------------------------------------------------------------------

describe("maybeCaptureRetryReplayEvent", () => {
  it("captures tool-call events", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayEvent(events, {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "readFile",
      input: { path: "x.ts" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "readFile",
      input: { path: "x.ts" },
    });
  });

  it("deduplicates tool-call events by toolCallId", () => {
    const events: RetryReplayEvent[] = [];
    const part = {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "readFile",
      input: {},
    };
    maybeCaptureRetryReplayEvent(events, part);
    maybeCaptureRetryReplayEvent(events, part);
    expect(events).toHaveLength(1);
  });

  it("captures tool-result events", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayEvent(events, {
      type: "tool-result",
      toolCallId: "tc-1",
      toolName: "readFile",
      output: "data",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool-result");
  });

  it("ignores non-object or untyped parts", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayEvent(events, null);
    maybeCaptureRetryReplayEvent(events, "string");
    maybeCaptureRetryReplayEvent(events, 42);
    maybeCaptureRetryReplayEvent(events, { noType: true });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// maybeCaptureRetryReplayText
// ---------------------------------------------------------------------------

describe("maybeCaptureRetryReplayText", () => {
  it("appends new text event", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayText(events, "hello");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "assistant-text", text: "hello" });
  });

  it("concatenates to existing trailing text event", () => {
    const events: RetryReplayEvent[] = [
      { type: "assistant-text", text: "hel" },
    ];
    maybeCaptureRetryReplayText(events, "lo");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "assistant-text", text: "hello" });
  });

  it("ignores empty text", () => {
    const events: RetryReplayEvent[] = [];
    maybeCaptureRetryReplayText(events, "");
    expect(events).toHaveLength(0);
  });

  it("does nothing when events is null", () => {
    // Should not throw
    maybeCaptureRetryReplayText(null, "hello");
  });
});

// ---------------------------------------------------------------------------
// toToolResultOutput
// ---------------------------------------------------------------------------

describe("toToolResultOutput", () => {
  it("wraps string values directly", () => {
    expect(toToolResultOutput("hello")).toEqual({
      type: "text",
      value: "hello",
    });
  });

  it("JSON-stringifies objects", () => {
    expect(toToolResultOutput({ key: "val" })).toEqual({
      type: "text",
      value: '{"key":"val"}',
    });
  });

  it("handles non-serializable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = toToolResultOutput(circular);
    expect(result.type).toBe("text");
    expect(typeof result.value).toBe("string");
  });
});
