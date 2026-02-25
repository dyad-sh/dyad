import { describe, it, expect } from "vitest";
import {
  parseAiMessagesJson,
  cleanMessageForOpenAI,
  getAiMessagesJsonIfWithinLimit,
  stripItemIdsFromMessages,
  isItemNotFoundError,
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

  describe("itemId preservation (no longer stripped on parse)", () => {
    it("should preserve itemId in text parts with providerOptions", () => {
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
      expect(part.providerOptions.openai.itemId).toBe("msg_abc123");
    });

    it("should preserve itemId in tool-call parts", () => {
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
      expect(part.providerOptions.openai.itemId).toBe("fc_abc123");
    });

    it("should preserve itemId and reasoningEncryptedContent in reasoning parts when followed by output", () => {
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
      expect(reasoningPart.providerOptions.openai.itemId).toBe("rs_abc123");
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

    it("should preserve itemId in legacy providerMetadata", () => {
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
      expect(part.providerMetadata.openai.itemId).toBe("msg_legacy123");
    });

    it("should preserve itemId in legacy array format", () => {
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
      expect(part.providerOptions.openai.itemId).toBe("msg_legacy_arr");
    });

    it("should preserve itemId in azure provider key", () => {
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
      expect(part.providerOptions.azure.itemId).toBe("msg_azure123");
    });

    it("should preserve all providerOptions including OpenAI", () => {
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
                    openai: { itemId: "msg_keep" },
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
      expect(part.providerOptions.openai.itemId).toBe("msg_keep");
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

describe("cleanMessageForOpenAI", () => {
  it("should preserve itemId in providerOptions (no longer strips)", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Hello",
          providerOptions: {
            openai: { itemId: "msg_abc123", other: "keep" },
          },
        },
      ],
    };

    const result = cleanMessageForOpenAI(message);
    const part = (result.content as any[])[0];
    expect(part.providerOptions.openai.itemId).toBe("msg_abc123");
    expect(part.providerOptions.openai.other).toBe("keep");
  });

  it("should preserve itemId in providerMetadata (no longer strips)", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Hello",
          providerMetadata: {
            openai: { itemId: "msg_legacy" },
          },
        } as any,
      ],
    };

    const result = cleanMessageForOpenAI(message);
    const part = (result.content as any[])[0];
    expect(part.providerMetadata.openai.itemId).toBe("msg_legacy");
  });

  it("should return original message reference when no changes needed", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Hello",
          providerOptions: { openai: { itemId: "msg_123" } },
        },
      ],
    };

    const result = cleanMessageForOpenAI(message);
    expect(result).toBe(message);
  });

  it("should still filter orphaned reasoning at end of content", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "output" },
        {
          type: "reasoning",
          text: "orphaned thinking",
          providerOptions: { openai: { itemId: "rs_orphan" } },
        },
      ],
    };

    const result = cleanMessageForOpenAI(message);
    expect((result.content as any[]).length).toBe(1);
    expect((result.content as any[])[0].type).toBe("text");
  });

  it("should keep reasoning that has a following output", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "thinking...",
          providerOptions: { openai: { itemId: "rs_keep" } },
        },
        { type: "text", text: "response" },
      ],
    };

    const result = cleanMessageForOpenAI(message);
    expect((result.content as any[]).length).toBe(2);
    const reasoning = (result.content as any[])[0];
    expect(reasoning.providerOptions.openai.itemId).toBe("rs_keep");
  });

  it("should return original message for string content", () => {
    const message: ModelMessage = {
      role: "user",
      content: "just a string",
    };

    const result = cleanMessageForOpenAI(message);
    expect(result).toBe(message);
  });

  it("should handle message with only orphaned reasoning (all parts filtered)", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "orphan 1" },
        { type: "reasoning", text: "orphan 2" },
      ],
    };

    const result = cleanMessageForOpenAI(message);
    expect((result.content as any[]).length).toBe(0);
  });

  it("should handle empty content array without modification", () => {
    const message: ModelMessage = {
      role: "assistant",
      content: [],
    };

    const result = cleanMessageForOpenAI(message);
    expect(result).toBe(message);
  });
});

