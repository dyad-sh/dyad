import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import {
  estimateModelMessagesTokens,
  shouldCompact,
  partitionMessagesForCompaction,
  buildCompactionPrompt,
  buildCompactedMessages,
} from "@/pro/main/ipc/handlers/local_agent/compaction_utils";

describe("compaction_utils", () => {
  describe("estimateModelMessagesTokens", () => {
    it("estimates tokens for string content messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello world" }, // 11 chars -> 3 tokens + 4 overhead
        { role: "assistant", content: "Hi there" }, // 8 chars -> 2 tokens + 4 overhead
      ];
      const result = estimateModelMessagesTokens(messages);
      // (ceil(11/4) + 4) + (ceil(8/4) + 4) = (3+4) + (2+4) = 13
      expect(result).toBe(13);
    });

    it("estimates tokens for text parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      // ceil(5/4) + ceil(5/4) + 4 = 2 + 2 + 4 = 8
      expect(result).toBe(8);
    });

    it("estimates tokens for image parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this:" },
            { type: "image", image: new URL("https://example.com/img.png") },
          ],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      // ceil(13/4) + 1000 + 4 = 4 + 1000 + 4 = 1008
      expect(result).toBe(1008);
    });

    it("estimates tokens for tool-call parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call1",
              toolName: "read_file",
              input: { path: "/src/index.ts" },
            },
          ],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      const inputStr = JSON.stringify({ path: "/src/index.ts" });
      // ceil(inputStr.length / 4) + 20 overhead + 4 role overhead
      expect(result).toBe(Math.ceil(inputStr.length / 4) + 20 + 4);
    });

    it("estimates tokens for tool-result parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "read_file",
              output: {
                type: "text" as const,
                value: "file contents here",
              },
            },
          ],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      const outputStr = JSON.stringify({
        type: "text",
        value: "file contents here",
      });
      expect(result).toBe(Math.ceil(outputStr.length / 4) + 20 + 4);
    });

    it("estimates tokens for reasoning parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "Let me think about this..." }],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      // ceil(26/4) + 4 = 7 + 4 = 11
      expect(result).toBe(11);
    });

    it("handles empty messages array", () => {
      expect(estimateModelMessagesTokens([])).toBe(0);
    });

    it("handles mixed content types in a single message", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will read the file" },
            {
              type: "tool-call",
              toolCallId: "call1",
              toolName: "read",
              input: { path: "a.ts" },
            },
          ],
        },
      ];
      const result = estimateModelMessagesTokens(messages);
      const textTokens = Math.ceil(20 / 4);
      const toolTokens =
        Math.ceil(JSON.stringify({ path: "a.ts" }).length / 4) + 20;
      expect(result).toBe(textTokens + toolTokens + 4);
    });
  });

  describe("shouldCompact", () => {
    it("returns false when under threshold", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Short message" },
      ];
      expect(shouldCompact({ messages, contextWindow: 128000 })).toBe(false);
    });

    it("returns true when at or above threshold", () => {
      // Create a message large enough to exceed 75% of a small context window
      const longContent = "x".repeat(400); // 100 tokens
      const messages: ModelMessage[] = [{ role: "user", content: longContent }];
      // 100 + 4 overhead = 104 tokens, context window of 128 * 0.75 = 96
      expect(shouldCompact({ messages, contextWindow: 128 })).toBe(true);
    });

    it("respects custom threshold", () => {
      const longContent = "x".repeat(400); // 100 tokens
      const messages: ModelMessage[] = [{ role: "user", content: longContent }];
      // 104 tokens total, context window 200, threshold 0.5 = 100
      expect(
        shouldCompact({ messages, contextWindow: 200, threshold: 0.5 }),
      ).toBe(true);
      // threshold 0.6 = 120
      expect(
        shouldCompact({ messages, contextWindow: 200, threshold: 0.6 }),
      ).toBe(false);
    });
  });

  describe("partitionMessagesForCompaction", () => {
    function makeMessages(count: number): ModelMessage[] {
      const msgs: ModelMessage[] = [];
      for (let i = 0; i < count; i++) {
        if (i === 0) {
          msgs.push({ role: "user", content: `User message ${i}` });
        } else if (i % 3 === 0) {
          msgs.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: `call${i}`,
                toolName: "test",
                output: { type: "text" as const, value: `Result ${i}` },
              },
            ],
          });
        } else if (i % 2 === 0) {
          msgs.push({
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: `call${i + 1}`,
                toolName: "test",
                input: { step: i },
              },
            ],
          });
        } else {
          msgs.push({ role: "assistant", content: `Response ${i}` });
        }
      }
      return msgs;
    }

    it("returns empty toCompact when too few messages", () => {
      const messages = makeMessages(5);
      const { toCompact, toPreserve } = partitionMessagesForCompaction(
        messages,
        10,
      );
      expect(toCompact).toHaveLength(0);
      expect(toPreserve).toEqual(messages);
    });

    it("preserves the first user message", () => {
      const messages = makeMessages(20);
      const { toPreserve } = partitionMessagesForCompaction(messages, 10);
      expect(toPreserve[0]).toEqual(messages[0]);
    });

    it("preserves the last N messages", () => {
      const messages = makeMessages(20);
      const { toPreserve } = partitionMessagesForCompaction(messages, 10);
      // First message + last 10 = 11 preserved (but first message is from original position 0,
      // which is before the split, so it gets moved)
      const lastTen = messages.slice(-10);
      // The preserved set should end with the last 10 messages
      expect(toPreserve.slice(-10)).toEqual(lastTen);
    });

    it("does not split tool-call / tool-result pairs", () => {
      // Construct messages where a tool-result is at the split boundary
      const messages: ModelMessage[] = [
        { role: "user", content: "Do something" },
        { role: "assistant", content: "Step 1" },
        { role: "assistant", content: "Step 2" },
        { role: "assistant", content: "Step 3" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call1",
              toolName: "read",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "read",
              output: { type: "text" as const, value: "result" },
            },
          ],
        },
        { role: "assistant", content: "Step 5" },
        { role: "assistant", content: "Step 6" },
        { role: "assistant", content: "Step 7" },
        { role: "assistant", content: "Step 8" },
        { role: "assistant", content: "Step 9" },
        { role: "assistant", content: "Step 10" },
      ];

      // With preserveRecentCount=7, split would be at index 5 (the tool-result)
      // It should adjust backward to keep the tool-call + tool-result together
      const { toCompact, toPreserve } = partitionMessagesForCompaction(
        messages,
        7,
      );

      // The tool-result message should NOT be in toCompact
      for (const msg of toCompact) {
        expect(msg.role).not.toBe("tool");
      }

      // Both the tool-call and tool-result should be in toPreserve
      const hasToolCall = toPreserve.some(
        (m) =>
          m.role === "assistant" &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === "tool-call"),
      );
      const hasToolResult = toPreserve.some((m) => m.role === "tool");
      expect(hasToolCall).toBe(true);
      expect(hasToolResult).toBe(true);
    });

    it("compacts messages between first and preserved window", () => {
      const messages = makeMessages(25);
      const { toCompact, toPreserve } = partitionMessagesForCompaction(
        messages,
        10,
      );

      expect(toCompact.length).toBeGreaterThan(0);
      // Total should equal original (minus first message which moved to preserve)
      expect(toCompact.length + toPreserve.length).toBe(messages.length);
    });
  });

  describe("buildCompactionPrompt", () => {
    it("serializes string content messages", () => {
      const messages: ModelMessage[] = [
        { role: "assistant", content: "I'll help you" },
        { role: "user", content: "Thanks" },
      ];
      const result = buildCompactionPrompt(messages);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("[ASSISTANT]: I'll help you");
      expect(result[0].content).toContain("[USER]: Thanks");
    });

    it("serializes tool-call parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call1",
              toolName: "read_file",
              input: { path: "/src/index.ts" },
            },
          ],
        },
      ];
      const result = buildCompactionPrompt(messages);
      expect(result[0].content).toContain("[Tool Call: read_file(");
      expect(result[0].content).toContain("/src/index.ts");
    });

    it("truncates large tool results", () => {
      const longResult = "x".repeat(3000);
      const messages: ModelMessage[] = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "read_file",
              output: { type: "text" as const, value: longResult },
            },
          ],
        },
      ];
      const result = buildCompactionPrompt(messages);
      const content = result[0].content as string;
      expect(content).toContain("... (truncated)");
      // Should be much shorter than the original 3000 chars
      expect(content.length).toBeLessThan(3000);
    });

    it("handles image parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "image", image: new URL("https://example.com/img.png") },
          ],
        },
      ];
      const result = buildCompactionPrompt(messages);
      expect(result[0].content).toContain("[Image]");
    });
  });

  describe("buildCompactedMessages", () => {
    it("returns summary message followed by preserved messages", () => {
      const toPreserve: ModelMessage[] = [
        { role: "user", content: "Original task" },
        { role: "assistant", content: "Working on it" },
      ];
      const result = buildCompactedMessages(
        "Summary of earlier work",
        toPreserve,
      );

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("[Conversation Summary");
      expect(result[0].content).toContain("Summary of earlier work");
      expect(result[1]).toEqual(toPreserve[0]);
      expect(result[2]).toEqual(toPreserve[1]);
    });

    it("works with empty preserve set", () => {
      const result = buildCompactedMessages("Summary", []);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });

    it("includes the context prefix in summary", () => {
      const result = buildCompactedMessages("test summary", []);
      expect(result[0].content).toContain(
        "[Conversation Summary — use for context, focus on recent messages for current task]",
      );
    });
  });
});
