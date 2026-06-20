import { describe, it, expect } from "vitest";
import {
  transformContentPart,
  processPendingMessages,
  injectMessagesAtPositions,
  prepareStepMessages,
  hasIncompleteTodos,
  buildTodoReminderMessage,
  ensureToolResultOrdering,
  type InjectedMessage,
} from "@/pro/main/ipc/handlers/local_agent/prepare_step_utils";
import type {
  UserMessageContentPart,
  Todo,
} from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { ImagePart, ModelMessage } from "ai";

function textToolResult(value: string) {
  return { type: "text" as const, value };
}

describe("prepare_step_utils", () => {
  describe("transformContentPart", () => {
    it("transforms text parts correctly", () => {
      const part: UserMessageContentPart = {
        type: "text",
        text: "Hello world",
      };
      const result = transformContentPart(part);

      expect(result).toEqual({ type: "text", text: "Hello world" });
    });

    it("transforms image-url parts to image with URL object", () => {
      const part: UserMessageContentPart = {
        type: "image-url",
        url: "https://example.com/image.png",
      };
      const result = transformContentPart(part);

      expect(result.type).toBe("image");
      expect((result as { type: "image"; image: URL }).image).toBeInstanceOf(
        URL,
      );
      expect((result as { type: "image"; image: URL }).image.href).toBe(
        "https://example.com/image.png",
      );
    });

    it("handles URLs with query parameters", () => {
      const part: UserMessageContentPart = {
        type: "image-url",
        url: "https://example.com/image.png?width=100&height=200",
      };
      const result = transformContentPart(part);

      expect((result as { type: "image"; image: URL }).image.href).toBe(
        "https://example.com/image.png?width=100&height=200",
      );
    });

    it("passes through valid-sized base64 PNG images", () => {
      // 1x1 PNG - well under the 8000px limit
      const png1x1 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const part: UserMessageContentPart = {
        type: "image-url",
        url: png1x1,
      };
      const result = transformContentPart(part);

      expect(result.type).toBe("image");
      expect((result as { type: "image"; image: URL }).image.href).toBe(png1x1);
    });

    it("passes through non-data URLs without validation (cannot determine dimensions)", () => {
      // For regular URLs, we can't determine dimensions, so we pass them through
      const part: UserMessageContentPart = {
        type: "image-url",
        url: "https://example.com/potentially-large-image.png",
      };
      const result = transformContentPart(part);

      expect(result.type).toBe("image");
    });
  });

  describe("processPendingMessages", () => {
    it("moves pending messages to injected list with correct insertion index", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "First message" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [];
      const currentMessageCount = 5;

      processPendingMessages(
        pendingUserMessages,
        allInjectedMessages,
        currentMessageCount,
      );

      expect(pendingUserMessages).toHaveLength(0);
      expect(allInjectedMessages).toHaveLength(1);
      expect(allInjectedMessages[0].insertAtIndex).toBe(5);
      expect(allInjectedMessages[0].message.role).toBe("user");
      expect(allInjectedMessages[0].message.content).toHaveLength(1);
    });

    it("processes multiple pending messages in order", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "First" }],
        [{ type: "text", text: "Second" }],
        [{ type: "text", text: "Third" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [];

      processPendingMessages(pendingUserMessages, allInjectedMessages, 10);

      expect(pendingUserMessages).toHaveLength(0);
      expect(allInjectedMessages).toHaveLength(3);

      // All should have the same insertion index since they were processed in one call
      expect(allInjectedMessages[0].insertAtIndex).toBe(10);
      expect(allInjectedMessages[1].insertAtIndex).toBe(10);
      expect(allInjectedMessages[2].insertAtIndex).toBe(10);

      // But content order should be preserved
      expect(allInjectedMessages[0].message.content[0]).toEqual({
        type: "text",
        text: "First",
      });
      expect(allInjectedMessages[1].message.content[0]).toEqual({
        type: "text",
        text: "Second",
      });
    });

    it("handles mixed content types in a single message", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [
        [
          { type: "text", text: "Check this image:" },
          { type: "image-url", url: "https://example.com/img.png" },
        ],
      ];
      const allInjectedMessages: InjectedMessage[] = [];

      processPendingMessages(pendingUserMessages, allInjectedMessages, 3);

      expect(allInjectedMessages).toHaveLength(1);
      expect(allInjectedMessages[0].message.content).toHaveLength(2);
      expect(allInjectedMessages[0].message.content[0]).toEqual({
        type: "text",
        text: "Check this image:",
      });
      expect(
        (allInjectedMessages[0].message.content[1] as ImagePart).type,
      ).toBe("image");
    });

    it("does nothing when no pending messages", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      processPendingMessages(pendingUserMessages, allInjectedMessages, 5);

      expect(allInjectedMessages).toHaveLength(0);
    });

    it("preserves existing injected messages", () => {
      const existingInjected: InjectedMessage = {
        insertAtIndex: 2,
        sequence: 0,
        message: {
          role: "user",
          content: [{ type: "text", text: "Existing" }],
        },
      };
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "New" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [existingInjected];

      processPendingMessages(pendingUserMessages, allInjectedMessages, 7);

      expect(allInjectedMessages).toHaveLength(2);
      expect(allInjectedMessages[0]).toBe(existingInjected);
      expect(allInjectedMessages[1].insertAtIndex).toBe(7);
      expect(allInjectedMessages[1].sequence).toBe(1); // Sequence continues from existing
    });

    it("assigns incrementing sequence numbers", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "First" }],
        [{ type: "text", text: "Second" }],
        [{ type: "text", text: "Third" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [];

      processPendingMessages(pendingUserMessages, allInjectedMessages, 5);

      expect(allInjectedMessages[0].sequence).toBe(0);
      expect(allInjectedMessages[1].sequence).toBe(1);
      expect(allInjectedMessages[2].sequence).toBe(2);
    });
  });

  describe("injectMessagesAtPositions", () => {
    it("returns original messages when no injections", () => {
      const messages = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const injected: InjectedMessage[] = [];

      const result = injectMessagesAtPositions(messages, injected);

      expect(result).toEqual(messages);
    });

    it("injects a single message at the correct position", () => {
      const messages = [{ id: "a" }, { id: "b" }, { id: "c" }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 1,
          sequence: 0,
          message: {
            role: "user",
            content: [{ type: "text", text: "injected" }],
          },
        },
      ];

      const result = injectMessagesAtPositions(messages, injected);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ id: "a" });
      expect(result[1]).toEqual(injected[0].message);
      expect(result[2]).toEqual({ id: "b" });
      expect(result[3]).toEqual({ id: "c" });
    });

    it("injects at the beginning (index 0)", () => {
      const messages = [{ id: 1 }, { id: 2 }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 0,
          sequence: 0,
          message: {
            role: "user",
            content: [{ type: "text", text: "first" }],
          },
        },
      ];

      const result = injectMessagesAtPositions(messages, injected);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(injected[0].message);
      expect(result[1]).toEqual({ id: 1 });
    });

    it("injects at the end", () => {
      const messages = [{ id: 1 }, { id: 2 }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 2,
          sequence: 0,
          message: {
            role: "user",
            content: [{ type: "text", text: "last" }],
          },
        },
      ];

      const result = injectMessagesAtPositions(messages, injected);

      expect(result).toHaveLength(3);
      expect(result[2]).toEqual(injected[0].message);
    });

    it("handles multiple injections at different positions", () => {
      const messages = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 1,
          sequence: 0,
          message: { role: "user", content: [{ type: "text", text: "at-1" }] },
        },
        {
          insertAtIndex: 3,
          sequence: 1,
          message: { role: "user", content: [{ type: "text", text: "at-3" }] },
        },
      ];

      const result = injectMessagesAtPositions(messages, injected);

      // Original: [a, b, c, d]
      // After injections: [a, at-1, b, c, at-3, d]
      expect(result).toHaveLength(6);
      expect(
        result.map((m) =>
          "id" in m ? m.id : (m.content[0] as { text: string }).text,
        ),
      ).toEqual(["a", "at-1", "b", "c", "at-3", "d"]);
    });

    it("handles multiple injections at the same position (preserves FIFO order)", () => {
      const messages = [{ id: "a" }, { id: "b" }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 1,
          sequence: 0, // Added first
          message: { role: "user", content: [{ type: "text", text: "first" }] },
        },
        {
          insertAtIndex: 1,
          sequence: 1, // Added second
          message: {
            role: "user",
            content: [{ type: "text", text: "second" }],
          },
        },
      ];

      const result = injectMessagesAtPositions(messages, injected);

      // With sequence-aware sorting, FIFO order is preserved:
      // "first" (added first) appears before "second" (added second)
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ id: "a" });
      expect((result[1] as any).content[0].text).toBe("first");
      expect((result[2] as any).content[0].text).toBe("second");
      expect(result[3]).toEqual({ id: "b" });
    });

    it("does not mutate the original messages array", () => {
      const messages = [{ id: 1 }, { id: 2 }];
      const originalLength = messages.length;
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 1,
          sequence: 0,
          message: { role: "user", content: [{ type: "text", text: "new" }] },
        },
      ];

      injectMessagesAtPositions(messages, injected);

      expect(messages).toHaveLength(originalLength);
    });

    it("does not mutate the injected messages array", () => {
      const messages = [{ id: 1 }];
      const injected: InjectedMessage[] = [
        {
          insertAtIndex: 0,
          sequence: 0,
          message: { role: "user", content: [{ type: "text", text: "new" }] },
        },
        {
          insertAtIndex: 1,
          sequence: 1,
          message: { role: "user", content: [{ type: "text", text: "other" }] },
        },
      ];
      const originalOrder = injected.map((i) => i.insertAtIndex);

      injectMessagesAtPositions(messages, injected);

      // Original array should not be sorted
      expect(injected.map((i) => i.insertAtIndex)).toEqual(originalOrder);
    });
  });

  describe("prepareStepMessages", () => {
    it("returns undefined when no pending or injected messages", () => {
      const options = {
        messages: [{ role: "user", content: "Hello" }] satisfies ModelMessage[],
        someOtherProp: true,
      };
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const result = prepareStepMessages(
        options,
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result).toBeUndefined();
    });

    it("processes pending messages and returns modified options", () => {
      const options = {
        messages: [
          { role: "user", content: "Original" },
        ] satisfies ModelMessage[],
        temperature: 0.7,
      };
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "Injected content" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [];

      const result = prepareStepMessages(
        options,
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result).toBeDefined();
      expect(result!.messages).toHaveLength(2);
      expect(result!.temperature).toBe(0.7);
      expect(pendingUserMessages).toHaveLength(0);
      expect(allInjectedMessages).toHaveLength(1);
    });

    it("re-injects all accumulated messages on subsequent steps", () => {
      // Simulate multiple steps where injected messages accumulate
      const allInjectedMessages: InjectedMessage[] = [];
      const pendingUserMessages: UserMessageContentPart[][] = [];

      // Step 1: Add first pending message
      pendingUserMessages.push([{ type: "text", text: "Screenshot 1" }]);
      const step1Messages: ModelMessage[] = [
        { role: "assistant", content: "Let me help" },
      ];

      let result = prepareStepMessages(
        { messages: step1Messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result!.messages).toHaveLength(2);
      expect(allInjectedMessages).toHaveLength(1);
      expect(allInjectedMessages[0].insertAtIndex).toBe(1);

      // Step 2: AI added a new message, add another pending message
      pendingUserMessages.push([{ type: "text", text: "Screenshot 2" }]);
      const step2Messages: ModelMessage[] = [
        { role: "assistant", content: "Let me help" },
        { role: "assistant", content: "Tool result" },
      ];

      result = prepareStepMessages(
        { messages: step2Messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // Should inject both accumulated messages
      expect(result!.messages).toHaveLength(4); // 2 original + 2 injected
      expect(allInjectedMessages).toHaveLength(2);
      expect(allInjectedMessages[1].insertAtIndex).toBe(2);
    });

    it("preserves additional options properties", () => {
      const options = {
        messages: [{ role: "user", content: "test" }] satisfies ModelMessage[],
        maxTokens: 1000,
        model: "gpt-4",
        tools: ["search", "write"],
      };
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "test" }],
      ];
      const allInjectedMessages: InjectedMessage[] = [];

      const result = prepareStepMessages(
        options,
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result).toBeDefined();
      expect(result!.maxTokens).toBe(1000);
      expect(result!.model).toBe("gpt-4");
      expect(result!.tools).toEqual(["search", "write"]);
    });

    it("returns modified options when only previous injected messages exist", () => {
      const existingInjected: InjectedMessage = {
        insertAtIndex: 0,
        sequence: 0,
        message: {
          role: "user",
          content: [{ type: "text", text: "Previously injected" }],
        },
      };
      const options = {
        messages: [
          { role: "assistant", content: "Response" },
        ] satisfies ModelMessage[],
      };
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [existingInjected];

      const result = prepareStepMessages(
        options,
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result).toBeDefined();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0]).toEqual(existingInjected.message);
    });
  });

  describe("integration: multi-step conversation simulation", () => {
    it("correctly maintains message positions across multiple steps", () => {
      const allInjectedMessages: InjectedMessage[] = [];
      const pendingUserMessages: UserMessageContentPart[][] = [];

      // Step 1: User sends initial prompt
      let currentMessages: ModelMessage[] = [
        { role: "user", content: "Build a todo app" },
      ];
      let result = prepareStepMessages(
        { messages: currentMessages },
        pendingUserMessages,
        allInjectedMessages,
      );
      expect(result).toBeUndefined(); // No injections yet

      // Step 2: AI responds with tool call, tool adds screenshot
      currentMessages = [
        { role: "user", content: "Build a todo app" },
        { role: "assistant", content: "Using web_crawl tool..." },
      ];
      pendingUserMessages.push([
        { type: "text", text: "Screenshot of todo app reference:" },
        { type: "image-url", url: "https://example.com/screenshot.png" },
      ]);
      pendingUserMessages.push([{ type: "text", text: "FOLLOWING" }]);

      result = prepareStepMessages(
        { messages: currentMessages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // With FIFO ordering fix, Screenshot (added first) appears before FOLLOWING (added second)
      expect(result!.messages).toMatchInlineSnapshot(`
        [
          {
            "content": "Build a todo app",
            "role": "user",
          },
          {
            "content": "Using web_crawl tool...",
            "role": "assistant",
          },
          {
            "content": [
              {
                "text": "Screenshot of todo app reference:",
                "type": "text",
              },
              {
                "image": "https://example.com/screenshot.png",
                "type": "image",
              },
            ],
            "role": "user",
          },
          {
            "content": [
              {
                "text": "FOLLOWING",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ]
      `);
      // Screenshot should be inserted at position 2 (after the assistant message)
      expect(allInjectedMessages[0].insertAtIndex).toBe(2);

      // Step 3: AI continues, tool adds another screenshot
      currentMessages = [
        { role: "user", content: "Build a todo app" },
        { role: "assistant", content: "Using web_crawl tool..." },
        { role: "assistant", content: "Analyzing the design..." },
      ];
      pendingUserMessages.push([
        { type: "text", text: "Another screenshot:" },
        { type: "image-url", url: "https://example.com/screenshot2.png" },
      ]);

      result = prepareStepMessages(
        { messages: currentMessages },
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result!.messages).toMatchInlineSnapshot(`
        [
          {
            "content": "Build a todo app",
            "role": "user",
          },
          {
            "content": "Using web_crawl tool...",
            "role": "assistant",
          },
          {
            "content": [
              {
                "text": "Screenshot of todo app reference:",
                "type": "text",
              },
              {
                "image": "https://example.com/screenshot.png",
                "type": "image",
              },
            ],
            "role": "user",
          },
          {
            "content": [
              {
                "text": "FOLLOWING",
                "type": "text",
              },
            ],
            "role": "user",
          },
          {
            "content": "Analyzing the design...",
            "role": "assistant",
          },
          {
            "content": [
              {
                "text": "Another screenshot:",
                "type": "text",
              },
              {
                "image": "https://example.com/screenshot2.png",
                "type": "image",
              },
            ],
            "role": "user",
          },
        ]
      `);
    });
  });

  describe("orphaned reasoning filtering", () => {
    it("filters orphaned reasoning parts during multi-step flow", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      // Simulate AI SDK accumulating messages with orphaned reasoning
      const messages: ModelMessage[] = [
        { role: "user", content: "Help me with this task" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me think about this..." },
            // No following output - this is orphaned reasoning
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // Should return modified options with orphaned reasoning filtered
      expect(result).toBeDefined();
      expect(result!.messages).toHaveLength(2);
      // The assistant message should have empty content after filtering
      expect((result!.messages[1].content as any[]).length).toBe(0);
    });

    it("preserves reasoning when followed by text output", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const messages: ModelMessage[] = [
        { role: "user", content: "Help me" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Thinking..." },
            { type: "text", text: "Here is my response" },
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // No filtering needed, so should return undefined (no modifications)
      expect(result).toBeUndefined();
    });

    it("preserves reasoning when followed by tool-call", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const messages: ModelMessage[] = [
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "I should read this file..." },
            {
              type: "tool-call",
              toolCallId: "call-123",
              toolName: "read_file",
              input: { path: "/test.ts" },
            },
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // No filtering needed
      expect(result).toBeUndefined();
    });

    it("filters trailing reasoning after output", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const messages: ModelMessage[] = [
        { role: "user", content: "Help me" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Here is my response" },
            { type: "reasoning", text: "Orphaned trailing reasoning" },
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // Should filter the trailing reasoning
      expect(result).toBeDefined();
      expect((result!.messages[1].content as any[]).length).toBe(1);
      expect((result!.messages[1].content as any[])[0].type).toBe("text");
    });

    it("strips itemId from provider metadata during multi-step flow", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const messages: ModelMessage[] = [
        { role: "user", content: "Help me" },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Here is my response",
              providerOptions: {
                openai: { itemId: "msg_abc123" },
              },
            },
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // Should strip itemId
      expect(result).toBeDefined();
      const textPart = (result!.messages[1].content as any[])[0];
      expect(textPart.text).toBe("Here is my response");
      expect(textPart.providerOptions).toBeUndefined();
    });

    it("strips itemId from reasoning parts while preserving reasoningEncryptedContent", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [];

      const messages: ModelMessage[] = [
        { role: "user", content: "Help me" },
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Thinking...",
              providerOptions: {
                openai: {
                  itemId: "rs_abc123",
                  reasoningEncryptedContent: "encrypted-data",
                },
              },
            },
            { type: "text", text: "Here is my response" },
          ],
        },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      // Should strip itemId but preserve reasoningEncryptedContent
      expect(result).toBeDefined();
      const reasoningPart = (result!.messages[1].content as any[])[0];
      expect(reasoningPart.text).toBe("Thinking...");
      expect(reasoningPart.providerOptions.openai.itemId).toBeUndefined();
      expect(
        reasoningPart.providerOptions.openai.reasoningEncryptedContent,
      ).toBe("encrypted-data");
    });
  });

  describe("hasIncompleteTodos", () => {
    it("returns true when there are pending todos", () => {
      const todos: Todo[] = [
        { id: "1", content: "Task 1", status: "pending" },
        { id: "2", content: "Task 2", status: "completed" },
      ];
      expect(hasIncompleteTodos(todos)).toBe(true);
    });

    it("returns true when there are in_progress todos", () => {
      const todos: Todo[] = [
        { id: "1", content: "Task 1", status: "in_progress" },
        { id: "2", content: "Task 2", status: "completed" },
      ];
      expect(hasIncompleteTodos(todos)).toBe(true);
    });

    it("returns false when all todos are completed", () => {
      const todos: Todo[] = [
        { id: "1", content: "Task 1", status: "completed" },
        { id: "2", content: "Task 2", status: "completed" },
      ];
      expect(hasIncompleteTodos(todos)).toBe(false);
    });

    it("returns false when there are no todos", () => {
      const todos: Todo[] = [];
      expect(hasIncompleteTodos(todos)).toBe(false);
    });
  });

  describe("buildTodoReminderMessage", () => {
    it("builds a message listing incomplete todos", () => {
      const todos: Todo[] = [
        { id: "1", content: "Implement feature A", status: "in_progress" },
        { id: "2", content: "Write tests", status: "pending" },
        { id: "3", content: "Setup project", status: "completed" },
      ];

      const message = buildTodoReminderMessage(todos);

      expect(message).toContain("2 incomplete todo(s)");
      expect(message).toContain("[in_progress] Implement feature A");
      expect(message).toContain("[pending] Write tests");
      expect(message).not.toContain("Setup project");
    });

    it("handles a single incomplete todo", () => {
      const todos: Todo[] = [
        { id: "1", content: "Last task", status: "pending" },
      ];

      const message = buildTodoReminderMessage(todos);

      expect(message).toContain("1 incomplete todo(s)");
      expect(message).toContain("[pending] Last task");
    });
  });

  describe("prepareStepMessages with injected messages", () => {
    it("works with existing injected messages", () => {
      const pendingUserMessages: UserMessageContentPart[][] = [];
      const allInjectedMessages: InjectedMessage[] = [
        {
          insertAtIndex: 1,
          sequence: 0,
          message: {
            role: "user",
            content: [{ type: "text", text: "Screenshot from crawl" }],
          },
        },
      ];

      const messages: ModelMessage[] = [
        { role: "user", content: "Build an app" },
        { role: "assistant", content: "I analyzed the screenshot." },
      ];

      const result = prepareStepMessages(
        { messages },
        pendingUserMessages,
        allInjectedMessages,
      );

      expect(result).toBeDefined();
      // Should have: user message, injected screenshot, assistant message
      expect(result!.messages).toHaveLength(3);
      expect(result!.messages[0].role).toBe("user");
      expect((result!.messages[1].content as { text: string }[])[0].text).toBe(
        "Screenshot from crawl",
      );
      expect(result!.messages[2].role).toBe("assistant");
    });
  });

  describe("ensureToolResultOrdering", () => {
    it("returns null when ordering is already correct", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Build a website" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "web_crawl",
              input: { url: "https://example.com" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_crawl",
              output: textToolResult("Done"),
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Screenshot" }],
        },
      ];

      expect(ensureToolResultOrdering(messages)).toBeNull();
    });

    it("returns null for messages with no tool calls", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "Follow up" },
      ];

      expect(ensureToolResultOrdering(messages)).toBeNull();
    });

    it("moves user message past tool result when it appears between tool_use and tool_result", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Build a website" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "web_crawl",
              input: { url: "https://example.com" },
            },
          ],
        },
        // User message incorrectly placed before tool result
        {
          role: "user",
          content: [{ type: "text", text: "Screenshot" }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_crawl",
              output: textToolResult("Done"),
            },
          ],
        },
      ];

      const result = ensureToolResultOrdering(messages);

      expect(result).not.toBeNull();
      expect(result!).toHaveLength(4);
      // User message should have moved after the tool result
      expect(result![0].role).toBe("user");
      expect(result![1].role).toBe("assistant");
      expect(result![2].role).toBe("tool");
      expect(result![3].role).toBe("user");
      expect((result![3].content as { text: string }[])[0].text).toBe(
        "Screenshot",
      );
    });

    it("handles multiple tool calls in a single assistant message", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Do things" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "list_files",
              input: {},
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "web_crawl",
              input: { url: "https://example.com" },
            },
          ],
        },
        // Misplaced user message
        {
          role: "user",
          content: [{ type: "text", text: "Screenshot" }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "list_files",
              output: textToolResult("files"),
            },
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "web_crawl",
              output: textToolResult("Done"),
            },
          ],
        },
      ];

      const result = ensureToolResultOrdering(messages);

      expect(result).not.toBeNull();
      expect(result!).toHaveLength(4);
      expect(result![2].role).toBe("tool");
      expect(result![3].role).toBe("user");
    });

    it("handles the exact mid-turn compaction scenario", () => {
      // This reproduces the real bug: after compaction, the SDK provides
      // messages without the compaction summary, and the injected screenshot
      // lands between step1's tool_use and tool_result.
      const messages: ModelMessage[] = [
        // Original user message
        { role: "user", content: "Build LPOAC website" },
        // Step 0: web_crawl + list_files
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_step0_crawl",
              toolName: "web_crawl",
              input: { url: "https://example.org" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_step0_crawl",
              toolName: "web_crawl",
              output: textToolResult("Web crawl completed."),
            },
          ],
        },
        // Step 1: model generates a search_replace tool call
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_step1_replace",
              toolName: "search_replace",
              input: { file: "page.tsx", search: "old", replace: "new" },
            },
          ],
        },
        // BUG: screenshot injected here (between step1 tool_use and tool_result)
        {
          role: "user",
          content: [
            { type: "text", text: "Replicate the website from the screenshot" },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_step1_replace",
              toolName: "search_replace",
              output: textToolResult("Replaced successfully"),
            },
          ],
        },
      ];

      const result = ensureToolResultOrdering(messages);

      expect(result).not.toBeNull();
      // The screenshot should be moved after the step1 tool result
      expect(result!.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
        "tool",
        "user", // screenshot moved to end
      ]);
    });

    it("handles multiple consecutive misplaced user messages without corrupting the pending set", () => {
      // Regression test: the lookahead must use a snapshot of pendingToolCallIds
      // so that the first scan doesn't delete IDs needed by subsequent iterations.
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "web_crawl",
              input: { url: "https://example.com" },
            },
          ],
        },
        // Two consecutive misplaced user messages before the tool result
        {
          role: "user",
          content: [{ type: "text", text: "Screenshot 1" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Screenshot 2" }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_crawl",
              output: textToolResult("Done"),
            },
          ],
        },
      ];

      const result = ensureToolResultOrdering(messages);

      expect(result).not.toBeNull();
      // Both user messages should be moved after the tool result
      expect(result!.map((m) => m.role)).toEqual([
        "assistant",
        "tool",
        "user",
        "user",
      ]);
      // FIFO order must be preserved — Screenshot 1 before Screenshot 2
      expect((result![2].content as { text: string }[])[0].text).toBe(
        "Screenshot 1",
      );
      expect((result![3].content as { text: string }[])[0].text).toBe(
        "Screenshot 2",
      );
    });

    it("handles interleaved user messages across multiple tool results", () => {
      // Regression: assistant(call-1, call-2) -> user1 -> tool(result-1) -> user2 -> tool(result-2)
      // Both user messages must be moved past their respective tool results.
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "list_files",
              input: {},
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "web_crawl",
              input: {},
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Injected A" }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "list_files",
              output: textToolResult("files"),
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Injected B" }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "web_crawl",
              output: textToolResult("done"),
            },
          ],
        },
      ];

      const result = ensureToolResultOrdering(messages);

      expect(result).not.toBeNull();
      // Both user messages must end up after all tool results
      expect(result!.map((m) => m.role)).toEqual([
        "assistant",
        "tool",
        "tool",
        "user",
        "user",
      ]);
      // Both injected messages are present after tool results
      const userTexts = result!
        .filter((m) => m.role === "user")
        .map((m) => (m.content as { text: string }[])[0].text);
      expect(userTexts).toContain("Injected A");
      expect(userTexts).toContain("Injected B");
    });

    it("does not move user messages across assistant turn boundaries", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_file",
              input: {},
            },
          ],
        },
        // User message between tool_use and result, but next message is
        // a new assistant turn, not a tool result
        {
          role: "user",
          content: [{ type: "text", text: "Misplaced" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "New turn" }],
        },
      ];

      // The function should not move the user message past the assistant boundary
      // (insertAfter stays at i since no tool result was found before the next assistant)
      const result = ensureToolResultOrdering(messages);
      expect(result).toBeNull();
    });

    it("does not mutate the original array", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "test",
              input: {},
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: "Misplaced" }] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "test",
              output: textToolResult("ok"),
            },
          ],
        },
      ];
      const originalRoles = messages.map((m) => m.role);

      ensureToolResultOrdering(messages);

      expect(messages.map((m) => m.role)).toEqual(originalRoles);
    });

    it("handles string content gracefully (no tool-call parts)", () => {
      const messages: ModelMessage[] = [
        { role: "assistant", content: "Just text, no tool calls" },
        { role: "user", content: "Follow up" },
      ];

      expect(ensureToolResultOrdering(messages)).toBeNull();
    });
  });

  describe("compaction index delta adjustment", () => {
    it("injection at stale index breaks ordering; adjusted index fixes it", () => {
      // Simulate the compaction scenario end-to-end using the utility functions.

      // --- During compaction step (step 1) ---
      // Compacted messages: [user, compaction_summary, assistant(tool_use), tool(result)]
      const compactedMessages: ModelMessage[] = [
        { role: "user", content: "Build LPOAC website" },
        { role: "assistant", content: "Conversation compacted." },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              input: { url: "https://example.org" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              output: textToolResult("Web crawl completed."),
            },
          ],
        },
      ];

      const allInjectedMessages: InjectedMessage[] = [];
      const pendingUserMessages: UserMessageContentPart[][] = [
        [{ type: "text", text: "Screenshot from crawl" }],
      ];

      // Process pending screenshot — index will be based on compacted length (4)
      prepareStepMessages(
        { messages: compactedMessages },
        pendingUserMessages,
        allInjectedMessages,
      );
      expect(allInjectedMessages[0].insertAtIndex).toBe(4);

      // --- Apply the compaction index delta ---
      // preCompactionBaseCount=1 (just user_msg), postCompactionBaseCount=2 (user + summary)
      const compactionIndexDelta = 2 - 1; // = 1
      for (const injection of allInjectedMessages) {
        injection.insertAtIndex = Math.max(
          0,
          injection.insertAtIndex - compactionIndexDelta,
        );
      }
      expect(allInjectedMessages[0].insertAtIndex).toBe(3);

      // --- During step 2 ---
      // SDK provides messages WITHOUT the compaction summary:
      // [user, step0_assistant(tool_use), step0_tool(result), step1_assistant(tool_use), step1_tool(result)]
      const sdkMessages: ModelMessage[] = [
        { role: "user", content: "Build LPOAC website" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              input: { url: "https://example.org" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              output: textToolResult("Web crawl completed."),
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_replace",
              toolName: "search_replace",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_replace",
              toolName: "search_replace",
              output: textToolResult("ok"),
            },
          ],
        },
      ];

      // Re-inject with adjusted index (3)
      const result = injectMessagesAtPositions(
        sdkMessages,
        allInjectedMessages,
      );

      // Screenshot at index 3 = after step0_tool, before step1_assistant — correct!
      expect(result.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "user", // screenshot at index 3
        "assistant",
        "tool",
      ]);
    });

    it("without delta adjustment, stale index breaks tool_use/tool_result pairing", () => {
      // Prove the bug: without adjustment, the screenshot lands in the wrong spot.
      const allInjectedMessages: InjectedMessage[] = [
        {
          insertAtIndex: 4, // Stale index from compaction step (not adjusted)
          sequence: 0,
          message: {
            role: "user",
            content: [{ type: "text", text: "Screenshot" }],
          },
        },
      ];

      // SDK messages (no compaction summary)
      const sdkMessages: ModelMessage[] = [
        { role: "user", content: "Build website" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_crawl",
              toolName: "web_crawl",
              output: textToolResult("done"),
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_replace",
              toolName: "search_replace",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu_replace",
              toolName: "search_replace",
              output: textToolResult("ok"),
            },
          ],
        },
      ];

      const broken = injectMessagesAtPositions(
        sdkMessages,
        allInjectedMessages,
      );

      // BUG: screenshot lands between step1 assistant and step1 tool
      expect(broken.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
        "user", // WRONG — between step1's tool_use and tool_result
        "tool",
      ]);

      // ensureToolResultOrdering fixes it as a safety net
      const fixed = ensureToolResultOrdering(broken as ModelMessage[]);
      expect(fixed).not.toBeNull();
      expect(fixed!.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
        "tool",
        "user", // Moved to safe position
      ]);
    });
  });
});
