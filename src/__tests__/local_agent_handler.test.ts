import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { streamText } from "ai";

// ============================================================================
// Test Fakes & Builders
// ============================================================================

/**
 * Creates a fake WebContents that records all sent messages
 */
function createFakeWebContents() {
  const sentMessages: Array<{ channel: string; args: unknown[] }> = [];
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, ...args: unknown[]) => {
        sentMessages.push({ channel, args });
      },
    } as unknown as WebContents,
    sentMessages,
    getMessagesByChannel(channel: string) {
      return sentMessages.filter((m) => m.channel === channel);
    },
  };
}

/**
 * Creates a fake IPC event with a recordable sender
 */
function createFakeEvent() {
  const webContents = createFakeWebContents();
  return {
    event: { sender: webContents.sender } as IpcMainInvokeEvent,
    ...webContents,
  };
}

/**
 * Builder for creating test chat/app data
 */
function buildTestChat(
  overrides: {
    chatId?: number;
    appId?: number;
    appPath?: string;
    messages?: Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      aiMessagesJson?: unknown;
      isCompactionSummary?: boolean | null;
      createdAt?: Date;
    }>;
    supabaseProjectId?: string | null;
  } = {},
) {
  const chatId = overrides.chatId ?? 1;
  const appId = overrides.appId ?? 100;
  const messages = overrides.messages ?? [
    {
      id: 1,
      role: "user" as const,
      content: "Hello",
      createdAt: new Date("2025-01-01"),
    },
  ];

  return {
    id: chatId,
    appId,
    title: "Test Chat",
    createdAt: new Date(),
    messages,
    app: {
      id: appId,
      name: "Test App",
      path: overrides.appPath ?? "test-app-path",
      createdAt: new Date(),
      updatedAt: new Date(),
      supabaseProjectId: overrides.supabaseProjectId ?? null,
    },
  };
}

/**
 * Creates a minimal settings object for testing
 */
function buildTestSettings(
  overrides: {
    enableDyadPro?: boolean;
    hasApiKey?: boolean;
    selectedModel?: string;
    enableContextCompaction?: boolean;
  } = {},
) {
  const baseSettings = {
    selectedModel: overrides.selectedModel ?? "gpt-4",
    enableContextCompaction: overrides.enableContextCompaction ?? true,
  };

  if (overrides.enableDyadPro && overrides.hasApiKey !== false) {
    return {
      ...baseSettings,
      enableDyadPro: true,
      providerSettings: {
        auto: {
          apiKey: { value: "test-api-key" },
        },
      },
    };
  }

  return baseSettings;
}

/**
 * Creates an async iterable that yields stream parts for testing
 */
function createFakeStream(
  parts: Array<{
    type: string;
    text?: string;
    id?: string;
    toolName?: string;
    delta?: string;
    [key: string]: unknown;
  }>,
): FakeStreamResult {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
    response: Promise.resolve({ messages: [] as any[] }),
    steps: Promise.resolve([] as any[]),
  };
}

type FakeStreamResult = {
  fullStream: AsyncGenerator<
    {
      type: string;
      [key: string]: unknown;
    },
    void,
    unknown
  >;
  response: Promise<{ messages: any[] }>;
  steps?: Promise<any[]>;
};

// ============================================================================
// Mocks
// ============================================================================

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Track database operations
const dbOperations: {
  updates: Array<{ table: string; id: number; data: Record<string, unknown> }>;
  queries: Array<{ table: string; where: Record<string, unknown> }>;
} = { updates: [], queries: [] };

let mockChatData: ReturnType<typeof buildTestChat> | null = null;

vi.mock("@/db", () => ({
  db: {
    query: {
      chats: {
        findFirst: vi.fn(async () => mockChatData),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => ({
        where: vi.fn((condition: any) => {
          dbOperations.updates.push({
            table: "messages",
            id: condition?.id ?? 0,
            data,
          });
          return Promise.resolve();
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));

let mockSettings: ReturnType<typeof buildTestSettings> = buildTestSettings();

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => mockSettings),
  writeSettings: vi.fn(),
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => `/mock/apps/${appPath}`),
}));

// Track IPC messages sent via safeSend
vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: vi.fn((sender, channel, ...args) => {
    if (sender && !sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  }),
}));

let mockStreamResult: FakeStreamResult | null = null;
let mockStreamTextImpl:
  | ((options: Record<string, any>) => FakeStreamResult)
  | null = null;

vi.mock("ai", () => ({
  streamText: vi.fn((options: Record<string, any>) =>
    mockStreamTextImpl ? mockStreamTextImpl(options) : mockStreamResult,
  ),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
  hasToolCall: vi.fn((toolName: string) => ({ toolName })),
}));

vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: vi.fn(async () => ({
    modelClient: {
      model: { id: "test-model" },
      builtinProviderId: "openai",
    },
  })),
}));

