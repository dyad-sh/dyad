// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

import { ChatEventTranslator } from "./event_translator";

/** Build a pi assistant message with the given accumulated text. */
function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-x",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 0,
  };
}

function messageUpdate(text: string): AgentEvent {
  return {
    type: "message_update",
    message: assistantMessage(text),
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: assistantMessage(text),
    },
  } as AgentEvent;
}

function thinkingUpdate(
  type: "thinking_start" | "thinking_delta" | "thinking_end",
  thinking: string,
): AgentEvent {
  const message = {
    ...assistantMessage(""),
    content: [{ type: "thinking", thinking }],
  };
  return {
    type: "message_update",
    message,
    assistantMessageEvent: {
      type,
      contentIndex: 0,
      ...(type === "thinking_delta" ? { delta: thinking } : {}),
      ...(type === "thinking_end" ? { content: thinking } : {}),
      partial: message,
    },
  } as AgentEvent;
}

function messageEnd(
  text: string,
  stopReason: "stop" | "error" | "aborted" = "stop",
): AgentEvent {
  return {
    type: "message_end",
    message: {
      ...assistantMessage(text),
      stopReason,
      errorMessage: stopReason === "stop" ? undefined : "terminated",
    },
  } as AgentEvent;
}

function toolUpdate(xml: string): AgentEvent {
  return {
    type: "tool_execution_update",
    toolCallId: "tc1",
    toolName: "write_file",
    args: {},
    partialResult: {
      details: { toolName: "write_file", xml, appendedUserMessages: [] },
    },
  } as AgentEvent;
}

function toolStart(): AgentEvent {
  return {
    type: "tool_execution_start",
    toolCallId: "tc1",
    toolName: "write_file",
    args: {},
  } as AgentEvent;
}

function toolEnd(xml: string | undefined): AgentEvent {
  return {
    type: "tool_execution_end",
    toolCallId: "tc1",
    toolName: "write_file",
    result: {
      details: { toolName: "write_file", xml, appendedUserMessages: [] },
    },
    isError: false,
  } as AgentEvent;
}

describe("ChatEventTranslator", () => {
  it("emits a tail patch as assistant text accumulates", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });

    const first = t.feed(messageUpdate("Hello"));
    expect(first).toHaveLength(1);
    expect(first[0].streamingMessageId).toBe(10);
    expect(first[0].streamingPatch).toEqual({
      offset: 0,
      content: "Hello",
      prefixHash: undefined,
    });

    const second = t.feed(messageUpdate("Hello world"));
    expect(second).toHaveLength(1);
    // Tail patch: only the new suffix, offset at the common-prefix length.
    expect(second[0].streamingPatch?.offset).toBe(5);
    expect(second[0].streamingPatch?.content).toBe(" world");
  });

  it("emits nothing when accumulated text is unchanged", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    t.feed(messageUpdate("same"));
    const again = t.feed(messageUpdate("same"));
    expect(again).toEqual([]);
  });

  it("streams pi thinking blocks through the existing think UI tag", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    const chunks = [
      ...t.feed(thinkingUpdate("thinking_start", "")),
      ...t.feed(thinkingUpdate("thinking_delta", "Inspect first")),
      ...t.feed(thinkingUpdate("thinking_end", "Inspect first")),
    ];

    let content = "";
    for (const chunk of chunks) {
      if (chunk.streamingPatch) {
        content =
          content.slice(0, chunk.streamingPatch.offset) +
          chunk.streamingPatch.content;
      }
    }

    expect(content).toBe("<think>Inspect first</think>\n");
  });

  it("closes an unfinished thinking block when the message ends", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    t.feed(thinkingUpdate("thinking_delta", "Inspect first"));
    const message = {
      ...assistantMessage(""),
      content: [{ type: "thinking", thinking: "Inspect first" }],
    };

    t.feed({ type: "message_end", message } as AgentEvent);

    expect(t.finalContent()).toBe("<think>Inspect first</think>\n");
  });

  it("tracks tool execution start before accepting preview updates", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    expect(t.feed(toolStart())).toEqual([]);
    expect(t.feed(toolUpdate("<dyad-write>"))[0].streamingPreview).toEqual({
      content: "<dyad-write>",
    });
  });

  it("surfaces running tool XML as a preview overlay", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    const chunks = t.feed(toolUpdate("<dyad-write path='a.ts'>"));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].streamingPreview).toEqual({
      content: "<dyad-write path='a.ts'>",
    });
  });

  it("dedupes an unchanged preview", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    t.feed(toolUpdate("<dyad-write>"));
    expect(t.feed(toolUpdate("<dyad-write>"))).toEqual([]);
  });

  it("folds completed tool XML into content and clears the preview", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    t.feed(messageUpdate("Writing the file."));
    t.feed(messageEnd("Writing the file."));
    t.feed(toolUpdate("<dyad-write path='a.ts'>partial"));

    const end = t.feed(toolEnd("<dyad-write path='a.ts'>done</dyad-write>"));
    // A text patch that folds the tool XML in, plus a preview-clear.
    const previewClear = end.find((c) => c.streamingPreview !== undefined);
    expect(previewClear?.streamingPreview).toEqual({ content: "" });

    // The folded content keeps the earlier assistant prose and appends the XML.
    const finalText = t.finalContent();
    expect(finalText).toContain("Writing the file.");
    expect(finalText).toContain("<dyad-write path='a.ts'>done</dyad-write>");
  });

  it("rolls back failed partial text and preserves transcript order", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    const chunks = [
      ...t.feed(messageUpdate("Creating the file.")),
      ...t.feed(messageEnd("Creating the file.")),
      ...t.feed(toolEnd("<dyad-write>done</dyad-write>")),
      ...t.feed(messageUpdate("Partial response")),
      ...t.feed(messageEnd("Partial response", "error")),
      ...t.discardActiveAssistant(),
      ...t.feed(messageUpdate("Created the file.")),
      ...t.feed(messageEnd("Created the file.")),
    ];

    let content = "";
    for (const chunk of chunks) {
      if (chunk.streamingPatch) {
        content =
          content.slice(0, chunk.streamingPatch.offset) +
          chunk.streamingPatch.content;
      }
    }

    expect(content).toBe(
      "Creating the file.\n<dyad-write>done</dyad-write>\nCreated the file.",
    );
    expect(t.finalContent()).toBe(content);
  });

  it.each(["error", "aborted"] as const)(
    "preserves partial text after a terminal %s",
    (stopReason) => {
      const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
      t.feed(messageUpdate("Partial response"));

      expect(t.feed(messageEnd("Partial response", stopReason))).toEqual([]);
      expect(t.finalContent()).toBe("Partial response");
    },
  );

  it("clears the preview even when the completed tool produced no XML", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    const end = t.feed(toolEnd(undefined));
    expect(end).toHaveLength(1);
    expect(end[0].streamingPreview).toEqual({ content: "" });
  });

  it("ignores unrelated events", () => {
    const t = new ChatEventTranslator({ chatId: 1, streamingMessageId: 10 });
    expect(t.feed({ type: "agent_start" } as AgentEvent)).toEqual([]);
    expect(t.feed({ type: "turn_start" } as AgentEvent)).toEqual([]);
  });
});
