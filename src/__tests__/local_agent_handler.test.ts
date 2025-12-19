import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IpcMainInvokeEvent, WebContents } from "electron";

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
  } = {},
) {
  const baseSettings = {
    selectedModel: overrides.selectedModel ?? "gpt-4",
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
) {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
    response: Promise.resolve({ messages: [] }),
  };
}

// ============================================================================
// Mocks
// ============================================================================

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
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

let mockStreamResult: ReturnType<typeof createFakeStream> | null = null;

vi.mock("ai", () => ({
  streamText: vi.fn(() => mockStreamResult),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
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
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/processors/file_operations",
  () => ({
    deployAllFunctionsIfNeeded: vi.fn(async () => {}),
    commitAllChanges: vi.fn(async () => ({ commitHash: "abc123" })),
  }),
);

// ============================================================================
// Import the function under test AFTER mocks are set up
// ============================================================================

import { handleLocalAgentStream } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";

// ============================================================================
// Tests
// ============================================================================

describe("handleLocalAgentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbOperations.updates = [];
    dbOperations.queries = [];
    mockChatData = null;
    mockSettings = buildTestSettings();
    mockStreamResult = null;
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
          { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
          { placeholderMessageId: 10, systemPrompt: "You are helpful" },
        ),
      ).rejects.toThrow("Chat not found: 1");
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
        { placeholderMessageId: 10, systemPrompt: "You are helpful" },
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