vi.mock("@/ipc/utils/token_utils", () => ({
  getMaxTokens: vi.fn(async () => 4096),
  getTemperature: vi.fn(async () => 0.7),
}));

vi.mock("@/ipc/utils/provider_options", () => ({
  getProviderOptions: vi.fn(() => ({})),
  getAiHeaders: vi.fn(() => ({})),
}));

vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: vi.fn(async () => ({
      tools: vi.fn(async () => ({})),
    })),
  },
}));

vi.mock("@/pro/main/ipc/handlers/local_agent/tool_definitions", () => ({
  TOOL_DEFINITIONS: [],
  buildAgentToolSet: vi.fn(() => ({})),
  requireAgentToolConsent: vi.fn(async () => true),
  clearPendingConsentsForChat: vi.fn(),
  clearPendingQuestionnairesForChat: vi.fn(),
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/processors/file_operations",
  () => ({
    deployAllFunctionsIfNeeded: vi.fn(async () => {}),
    commitAllChanges: vi.fn(async () => ({ commitHash: "abc123" })),
  }),
);

const {
  mockIsChatPendingCompaction,
  mockPerformCompaction,
  mockCheckAndMarkForCompaction,
} = vi.hoisted(() => ({
  mockIsChatPendingCompaction: vi.fn(async () => false),
  mockPerformCompaction: vi.fn(async () => ({ success: true })),
  mockCheckAndMarkForCompaction: vi.fn(async () => false),
}));

vi.mock("@/ipc/handlers/compaction/compaction_handler", () => ({
  isChatPendingCompaction: mockIsChatPendingCompaction,
  performCompaction: mockPerformCompaction,
  checkAndMarkForCompaction: mockCheckAndMarkForCompaction,
}));

// ============================================================================
// Import the function under test AFTER mocks are set up
// ============================================================================

import { handleLocalAgentStream } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";

// ============================================================================
// Tests
// ============================================================================

const dyadRequestId = "test-request-id";
describe("handleLocalAgentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbOperations.updates = [];
    dbOperations.queries = [];
    mockChatData = null;
    mockSettings = buildTestSettings();
    mockStreamResult = null;
    mockStreamTextImpl = null;
    mockIsChatPendingCompaction.mockResolvedValue(false);
    mockPerformCompaction.mockResolvedValue({ success: true });
    mockCheckAndMarkForCompaction.mockResolvedValue(false);
    vi.mocked(streamText).mockClear();
  });

  describe("Pro status validation", () => {
    it("should send error when Dyad Pro is not enabled", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: false });

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      const errorMessages = getMessagesByChannel("chat:response:error");
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0].args[0]).toMatchObject({
        chatId: 1,
        error: expect.stringContaining("Agent v2 requires Dyad Pro"),
      });
    });

    it("should send error when API key is missing even if Pro is enabled", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({
        enableDyadPro: true,
        hasApiKey: false,
      });

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      const errorMessages = getMessagesByChannel("chat:response:error");
      expect(errorMessages).toHaveLength(1);
    });
  });

  describe("Chat lookup", () => {
    it("should throw error when chat is not found", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = null; // Chat not found

      // Act & Assert
      await expect(
        handleLocalAgentStream(
          event,
          { chatId: 999, prompt: "test" },
          new AbortController(),
          {
            placeholderMessageId: 10,
            systemPrompt: "You are helpful",
            dyadRequestId,
          },
        ),
      ).rejects.toThrow("Chat not found: 999");
    });

    it("should throw error when chat has no associated app", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = { ...buildTestChat(), app: null } as any;

      // Act & Assert
      await expect(
        handleLocalAgentStream(
          event,
          { chatId: 1, prompt: "test" },
          new AbortController(),
          {
            placeholderMessageId: 10,
            systemPrompt: "You are helpful",
            dyadRequestId,
          },
        ),
      ).rejects.toThrow("Chat not found: 1");
    });
  });

  describe("Context compaction setting", () => {
    it("should not run pending compaction when context compaction is disabled", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({
        enableDyadPro: true,
        enableContextCompaction: false,
      });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([{ type: "text-delta", text: "ok" }]);
      mockIsChatPendingCompaction.mockResolvedValue(true);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      expect(mockPerformCompaction).not.toHaveBeenCalled();
    });
  });

  describe("Mid-turn compaction", () => {
    it("should compact between steps when token usage crosses threshold", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      const t0 = new Date("2025-01-01T00:00:00Z");
      const t1 = new Date("2025-01-01T00:01:00Z");
      const t2 = new Date("2025-01-01T00:02:00Z");
      const t3 = new Date("2025-01-01T00:03:00Z");
      mockChatData = buildTestChat({
        messages: [
          { id: 1, role: "user", content: "old context user", createdAt: t0 },
          {
            id: 2,
            role: "assistant",
            content: "old context assistant",
            createdAt: t1,
          },
          { id: 3, role: "user", content: "current task", createdAt: t2 },
          { id: 10, role: "assistant", content: "", createdAt: t3 }, // placeholder
        ],
      });

      mockIsChatPendingCompaction
        .mockResolvedValueOnce(false) // pre-turn check
        .mockResolvedValueOnce(true) // mid-turn check
        .mockResolvedValue(false);
      mockCheckAndMarkForCompaction.mockResolvedValue(true);
      mockPerformCompaction.mockImplementation(async () => {
        if (!mockChatData) {
          return { success: false, error: "missing chat" };
        }
        mockChatData = {
          ...mockChatData,
          messages: [
            ...mockChatData.messages,
            {
              id: 20,
              role: "assistant",
              content:
                '<dyad-compaction title="Conversation compacted" state="finished">mid-turn summary</dyad-compaction>',
              isCompactionSummary: true,
              createdAt: new Date("2025-01-01T00:03:30Z"),
            },
          ],
        } as any;
        return {
          success: true,
          summary: "mid-turn summary",
          backupPath: ".dyad/chats/1/compaction-test.md",
        };
      });

      let secondStepPreparedMessages: any[] | undefined;
      mockStreamTextImpl = (options) => {
        const firstStepMessages = [
          { role: "user", content: "old context user" },
          { role: "assistant", content: "old context assistant" },
          { role: "user", content: "current task" },
        ];

        return {
          fullStream: (async function* () {
            await options.prepareStep?.({
              messages: firstStepMessages,
              stepNumber: 0,
              steps: [],
              model: {},
              experimental_context: undefined,
            });

            yield { type: "text-delta", text: "before-compaction\n" };

            await options.onStepFinish?.({
              usage: { totalTokens: 200_000 },
              toolCalls: [{}],
            });

            const secondStepMessages = [
              ...firstStepMessages,
              { role: "assistant", content: "tool state assistant" },
              { role: "assistant", content: "tool state result" },
            ];
            const preparedSecondStep = (await options.prepareStep?.({
              messages: secondStepMessages,
              stepNumber: 1,
              steps: [],
              model: {},
              experimental_context: undefined,
            })) ?? { messages: secondStepMessages };

            secondStepPreparedMessages = preparedSecondStep.messages;
            yield { type: "text-delta", text: "done" };
          })(),
          response: Promise.resolve({ messages: [] }),
          steps: Promise.resolve([]),
        };
      };

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      expect(mockCheckAndMarkForCompaction).toHaveBeenCalledWith(1, 200_000);
      expect(mockPerformCompaction).toHaveBeenCalledTimes(1);
      expect(mockPerformCompaction).toHaveBeenCalledWith(
        expect.anything(),
        1,
        "/mock/apps/test-app-path",
        dyadRequestId,
        expect.any(Function),
        { createdAtStrategy: "now" },
      );
      expect(secondStepPreparedMessages).toBeDefined();

      const secondStepContents = (secondStepPreparedMessages ?? []).map(
        (msg: any) =>
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      );

      expect(
        secondStepContents.some((content: string) =>
          content.includes("Conversation compacted"),
        ),
      ).toBe(true);
      expect(secondStepContents).not.toContain("old context user");
      expect(secondStepContents).not.toContain("old context assistant");
      expect(secondStepContents).toContain("tool state assistant");
      expect(secondStepContents).toContain("tool state result");

      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;
      const beforeCompactionIndex = finalContent.indexOf("before-compaction");
      const compactionIndex = finalContent.indexOf("Conversation compacted");
      const doneIndex = finalContent.indexOf("done");
      const backupPathIndex = finalContent.indexOf(
        ".dyad/chats/1/compaction-test.md",
      );

      expect(beforeCompactionIndex).toBeGreaterThanOrEqual(0);
      expect(compactionIndex).toBeGreaterThan(beforeCompactionIndex);
      expect(backupPathIndex).toBeGreaterThan(compactionIndex);
      expect(doneIndex).toBeGreaterThan(compactionIndex);

      const chunkMessages = getMessagesByChannel("chat:response:chunk");
      const streamedMessageIds = chunkMessages.flatMap((message) => {
        const payload = message.args[0] as { messages?: Array<{ id: number }> };
        return (payload.messages ?? []).map((msg) => msg.id);
      });
      expect(streamedMessageIds).not.toContain(20);
    });

    it("should persist post-compaction response messages without reshaping", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      const t0 = new Date("2025-01-01T00:00:00Z");
      const t1 = new Date("2025-01-01T00:01:00Z");
      const t2 = new Date("2025-01-01T00:02:00Z");
      const t3 = new Date("2025-01-01T00:03:00Z");
      mockChatData = buildTestChat({
        messages: [
          { id: 1, role: "user", content: "old context user", createdAt: t0 },
          {
            id: 2,
            role: "assistant",
            content: "old context assistant",
            createdAt: t1,
          },
          { id: 3, role: "user", content: "current task", createdAt: t2 },
          { id: 10, role: "assistant", content: "", createdAt: t3 }, // placeholder
        ],
      });

      mockIsChatPendingCompaction
        .mockResolvedValueOnce(false) // pre-turn check
        .mockResolvedValueOnce(true) // mid-turn check
        .mockResolvedValue(false);
      mockCheckAndMarkForCompaction.mockResolvedValue(true);
      mockPerformCompaction.mockImplementation(async () => {
        if (!mockChatData) {
          return { success: false, error: "missing chat" };
        }
        mockChatData = {
          ...mockChatData,
          messages: [
            ...mockChatData.messages,
            {
              id: 20,
              role: "assistant",
              content:
                '<dyad-compaction title="Conversation compacted" state="finished">mid-turn summary</dyad-compaction>',
              isCompactionSummary: true,
              createdAt: new Date("2025-01-01T00:03:30Z"),
            },
          ],
        } as any;
        return {
          success: true,
          summary: "mid-turn summary",
          backupPath: ".dyad/chats/1/compaction-test.md",
        };
      });

      const preCompactionGenerated = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "before compaction",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "read_file",
              toolCallId: "call_before",
              output: "before result",
            },
          ],
        },
      ];
      const postCompactionGenerated = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "post compaction assistant",
            },
            {
              type: "tool-call",
              toolCallId: "call_after",
              toolName: "read_file",
              input: { path: "SOMEFILE.md" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "read_file",
              toolCallId: "call_after",
              output: "post result",
            },
          ],
        },
      ];

      mockStreamTextImpl = (options) => {
        const firstStepMessages = [
          { role: "user", content: "old context user" },
          { role: "assistant", content: "old context assistant" },
          { role: "user", content: "current task" },
        ];

        return {
          fullStream: (async function* () {
            await options.prepareStep?.({
              messages: firstStepMessages,
              stepNumber: 0,
              steps: [],
              model: {},
              experimental_context: undefined,
            });

            await options.onStepFinish?.({
              usage: { totalTokens: 200_000 },
              toolCalls: [{}],
            });

            const secondStepMessages = [
              ...firstStepMessages,
              ...preCompactionGenerated,
            ];
            await options.prepareStep?.({
              messages: secondStepMessages,
              stepNumber: 1,
              steps: [],
              model: {},
              experimental_context: undefined,
            });

            yield { type: "text-delta", text: "done" };
          })(),
          response: Promise.resolve({
            messages: [...preCompactionGenerated, ...postCompactionGenerated],
          }),
          steps: Promise.resolve([
            {
              response: {
                messages: [...preCompactionGenerated],
              },
              toolCalls: [{}], // First step has tool calls
            },
            {
              response: {
                messages: [
                  ...preCompactionGenerated,
                  ...postCompactionGenerated,
                ],
              },
              toolCalls: [], // Last step has no tool calls (ended with text)
            },
          ]),
        };
      };

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      const aiMessagesUpdates = dbOperations.updates.filter(
        (u) => u.data.aiMessagesJson !== undefined,
      );
      expect(aiMessagesUpdates).toHaveLength(1);
      expect(
        (aiMessagesUpdates[0].data.aiMessagesJson as { messages: unknown[] })
          .messages,
      ).toEqual(postCompactionGenerated);
    });
  });

  describe("Stream processing - text content", () => {
    it("should accumulate text-delta parts and update database", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        messages: [{ id: 1, role: "user", content: "Hello" }],
      });
      mockStreamResult = createFakeStream([
        { type: "text-delta", text: "Hello, " },
        { type: "text-delta", text: "world!" },
      ]);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - check that chunks were sent
      const chunkMessages = getMessagesByChannel("chat:response:chunk");
      expect(chunkMessages.length).toBeGreaterThan(0);

      // Assert - check that end message was sent
      const endMessages = getMessagesByChannel("chat:response:end");
      expect(endMessages).toHaveLength(1);
      expect(endMessages[0].args[0]).toMatchObject({
        chatId: 1,
        updatedFiles: true,
      });

      // Assert - verify database was updated with accumulated content
      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      expect(contentUpdates.length).toBeGreaterThan(0);
      // Final content should contain both chunks
      const lastContentUpdate = contentUpdates[contentUpdates.length - 1];
      expect(lastContentUpdate.data.content).toContain("Hello, ");
      expect(lastContentUpdate.data.content).toContain("world!");
    });
  });

  describe("Stream processing - reasoning blocks", () => {
    it("should wrap reasoning content in think tags", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        { type: "reasoning-start" },
        { type: "reasoning-delta", text: "Let me think..." },
        { type: "reasoning-end" },
        { type: "text-delta", text: "Here is my answer." },
      ]);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - find the final content update
      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      expect(contentUpdates.length).toBeGreaterThan(0);

      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;
      expect(finalContent).toContain("<think>");
      expect(finalContent).toContain("Let me think...");
      expect(finalContent).toContain("</think>");
      expect(finalContent).toContain("Here is my answer.");
    });

    it("should close thinking block when transitioning to text", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      // Simulate reasoning-delta without explicit reasoning-end before text
      mockStreamResult = createFakeStream([
        { type: "reasoning-delta", text: "Thinking here" },
        { type: "text-delta", text: "Answer" },
      ]);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;

      // The thinking block should be closed before the answer
      expect(finalContent).toContain("<think>");
      expect(finalContent).toContain("</think>");
      expect(finalContent).toContain("Answer");
      // Verify order: </think> comes before "Answer"
      const thinkEndIndex = finalContent.indexOf("</think>");
      const answerIndex = finalContent.indexOf("Answer");
      expect(thinkEndIndex).toBeLessThan(answerIndex);
    });
  });

  describe("Synthetic planning_questionnaire reflection", () => {
    it("injects a non-persisted reflection message after invalid planning_questionnaire input", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        messages: [{ id: 1, role: "user", content: "Help me plan this app" }],
      });

      const invalidQuestionnaireInput = {
        title: "Project Requirements",
        questions: [{}],
      };

      let secondStepPreparedMessages: any[] | undefined;

      mockStreamTextImpl = (options) => {
        const firstStepMessages = [
          { role: "user", content: "Help me plan this app" },
        ];

        return {
          fullStream: (async function* () {
            await options.prepareStep?.({
              messages: firstStepMessages,
              stepNumber: 0,
              steps: [],
              model: {},
              experimental_context: undefined,
            });

            await options.onStepFinish?.({
              content: [
                {
                  type: "tool-error",
                  toolName: "planning_questionnaire",
                  toolCallId: "call_plan_q",
                  input: invalidQuestionnaireInput,
                  error:
                    "Invalid input for tool planning_questionnaire: questions[0].question is required",
                },
              ],
              usage: { totalTokens: 1234 },
              toolCalls: [
                {
                  type: "tool-call",
                  toolName: "planning_questionnaire",
                  toolCallId: "call_plan_q",
                  input: invalidQuestionnaireInput,
                },
              ],
            });

            const secondStepMessages = [
              ...firstStepMessages,
              { role: "assistant", content: "retrying questionnaire call" },
            ];
            const preparedSecondStep = (await options.prepareStep?.({
              messages: secondStepMessages,
              stepNumber: 1,
              steps: [],
              model: {},
              experimental_context: undefined,
            })) ?? { messages: secondStepMessages };

            secondStepPreparedMessages = preparedSecondStep.messages;
            yield {
              type: "text-delta",
              text: "I fixed the questionnaire call.",
            };
          })(),
          response: Promise.resolve({
            messages: [
              {
                role: "assistant",
                content: [
                  { type: "text", text: "I fixed the questionnaire call." },
                ],
              },
            ],
          }),
          steps: Promise.resolve([{ toolCalls: [{}] }, { toolCalls: [] }]),
        };
      };

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert
      expect(secondStepPreparedMessages).toBeDefined();
      const reflectionMessage = (secondStepPreparedMessages ?? []).find(
        (message: any) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.includes(
                "planning_questionnaire tool call had a format error",
              ),
          ),
      );
      expect(reflectionMessage).toBeDefined();

      const aiMessagesUpdate = dbOperations.updates.find(
        (u) => u.data.aiMessagesJson !== undefined,
      );
      expect(aiMessagesUpdate).toBeDefined();
      const persistedAiMessages = JSON.stringify(
        (aiMessagesUpdate!.data.aiMessagesJson as { messages: unknown[] })
          .messages,
      );
      expect(persistedAiMessages).not.toContain(
        "planning_questionnaire tool call had a format error",
      );
    });
  });

  describe("Abort handling", () => {
    it("should stop processing stream chunks when abort signal is triggered", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const abortController = new AbortController();

      // Create a stream that will be aborted mid-way
      let yieldCount = 0;
      mockStreamResult = {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "First " };
          yieldCount++;
          // Abort after first chunk
          abortController.abort();
          yield { type: "text-delta", text: "Second" };
          yieldCount++;
        })(),
        response: Promise.resolve({ messages: [] }),
      };

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        abortController,
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - only first chunk should be processed (stream breaks on abort)
      expect(yieldCount).toBe(1);

      // Verify only the first chunk made it into the response
      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      expect(contentUpdates.length).toBeGreaterThan(0);
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;
      expect(finalContent).toContain("First ");
      expect(finalContent).not.toContain("Second");
    });

    it("should save partial response with cancellation note when aborted", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const abortController = new AbortController();

      mockStreamResult = {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "Partial response" };
          abortController.abort();
          // This will not be processed due to abort
          throw new Error("Simulated abort error");
        })(),
        response: Promise.resolve({ messages: [] }),
      };

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        abortController,
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - should have saved cancellation message
      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const hasCancellationNote = contentUpdates.some((u) =>
        (u.data.content as string).includes("[Response cancelled by user]"),
      );
      expect(hasCancellationNote).toBe(true);
    });
  });

  describe("Commit handling", () => {
    it("should save commit hash after successful stream", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        { type: "text-delta", text: "Done" },
      ]);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - commit hash should be saved
      const commitUpdates = dbOperations.updates.filter(
        (u) => u.data.commitHash !== undefined,
      );
      expect(commitUpdates).toHaveLength(1);
      expect(commitUpdates[0].data.commitHash).toBe("abc123");
    });

    it("should set approval state to approved after completion", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        { type: "text-delta", text: "Done" },
      ]);

      // Act
      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      // Assert - approval state should be set
      const approvalUpdates = dbOperations.updates.filter(
        (u) => u.data.approvalState !== undefined,
      );
      expect(approvalUpdates).toHaveLength(1);
      expect(approvalUpdates[0].data.approvalState).toBe("approved");
    });
  });
});