describe("stripItemIdsFromMessages", () => {
  it("should strip itemId from providerOptions.openai", () => {
    const messages: ModelMessage[] = [
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
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerOptions).toBeUndefined();
  });

  it("should strip itemId from providerMetadata.openai", () => {
    const messages: ModelMessage[] = [
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
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerMetadata).toBeUndefined();
  });

  it("should strip itemId from azure provider key", () => {
    const messages: ModelMessage[] = [
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
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerOptions).toBeUndefined();
  });

  it("should preserve non-OpenAI providerOptions while stripping itemId", () => {
    const messages: ModelMessage[] = [
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
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerOptions.openai).toBeUndefined();
    expect(part.providerOptions["dyad-engine"]).toEqual({ someFlag: true });
  });

  it("should preserve reasoningEncryptedContent while stripping itemId", () => {
    const messages: ModelMessage[] = [
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
          { type: "text", text: "response" },
        ],
      },
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerOptions.openai.itemId).toBeUndefined();
    expect(part.providerOptions.openai.reasoningEncryptedContent).toBe(
      "encrypted-data",
    );
  });

  it("should skip string content messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    stripItemIdsFromMessages(messages);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi there!");
  });

  it("should handle multiple messages with itemIds", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "First",
            providerOptions: { openai: { itemId: "msg_1" } },
          },
        ],
      },
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Second",
            providerOptions: { openai: { itemId: "msg_2" } },
          },
        ],
      },
    ];

    stripItemIdsFromMessages(messages);
    expect((messages[0].content as any[])[0].providerOptions).toBeUndefined();
    expect(messages[1].content).toBe("question");
    expect((messages[2].content as any[])[0].providerOptions).toBeUndefined();
  });

  it("should handle empty messages array", () => {
    const messages: ModelMessage[] = [];
    stripItemIdsFromMessages(messages);
    expect(messages).toEqual([]);
  });

  it("should be a no-op for parts without providerOptions or providerMetadata", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "no provider data" },
          { type: "tool-call", toolCallId: "c1", toolName: "t", input: {} },
        ],
      },
    ];

    const contentBefore = JSON.stringify(messages);
    stripItemIdsFromMessages(messages);
    expect(JSON.stringify(messages)).toBe(contentBefore);
  });

  it("should strip itemId from both providerOptions and providerMetadata on the same part", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "dual",
            providerOptions: { openai: { itemId: "opt_id" } },
            providerMetadata: { openai: { itemId: "meta_id" } },
          } as any,
        ],
      },
    ];

    stripItemIdsFromMessages(messages);
    const part = (messages[0].content as any[])[0];
    expect(part.providerOptions).toBeUndefined();
    expect(part.providerMetadata).toBeUndefined();
  });

  it("should strip itemIds from multiple parts in a single message", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking",
            providerOptions: {
              openai: { itemId: "rs_1", reasoningEncryptedContent: "enc" },
            },
          },
          {
            type: "text",
            text: "output",
            providerOptions: { openai: { itemId: "msg_1" } },
          },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "t",
            input: {},
            providerOptions: { openai: { itemId: "fc_1" } },
          },
        ],
      },
    ];

    stripItemIdsFromMessages(messages);
    const parts = messages[0].content as any[];
    expect(parts[0].providerOptions.openai.itemId).toBeUndefined();
    expect(parts[0].providerOptions.openai.reasoningEncryptedContent).toBe(
      "enc",
    );
    expect(parts[1].providerOptions).toBeUndefined();
    expect(parts[2].providerOptions).toBeUndefined();
  });
});

