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
    it("should strip itemId from text part providerOptions", () => {
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
                  text: "Hello there!",
                  providerOptions: {
                    openai: {
                      itemId: "rs_abc123",
                      annotations: [],
                    },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      expect(result).toHaveLength(1);
      const content = result[0].content as any[];
      expect(content[0].text).toBe("Hello there!");
      // itemId should be stripped
      expect(content[0].providerOptions?.openai?.itemId).toBeUndefined();
      // Other fields should be preserved
      expect(content[0].providerOptions?.openai?.annotations).toEqual([]);
    });

    it("should strip itemId from tool-call part providerOptions", () => {
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
                  input: { path: "/src/index.ts" },
                  providerOptions: {
                    openai: { itemId: "rs_xyz789" },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].toolName).toBe("read_file");
      // itemId stripped, empty openai object cleaned up
      expect(content[0].providerOptions).toBeUndefined();
    });

    it("should strip itemId and reasoningEncryptedContent from reasoning parts", () => {
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
                  text: "Let me think about this...",
                  providerOptions: {
                    openai: {
                      itemId: "rs_reasoning_123",
                      reasoningEncryptedContent: "encrypted_data_here",
                    },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].text).toBe("Let me think about this...");
      // Both itemId and reasoningEncryptedContent should be stripped
      expect(content[0].providerOptions).toBeUndefined();
    });

    it("should strip itemId from legacy providerMetadata field", () => {
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
                  text: "Response text",
                  providerMetadata: {
                    openai: { itemId: "rs_legacy_456" },
                  },
                },
              ],
            },
          ] as any,
        },
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].text).toBe("Response text");
      expect(content[0].providerMetadata).toBeUndefined();
    });

    it("should not modify messages without providerOptions", () => {
      const msg: DbMessageForParsing = {
        id: 24,
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

    it("should strip itemIds from legacy array format", () => {
      const msg: DbMessageForParsing = {
        id: 25,
        role: "assistant",
        content: "fallback",
        aiMessagesJson: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Response",
                providerOptions: {
                  openai: { itemId: "rs_legacy_array" },
                },
              },
            ],
          },
        ] as ModelMessage[],
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].text).toBe("Response");
      expect(content[0].providerOptions).toBeUndefined();
    });

    it("should strip itemId from azure provider key", () => {
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
                  text: "Azure response",
                  providerOptions: {
                    azure: { itemId: "rs_azure_123" },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].text).toBe("Azure response");
      expect(content[0].providerOptions).toBeUndefined();
    });

    it("should preserve non-OpenAI providerOptions", () => {
      const msg: DbMessageForParsing = {
        id: 27,
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
                  text: "Response",
                  providerOptions: {
                    openai: { itemId: "rs_strip_me" },
                    "dyad-engine": { sourceCommitHash: "abc123" },
                  },
                },
              ],
            },
          ],
        },
      };

      const result = parseAiMessagesJson(msg);
      const content = result[0].content as any[];
      expect(content[0].providerOptions?.openai).toBeUndefined();
      expect(
        content[0].providerOptions?.["dyad-engine"]?.sourceCommitHash,
      ).toBe("abc123");
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
