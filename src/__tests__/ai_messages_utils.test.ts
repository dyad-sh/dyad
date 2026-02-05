import { describe, it, expect } from "vitest";
import {
  parseAiMessagesJson,
  getAiMessagesJsonIfWithinLimit,
  MAX_AI_MESSAGES_SIZE,
  type DbMessageForParsing,
} from "@/ipc/utils/ai_messages_utils";
import { AI_MESSAGES_SDK_VERSION } from "@/db/schema";
import type { ModelMessage } from "ai";

describe("parseAiMessagesJson", () => {
  describe("current format (v5 envelope)", () => {
    it("should parse valid v5 envelope format", () => {
      const msg: DbMessageForParsing = {
        id: 1,
        role: "assistant",
        content: "fallback content",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("should parse v5 envelope with complex tool messages", () => {
      const toolMessage: ModelMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Let me help you with that" },
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "read_file",
            input: { path: "/src/index.ts" },
          },
        ],
      };
      const msg: DbMessageForParsing = {
        id: 2,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [toolMessage],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([toolMessage]);
    });
  });

  describe("legacy format (direct array)", () => {
    it("should parse legacy array format", () => {
      const legacyMessages: ModelMessage[] = [
        { role: "user", content: "Old message" },
        { role: "assistant", content: "Old response" },
      ];
      const msg: DbMessageForParsing = {
        id: 3,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: legacyMessages,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual(legacyMessages);
    });

    it("should handle legacy array with various message types", () => {
      const legacyMessages: ModelMessage[] = [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Follow up" },
      ];
      const msg: DbMessageForParsing = {
        id: 4,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: legacyMessages,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toHaveLength(3);
      expect(result[0].role).toBe("user");
      expect(result[2].role).toBe("user");
    });
  });

  describe("fallback behavior", () => {
    it("should fallback to role/content when aiMessagesJson is null", () => {
      const msg: DbMessageForParsing = {
        id: 5,
        role: "assistant",
        content: "Direct content",
        aiMessagesJson: null,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "assistant", content: "Direct content" },
      ]);
    });

    it("should fallback for user messages", () => {
      const msg: DbMessageForParsing = {
        id: 6,
        role: "user",
        content: "User question",
        aiMessagesJson: null,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([{ role: "user", content: "User question" }]);
    });

    it("should fallback when sdkVersion mismatches", () => {
      const msg: DbMessageForParsing = {
        id: 7,
        role: "assistant",
        content: "fallback content",
        aiMessagesJson: {
          sdkVersion: "ai@v999" as any, // Wrong version
          messages: [{ role: "assistant", content: "Should not be used" }],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "assistant", content: "fallback content" },
      ]);
    });

    it("should fallback when messages array is missing role", () => {
      const msg: DbMessageForParsing = {
        id: 8,
        role: "assistant",
        content: "fallback content",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [{ content: "No role here" } as any],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "assistant", content: "fallback content" },
      ]);
    });

    it("should fallback when aiMessagesJson is an empty object", () => {
      const msg: DbMessageForParsing = {
        id: 9,
        role: "user",
        content: "fallback content",
        aiMessagesJson: {} as any,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([{ role: "user", content: "fallback content" }]);
    });

    it("should fallback when legacy array contains invalid entries", () => {
      const msg: DbMessageForParsing = {
        id: 10,
        role: "assistant",
        content: "fallback content",
        aiMessagesJson: [
          { role: "user", content: "valid" },
          { noRole: true } as any,
        ] as any,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "assistant", content: "fallback content" },
      ]);
    });

    it("should fallback when messages is not an array", () => {
      const msg: DbMessageForParsing = {
        id: 11,
        role: "assistant",
        content: "fallback content",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: "not an array" as any,
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "assistant", content: "fallback content" },
      ]);
    });
  });

  describe("OpenAI itemId stripping", () => {
    it("should strip itemId from text parts with providerOptions", () => {
      const msg: DbMessageForParsing = {
        id: 20,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Hello",
                  providerOptions: {
                    openai: { itemId: "msg_abc123" },
                  },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.text).toBe("Hello");
      expect(part.providerOptions).toBeUndefined();
    });

    it("should strip itemId from tool-call parts", () => {
      const msg: DbMessageForParsing = {
        id: 21,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-123",
                  toolName: "read_file",
                  input: { path: "/test" },
                  providerOptions: {
                    openai: { itemId: "fc_abc123" },
                  },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.toolCallId).toBe("call-123");
      expect(part.providerOptions).toBeUndefined();
    });

    it("should strip itemId from reasoning parts but preserve reasoningEncryptedContent when followed by output", () => {
      const msg: DbMessageForParsing = {
        id: 22,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: "thinking...",
                  providerOptions: {
                    openai: {
                      itemId: "rs_abc123",
                      reasoningEncryptedContent: "encrypted-data",
                    },
                  },
                },
                {
                  type: "text",
                  text: "Here is my response",
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect((result[0].content as any[]).length).toBe(2);
      const reasoningPart = (result[0].content as any[])[0];
      expect(reasoningPart.text).toBe("thinking...");
      expect(reasoningPart.providerOptions.openai.itemId).toBeUndefined();
      expect(
        reasoningPart.providerOptions.openai.reasoningEncryptedContent,
      ).toBe("encrypted-data");
    });

    it("should filter out orphaned reasoning parts without following output", () => {
      const msg: DbMessageForParsing = {
        id: 22,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: "thinking without output...",
                  providerOptions: {
                    openai: {
                      itemId: "rs_orphan",
                      reasoningEncryptedContent: "encrypted-data",
                    },
                  },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      // Orphaned reasoning should be filtered out
      expect((result[0].content as any[]).length).toBe(0);
    });

    it("should keep reasoning followed by tool-call", () => {
      const msg: DbMessageForParsing = {
        id: 22,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: "thinking before tool call...",
                },
                {
                  type: "tool-call",
                  toolCallId: "call-123",
                  toolName: "read_file",
                  input: { path: "/test" },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect((result[0].content as any[]).length).toBe(2);
      expect((result[0].content as any[])[0].type).toBe("reasoning");
      expect((result[0].content as any[])[1].type).toBe("tool-call");
    });

    it("should filter trailing reasoning after text output", () => {
      const msg: DbMessageForParsing = {
        id: 22,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "output first",
                },
                {
                  type: "reasoning",
                  text: "orphaned reasoning at end",
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      // Trailing reasoning without following output should be filtered
      expect((result[0].content as any[]).length).toBe(1);
      expect((result[0].content as any[])[0].type).toBe("text");
    });

    it("should strip itemId from legacy providerMetadata", () => {
      const msg: DbMessageForParsing = {
        id: 23,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Hello",
                  providerMetadata: {
                    openai: { itemId: "msg_legacy123" },
                  },
                } as any,
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.text).toBe("Hello");
      expect(part.providerMetadata).toBeUndefined();
    });

    it("should strip itemId from legacy array format", () => {
      const msg: DbMessageForParsing = {
        id: 24,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Legacy",
                providerOptions: {
                  openai: { itemId: "msg_legacy_arr" },
                },
              },
            ],
          },
        ] as ModelMessage[],
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.text).toBe("Legacy");
      expect(part.providerOptions).toBeUndefined();
    });

    it("should strip itemId from azure provider key", () => {
      const msg: DbMessageForParsing = {
        id: 25,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Azure",
                  providerOptions: {
                    azure: { itemId: "msg_azure123" },
                  },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.text).toBe("Azure");
      expect(part.providerOptions).toBeUndefined();
    });

    it("should preserve non-OpenAI providerOptions", () => {
      const msg: DbMessageForParsing = {
        id: 26,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Mixed",
                  providerOptions: {
                    openai: { itemId: "msg_strip" },
                    "dyad-engine": { someFlag: true },
                  },
                },
              ],
            },
          ] as ModelMessage[],
        },
      };

      const result = parseAiMessagesJson(msg);
      const part = (result[0].content as any[])[0];
      expect(part.providerOptions.openai).toBeUndefined();
      expect(part.providerOptions["dyad-engine"]).toEqual({ someFlag: true });
    });

    it("should not modify string content messages", () => {
      const msg: DbMessageForParsing = {
        id: 27,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty content in fallback", () => {
      const msg: DbMessageForParsing = {
        id: 12,
        role: "assistant",
        content: "",
        aiMessagesJson: null,
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([{ role: "assistant", content: "" }]);
    });

    it("should handle empty messages array in v5 format", () => {
      const msg: DbMessageForParsing = {
        id: 13,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: {
          sdkVersion: AI_MESSAGES_SDK_VERSION,
          messages: [],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([]);
    });

    it("should handle empty legacy array", () => {
      const msg: DbMessageForParsing = {
        id: 14,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: [],
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toEqual([]);
    });
  });
});

describe("getAiMessagesJsonIfWithinLimit", () => {
  it("should return undefined for empty array", () => {
    const result = getAiMessagesJsonIfWithinLimit([]);
    expect(result).toBeUndefined();
  });

  it("should return undefined for null/undefined", () => {
    const result = getAiMessagesJsonIfWithinLimit(null as any);
    expect(result).toBeUndefined();
  });

  it("should return valid payload for small messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result = getAiMessagesJsonIfWithinLimit(messages);
    expect(result).toEqual({
      messages,
      sdkVersion: AI_MESSAGES_SDK_VERSION,
    });
  });

  it("should return undefined for messages exceeding size limit", () => {
    // Create a message that exceeds 1MB
    const largeContent = "x".repeat(MAX_AI_MESSAGES_SIZE + 1000);
    const messages: ModelMessage[] = [
      { role: "assistant", content: largeContent },
    ];

    const result = getAiMessagesJsonIfWithinLimit(messages);
    expect(result).toBeUndefined();
  });

  it("should return payload at exactly the size limit", () => {
    // Calculate how much content we can fit
    const basePayload = {
      messages: [{ role: "assistant", content: "" }],
      sdkVersion: AI_MESSAGES_SDK_VERSION,
    };
    const baseSize = JSON.stringify(basePayload).length;
    const remainingSpace = MAX_AI_MESSAGES_SIZE - baseSize;

    const messages: ModelMessage[] = [
      { role: "assistant", content: "a".repeat(remainingSpace) },
    ];

    const result = getAiMessagesJsonIfWithinLimit(messages);
    expect(result).toBeDefined();
    expect(result?.messages).toEqual(messages);
  });

  it("should handle messages with complex content types", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here is the result" },
          {
            type: "tool-call",
            toolCallId: "call-abc",
            toolName: "write_file",
            input: { path: "/test.ts", content: "console.log('test')" },
          },
        ],
      },
    ];

    const result = getAiMessagesJsonIfWithinLimit(messages);
    expect(result).toBeDefined();
    expect(result?.sdkVersion).toBe(AI_MESSAGES_SDK_VERSION);
    expect(result?.messages[0]).toEqual(messages[0]);
  });
});