describe("isItemNotFoundError", () => {
  it("should match error with nested error.message", () => {
    const error = {
      error: {
        message:
          "Item with id 'rs_04332f10855e4dab00691afad78d748197b3bfb853fc97ce92' not found",
      },
    };
    expect(isItemNotFoundError(error)).toBe(true);
  });

  it("should match Error instance", () => {
    const error = new Error("Item with id 'msg_abc123' not found");
    expect(isItemNotFoundError(error)).toBe(true);
  });

  it("should match string error", () => {
    expect(isItemNotFoundError("Item with id 'fc_xyz' not found")).toBe(true);
  });

  it("should not match unrelated errors", () => {
    expect(isItemNotFoundError(new Error("Rate limit exceeded"))).toBe(false);
    expect(isItemNotFoundError({ error: { message: "Server error" } })).toBe(
      false,
    );
  });

  it("should return false for null/undefined", () => {
    expect(isItemNotFoundError(null)).toBe(false);
    expect(isItemNotFoundError(undefined)).toBe(false);
  });

  it("should return false for empty object", () => {
    expect(isItemNotFoundError({})).toBe(false);
  });

  it("should return false for number and boolean", () => {
    expect(isItemNotFoundError(42)).toBe(false);
    expect(isItemNotFoundError(true)).toBe(false);
  });

  it("should prefer error.error.message over Error.message", () => {
    const error = Object.assign(new Error("some other message"), {
      error: {
        message: "Item with id 'rs_abc' not found",
      },
    });
    expect(isItemNotFoundError(error)).toBe(true);
  });

  it("should fall back to Error.message when error.error.message is absent", () => {
    const error = new Error("Item with id 'msg_fallback' not found");
    expect(isItemNotFoundError(error)).toBe(true);
  });

  it("should match item id with various prefixes", () => {
    expect(
      isItemNotFoundError({
        error: { message: "Item with id 'fc_call123' not found" },
      }),
    ).toBe(true);
    expect(
      isItemNotFoundError({
        error: { message: "Item with id 'msg_output456' not found" },
      }),
    ).toBe(true);
  });
});

describe("round-trip: parseAiMessagesJson preserves itemIds, stripItemIdsFromMessages removes them", () => {
  it("should preserve itemIds through parse, then strip them on demand", () => {
    const msg: DbMessageForParsing = {
      id: 100,
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
                    itemId: "rs_roundtrip",
                    reasoningEncryptedContent: "enc-data",
                  },
                },
              },
              {
                type: "text",
                text: "response",
                providerOptions: {
                  openai: { itemId: "msg_roundtrip" },
                },
              },
            ],
          },
        ] as ModelMessage[],
      },
    };

    // Step 1: Parse preserves itemIds
    const parsed = parseAiMessagesJson(msg);
    const parts = parsed[0].content as any[];
    expect(parts[0].providerOptions.openai.itemId).toBe("rs_roundtrip");
    expect(parts[1].providerOptions.openai.itemId).toBe("msg_roundtrip");

    // Step 2: stripItemIdsFromMessages removes them
    stripItemIdsFromMessages(parsed);
    expect(parts[0].providerOptions.openai.itemId).toBeUndefined();
    expect(parts[0].providerOptions.openai.reasoningEncryptedContent).toBe(
      "enc-data",
    );
    expect(parts[1].providerOptions).toBeUndefined();
  });

  it("should strip itemIds from both openai and azure across multiple messages", () => {
    const msg: DbMessageForParsing = {
      id: 101,
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
                text: "openai part",
                providerOptions: { openai: { itemId: "oai_1" } },
              },
            ],
          },
          { role: "user", content: "follow up" },
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "azure part",
                providerOptions: { azure: { itemId: "az_1" } },
              },
            ],
          },
        ] as ModelMessage[],
      },
    };

    const parsed = parseAiMessagesJson(msg);

    // Verify preserved after parse
    expect(
      ((parsed[0].content as any[])[0] as any).providerOptions.openai.itemId,
    ).toBe("oai_1");
    expect(
      ((parsed[2].content as any[])[0] as any).providerOptions.azure.itemId,
    ).toBe("az_1");

    // Strip and verify removed
    stripItemIdsFromMessages(parsed);
    expect(
      ((parsed[0].content as any[])[0] as any).providerOptions,
    ).toBeUndefined();
    expect(parsed[1].content).toBe("follow up");
    expect(
      ((parsed[2].content as any[])[0] as any).providerOptions,
    ).toBeUndefined();
  });
});
