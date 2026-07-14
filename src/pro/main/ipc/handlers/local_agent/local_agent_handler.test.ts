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
let mockMcpServers: Array<{ id: number; name: string }> = [];
let mockMcpToolSet: Record<string, Record<string, unknown>> = {};

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
        where: vi.fn(() => Promise.resolve(mockMcpServers)),
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

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((options: Record<string, any>) =>
      mockStreamTextImpl ? mockStreamTextImpl(options) : mockStreamResult,
    ),
    stepCountIs: vi.fn((n: number) => ({ steps: n })),
    hasToolCall: vi.fn((toolName: string) => ({ toolName })),
  };
});

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
  DYAD_INTERNAL_REQUEST_ID_HEADER: "x-dyad-internal-request-id",
}));

vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: vi.fn(async () => ({
      tools: vi.fn(async () => mockMcpToolSet),
    })),
  },
}));

const mockRequireMcpToolConsent = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/mcp_consent", () => ({
  requireMcpToolConsent: mockRequireMcpToolConsent,
  clearPendingMcpConsentsForChat: vi.fn(),
}));

vi.mock("@/pro/main/ipc/handlers/local_agent/tool_definitions", () => ({
  TOOL_DEFINITIONS: [],
  buildAgentToolSet: vi.fn(() => ({})),
  shouldIncludeTool: vi.fn(() => false),
  requireAgentToolConsent: vi.fn(async () => true),
  clearPendingConsentsForChat: vi.fn(),
}));

vi.mock("@/pro/main/ipc/handlers/local_agent/userInputResolvers", () => ({
  questionnaireResolver: {
    wait: vi.fn(),
    resolve: vi.fn(),
    abortChat: vi.fn(),
  },
  integrationResolver: {
    wait: vi.fn(),
    resolve: vi.fn(),
    abortChat: vi.fn(),
  },
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/processors/file_operations",
  () => ({
    deployAllFunctionsIfNeeded: vi.fn(async () => ({ success: true })),
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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { buildAgentToolSet } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import {
  commitAllChanges,
  deployAllFunctionsIfNeeded,
} from "@/pro/main/ipc/handlers/local_agent/processors/file_operations";
import { MCP_RESULT_MAX_BYTES } from "@/ipc/utils/mcp_result_sanitizer";

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
    mockMcpServers = [];
    mockMcpToolSet = {};
    mockSettings = buildTestSettings();
    mockStreamResult = null;
    mockStreamTextImpl = null;
    mockIsChatPendingCompaction.mockReset().mockResolvedValue(false);
    mockPerformCompaction.mockReset().mockResolvedValue({ success: true });
    mockCheckAndMarkForCompaction.mockReset().mockResolvedValue(false);
    vi.mocked(streamText).mockClear();
    vi.mocked(buildAgentToolSet).mockImplementation(() => ({}));
    mockRequireMcpToolConsent.mockResolvedValue({ approved: true });
  });

  describe("MCP result limits", () => {
    it("bounds direct MCP tool output before it reaches XML or model history", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockMcpServers = [{ id: 42, name: "srv" }];
      const hugeText = "m".repeat(MCP_RESULT_MAX_BYTES * 3);
      mockMcpToolSet = {
        huge: {
          description: "Return a large result",
          inputSchema: { type: "object" },
          execute: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: hugeText }],
          }),
        },
      };

      let returnedOutput = "";
      mockStreamTextImpl = (options) => ({
        fullStream: (async function* () {
          const mcpTool = options.tools.srv__huge;
          returnedOutput = await mcpTool.execute(
            {},
            { toolCallId: "call-1", messages: [] },
          );
          yield {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "srv__huge",
            input: {},
          };
          yield {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "srv__huge",
            output: returnedOutput,
          };
        })(),
        response: Promise.resolve({ messages: [] }),
        steps: Promise.resolve([{ toolCalls: [{ toolName: "srv__huge" }] }]),
      });

      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "use the MCP tool" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
        },
      );

      expect(Buffer.byteLength(returnedOutput, "utf8")).toBeLessThanOrEqual(
        MCP_RESULT_MAX_BYTES,
      );
      expect(returnedOutput).toContain("_dyadMcpTruncation");
      expect(returnedOutput).not.toContain(hugeText);
      const persistedContent = dbOperations.updates
        .filter((operation) => typeof operation.data.content === "string")
        .map((operation) => operation.data.content as string)
        .join("\n");
      expect(persistedContent).toContain("_dyadMcpTruncation");
      expect(persistedContent).not.toContain(hugeText);
    });
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

  describe("Warning propagation", () => {
    it("replaces partial output with an inline warning for Fable refusals", async () => {
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        { type: "text-delta", id: "text-1", text: "Incomplete output" },
        {
          type: "finish",
          finishReason: "content-filter",
          rawFinishReason: "refusal",
        },
      ]);

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

      const contentUpdates = dbOperations.updates.filter(
        (update) => update.data.content !== undefined,
      );
      const finalContent = contentUpdates.at(-1)?.data.content as string;
      expect(finalContent).not.toContain("Incomplete output");
      expect(finalContent).toContain(
        '<dyad-output type="warning" message="Request declined by the model">',
      );
      const aiMessagesUpdate = dbOperations.updates.find(
        (update) => update.data.aiMessagesJson !== undefined,
      );
      expect(JSON.stringify(aiMessagesUpdate?.data.aiMessagesJson)).toContain(
        "Request declined by the model",
      );
      expect(
        getMessagesByChannel("chat:response:end")[0].args[0],
      ).toMatchObject({
        updatedFiles: false,
      });
    });

    it("includes warning messages in the error payload when a tool fails after warning", async () => {
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const warningMessage = "Firewall checks were skipped for this install.";
      vi.mocked(buildAgentToolSet).mockImplementationOnce((ctx) => {
        return {
          warn_then_fail: {
            execute: async () => {
              ctx.onWarningMessage?.(warningMessage);
              throw new Error("Simulated tool failure");
            },
          },
        } as any;
      });

      mockStreamTextImpl = (options) => ({
        fullStream: (async function* () {
          yield* [];
          await options.tools.warn_then_fail.execute();
        })(),
        response: Promise.resolve({ messages: [] }),
        steps: Promise.resolve([]),
      });

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

      const errorMessages = getMessagesByChannel("chat:response:error");
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0].args[0]).toMatchObject({
        chatId: 1,
        error: expect.stringContaining("Simulated tool failure"),
        warningMessages: [warningMessage],
      });
    });

    it("persists successful shared-module Supabase deploy status into aiMessagesJson", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        supabaseProjectId: "supabase-project-id",
      });
      mockStreamResult = createFakeStream([{ type: "text-delta", text: "ok" }]);
      vi.mocked(deployAllFunctionsIfNeeded).mockImplementationOnce(
        async (ctx) => {
          ctx.onXmlComplete(
            '<dyad-status title="Supabase functions deployed: 2/2 complete" state="finished">\n2 succeeded\n0 failed\n</dyad-status>',
          );
          return { success: true };
        },
      );

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

      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;

      expect(finalContent).toContain("<dyad-status");
      expect(finalContent).toContain(
        'title="Supabase functions deployed: 2/2 complete"',
      );
      expect(commitAllChanges).toHaveBeenCalled();

      const aiMessagesUpdates = dbOperations.updates.filter(
        (u) => u.data.aiMessagesJson !== undefined,
      );
      expect(aiMessagesUpdates.length).toBeGreaterThan(0);
      const persistedAiMessages = JSON.stringify(
        (
          aiMessagesUpdates[aiMessagesUpdates.length - 1].data
            .aiMessagesJson as { messages: unknown[] }
        ).messages,
      );
      expect(persistedAiMessages).toContain("<dyad-status");
      expect(persistedAiMessages).toContain(
        'title=\\"Supabase functions deployed: 2/2 complete\\"',
      );
    });

    it("appends shared-module Supabase deploy warnings as dyad-output", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        supabaseProjectId: "supabase-project-id",
      });
      mockStreamResult = createFakeStream([{ type: "text-delta", text: "ok" }]);
      vi.mocked(deployAllFunctionsIfNeeded).mockResolvedValueOnce({
        success: true,
        warning:
          "Some Supabase functions failed to deploy: Failed to bundle get-user-role: Rate limited (429): Too Many Requests",
      });

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

      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;

      expect(finalContent).toContain('<dyad-output type="warning"');
      expect(finalContent).toContain(
        'message="Supabase function deploy warning"',
      );
      expect(finalContent).toContain(
        "Some Supabase functions failed to deploy: Failed to bundle get-user-role: Rate limited (429): Too Many Requests",
      );
      expect(commitAllChanges).toHaveBeenCalled();

      // Persist deploy XML into aiMessagesJson so future agent turns can see it.
      const aiMessagesUpdates = dbOperations.updates.filter(
        (u) => u.data.aiMessagesJson !== undefined,
      );
      expect(aiMessagesUpdates.length).toBeGreaterThan(0);
      const persistedAiMessages = JSON.stringify(
        (
          aiMessagesUpdates[aiMessagesUpdates.length - 1].data
            .aiMessagesJson as { messages: unknown[] }
        ).messages,
      );
      expect(persistedAiMessages).toContain('<dyad-output type=\\"warning\\"');
      expect(persistedAiMessages).toContain(
        'message=\\"Supabase function deploy warning\\"',
      );
    });

    it("appends shared-module Supabase deploy failures as dyad-output and still commits", async () => {
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        supabaseProjectId: "supabase-project-id",
      });
      mockStreamResult = createFakeStream([{ type: "text-delta", text: "ok" }]);
      vi.mocked(deployAllFunctionsIfNeeded).mockResolvedValueOnce({
        success: false,
        error:
          "Failed to redeploy Supabase functions: RateLimitError: Rate limited (429): Too Many Requests",
      });

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

      const errorMessages = getMessagesByChannel("chat:response:error");
      expect(errorMessages).toHaveLength(0);

      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;

      expect(finalContent).toContain('<dyad-output type="error"');
      expect(finalContent).toContain(
        'message="Failed to deploy Supabase functions"',
      );
      expect(finalContent).toContain(
        "Failed to redeploy Supabase functions: RateLimitError: Rate limited (429): Too Many Requests",
      );
      expect(commitAllChanges).toHaveBeenCalled();

      // Persist deploy XML into aiMessagesJson so future agent turns can see it.
      const aiMessagesUpdates = dbOperations.updates.filter(
        (u) => u.data.aiMessagesJson !== undefined,
      );
      expect(aiMessagesUpdates.length).toBeGreaterThan(0);
      const persistedAiMessages = JSON.stringify(
        (
          aiMessagesUpdates[aiMessagesUpdates.length - 1].data
            .aiMessagesJson as { messages: unknown[] }
        ).messages,
      );
      expect(persistedAiMessages).toContain('<dyad-output type=\\"error\\"');
      expect(persistedAiMessages).toContain(
        'message=\\"Failed to deploy Supabase functions\\"',
      );
    });

    it("warns when a sandbox script does not read the current attachment", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        {
          type: "tool-call",
          toolName: "execute_sandbox_script",
          input: { script: 'read_file("src/App.tsx");' },
        },
        { type: "text-delta", text: "I checked the project file." },
      ]);

      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
          currentTurnHasOnDiskAttachment: true,
        },
      );

      const finalContent = [...dbOperations.updates]
        .reverse()
        .find((update) => typeof update.data.content === "string")
        ?.data.content;
      expect(finalContent).toContain(
        "Your model did not reference the attached file",
      );
    });

    it("does not warn when a sandbox script reads an attachment path", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        {
          type: "tool-call",
          toolName: "execute_sandbox_script",
          input: { script: 'read_file("attachments:notes.txt");' },
        },
        { type: "text-delta", text: "I checked the attachment." },
      ]);

      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
          currentTurnHasOnDiskAttachment: true,
        },
      );

      const finalContent = [...dbOperations.updates]
        .reverse()
        .find((update) => typeof update.data.content === "string")
        ?.data.content;
      expect(finalContent).not.toContain(
        "Your model did not reference the attached file",
      );
    });

    it("does not warn when a sandbox script uses the attachments alias", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        {
          type: "tool-call",
          toolName: "execute_sandbox_script",
          input: { script: 'const files = await list_files("attachments");' },
        },
        { type: "text-delta", text: "I checked the attachment list." },
      ]);

      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
          currentTurnHasOnDiskAttachment: true,
        },
      );

      const finalContent = [...dbOperations.updates]
        .reverse()
        .find((update) => typeof update.data.content === "string")
        ?.data.content;
      expect(finalContent).not.toContain(
        "Your model did not reference the attached file",
      );
    });

    it("warns when a sandbox script only mentions attachments in prose", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([
        {
          type: "tool-call",
          toolName: "execute_sandbox_script",
          input: { script: 'const message = "No attachments found";' },
        },
        { type: "text-delta", text: "I checked the project file." },
      ]);

      await handleLocalAgentStream(
        event,
        { chatId: 1, prompt: "test" },
        new AbortController(),
        {
          placeholderMessageId: 10,
          systemPrompt: "You are helpful",
          dyadRequestId,
          currentTurnHasOnDiskAttachment: true,
        },
      );

      const finalContent = [...dbOperations.updates]
        .reverse()
        .find((update) => typeof update.data.content === "string")
        ?.data.content;
      expect(finalContent).toContain(
        "Your model did not reference the attached file",
      );
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
    it("preserves the full in-flight tail after sanitizing follow-up history", async () => {
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      vi.mocked(buildAgentToolSet).mockImplementation((ctx) => {
        return {
          update_todos: {
            execute: async (args: any) => {
              ctx.todos = args.todos;
              ctx.onUpdateTodos(ctx.todos);
              return "Updated todos";
            },
          },
        } as any;
      });

      mockIsChatPendingCompaction
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
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
              content: "Conversation compacted.",
              isCompactionSummary: true,
              createdAt: new Date("2025-01-01T00:03:30Z"),
            },
          ],
        } as any;
        return {
          success: true,
          summary: "Conversation compacted.",
          backupPath: ".dyad/chats/1/compaction-test.md",
        };
      });

      const splitParallelToolHistory = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_file",
              input: { path: "src/App.tsx" },
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "read_file",
              input: { path: "src/main.tsx" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "read_file",
              output: "App result",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "read_file",
              output: "main result",
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I started the work." }],
        },
      ];
      const inFlightAssistant = {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-live",
            toolName: "read_file",
            input: { path: "src/live.ts" },
          },
        ],
      };
      const inFlightTool = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-live",
            toolName: "read_file",
            output: "live result",
          },
        ],
      };

      let passCount = 0;
      let preparedAfterCompaction: any[] = [];
      mockStreamTextImpl = (options) => {
        passCount += 1;
        if (passCount === 1) {
          return {
            fullStream: (async function* () {
              await options.tools.update_todos.execute({
                merge: false,
                todos: [
                  {
                    id: "todo-1",
                    content: "Finish the requested work",
                    status: "pending",
                  },
                ],
              });
              yield { type: "text-delta", text: "I started the work." };
            })(),
            response: Promise.resolve({
              messages: splitParallelToolHistory,
            }),
            steps: Promise.resolve([
              {
                toolCalls: [{ toolName: "set_chat_summary" }],
                response: { messages: splitParallelToolHistory },
              },
            ]),
          };
        }

        return {
          fullStream: (async function* () {
            await options.onStepFinish?.({
              usage: { totalTokens: 200_000 },
              toolCalls: [{}],
            });
            const stepMessages = [
              ...options.messages,
              inFlightAssistant,
              inFlightTool,
            ];
            const prepared = (await options.prepareStep?.({
              messages: stepMessages,
              stepNumber: 1,
              steps: [],
              model: {},
              experimental_context: undefined,
            })) ?? { messages: stepMessages };
            preparedAfterCompaction = prepared.messages;
            yield { type: "text-delta", text: "Finished the work." };
          })(),
          response: Promise.resolve({ messages: [] }),
          steps: Promise.resolve([]),
        };
      };

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

      expect(passCount).toBe(2);
      expect(mockPerformCompaction).toHaveBeenCalledTimes(1);
      expect(preparedAfterCompaction).toContain(inFlightAssistant);
      expect(preparedAfterCompaction).toContain(inFlightTool);
    });

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
    it("does not send AI SDK history in full renderer message chunks", async () => {
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat({
        messages: [
          {
            id: 1,
            role: "user",
            content: "Visible prompt",
            aiMessagesJson: {
              version: 6,
              messages: [
                {
                  role: "user",
                  content: "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
                },
              ],
            },
          },
        ],
      });
      mockStreamResult = createFakeStream([
        { type: "text-delta", text: "Done" },
      ]);

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

      const fullChunks = getMessagesByChannel("chat:response:chunk")
        .map((message) => message.args[0] as { messages?: unknown[] })
        .filter((payload) => payload.messages !== undefined);
      expect(fullChunks.length).toBeGreaterThan(0);
      expect(JSON.stringify(fullChunks)).not.toContain("aiMessagesJson");
      expect(JSON.stringify(fullChunks)).not.toContain(
        "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
      );
    });

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

    it("should retry and resume when a stream terminates transiently", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const streamMessagesByAttempt: any[][] = [];
      let attemptCount = 0;
      mockStreamTextImpl = (options) => {
        attemptCount += 1;
        streamMessagesByAttempt.push(options.messages ?? []);

        if (attemptCount === 1) {
          return {
            fullStream: (async function* () {
              yield { type: "text-delta", text: "Partial response. " };
              throw new TypeError("terminated");
            })(),
            response: Promise.resolve({ messages: [] }),
            steps: Promise.resolve([]),
          };
        }

        return {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Recovered output." };
          })(),
          response: Promise.resolve({
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Recovered output." }],
              },
            ],
          }),
          steps: Promise.resolve([{ toolCalls: [] }]),
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
      expect(attemptCount).toBe(2);
      expect(getMessagesByChannel("chat:response:error")).toHaveLength(0);

      const contentUpdates = dbOperations.updates.filter(
        (u) => u.data.content !== undefined,
      );
      const finalContent = contentUpdates[contentUpdates.length - 1].data
        .content as string;
      expect(finalContent).toContain("Partial response.");
      expect(finalContent).toContain("Recovered output.");

      const continuationInstructionFound = (
        streamMessagesByAttempt[1] ?? []
      ).some(
        (message: any) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.includes(
                "previous response stream was interrupted by a transient network error",
              ),
          ),
      );
      expect(continuationInstructionFound).toBe(true);
    });

    it("should replay emitted tool events before retrying a terminated stream", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const streamMessagesByAttempt: any[][] = [];
      let attemptCount = 0;
      mockStreamTextImpl = (options) => {
        attemptCount += 1;
        streamMessagesByAttempt.push(options.messages ?? []);

        if (attemptCount === 1) {
          return {
            fullStream: (async function* () {
              yield { type: "text-delta", text: "Working with tools. " };
              yield {
                type: "tool-call",
                toolCallId: "call_replay_1",
                toolName: "read_file",
                input: { path: "README.md" },
              };
              yield {
                type: "tool-result",
                toolCallId: "call_replay_1",
                toolName: "read_file",
                output: "README content",
              };
              throw new TypeError("terminated");
            })(),
            response: Promise.resolve({ messages: [] }),
            steps: Promise.resolve([]),
          };
        }

        return {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Resumed after replay." };
          })(),
          response: Promise.resolve({
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Resumed after replay." }],
              },
            ],
          }),
          steps: Promise.resolve([{ toolCalls: [] }]),
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
      expect(attemptCount).toBe(2);
      expect(getMessagesByChannel("chat:response:error")).toHaveLength(0);

      const secondAttemptMessages = streamMessagesByAttempt[1] ?? [];
      const hasReplayedToolCall = secondAttemptMessages.some(
        (message: any) =>
          message.role === "assistant" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "tool-call" &&
              part.toolCallId === "call_replay_1" &&
              part.toolName === "read_file",
          ),
      );
      const hasReplayedToolResult = secondAttemptMessages.some(
        (message: any) =>
          message.role === "tool" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "tool-result" &&
              part.toolCallId === "call_replay_1" &&
              part.toolName === "read_file" &&
              part.output?.type === "text" &&
              part.output?.value === "README content",
          ),
      );

      expect(hasReplayedToolCall).toBe(true);
      expect(hasReplayedToolResult).toBe(true);
    });

    it("should retry and resume when the provider emits a retryable server error", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const streamMessagesByAttempt: any[][] = [];
      let attemptCount = 0;
      mockStreamTextImpl = (options) => {
        attemptCount += 1;
        streamMessagesByAttempt.push(options.messages ?? []);

        if (attemptCount === 1) {
          return {
            fullStream: (async function* () {
              yield* [];
              throw {
                type: "error",
                sequence_number: 0,
                error: {
                  type: "server_error",
                  code: "server_error",
                  message: "The server had an error processing your request.",
                },
              };
            })(),
            response: Promise.resolve({ messages: [] }),
            steps: Promise.resolve([]),
          };
        }

        return {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Recovered after retry." };
          })(),
          response: Promise.resolve({
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Recovered after retry." }],
              },
            ],
          }),
          steps: Promise.resolve([{ toolCalls: [] }]),
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
      expect(attemptCount).toBe(2);
      expect(getMessagesByChannel("chat:response:error")).toHaveLength(0);

      const continuationInstructionFound = (
        streamMessagesByAttempt[1] ?? []
      ).some(
        (message: any) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.includes(
                "previous response stream was interrupted by a transient network error",
              ),
          ),
      );
      expect(continuationInstructionFound).toBe(true);
    });

    it("should report circular provider errors without overflowing the stack", async () => {
      // Arrange
      const { event, getMessagesByChannel } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      const circularStreamError: Record<string, unknown> = {
        message: "provider exploded",
      };
      circularStreamError.error = circularStreamError;

      mockStreamResult = {
        fullStream: (async function* () {
          yield* [];
          throw circularStreamError;
        })(),
        response: Promise.resolve({ messages: [] }),
        steps: Promise.resolve([]),
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
      const errorMessages = getMessagesByChannel("chat:response:error");
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0].args[0]).toMatchObject({
        chatId: 1,
        error: "Error: provider exploded",
      });
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

  describe("Todo follow-up", () => {
    it("does not stop the stream when set_chat_summary is called", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();
      mockStreamResult = createFakeStream([]);

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
      const streamOptions = vi.mocked(streamText).mock.calls[0]?.[0] as any;
      expect(streamOptions.stopWhen).not.toContainEqual({
        toolName: "set_chat_summary",
      });
    });

    it("runs a follow-up pass when the first pass ends with set_chat_summary and incomplete todos remain", async () => {
      // Arrange
      const { event } = createFakeEvent();
      mockSettings = buildTestSettings({ enableDyadPro: true });
      mockChatData = buildTestChat();

      vi.mocked(buildAgentToolSet).mockImplementation((ctx) => {
        return {
          update_todos: {
            execute: async (args: any) => {
              if (args.merge) {
                const todosById = new Map(
                  ctx.todos.map((todo) => [todo.id, todo]),
                );
                for (const todo of args.todos) {
                  const existing = todosById.get(todo.id);
                  todosById.set(
                    todo.id,
                    existing ? { ...existing, ...todo } : todo,
                  );
                }
                ctx.todos = Array.from(todosById.values());
              } else {
                ctx.todos = args.todos;
              }
              ctx.onUpdateTodos(ctx.todos);
              return "Updated todos";
            },
          },
        } as any;
      });

      const streamMessagesByPass: any[][] = [];
      let passCount = 0;
      mockStreamTextImpl = (options) => {
        passCount += 1;
        streamMessagesByPass.push(options.messages ?? []);

        if (passCount === 1) {
          return {
            fullStream: (async function* () {
              yield { type: "text-delta", text: "I started the work." };
              await options.tools.update_todos.execute({
                merge: false,
                todos: [
                  {
                    id: "todo-1",
                    content: "Finish the requested work",
                    status: "pending",
                  },
                ],
              });
            })(),
            response: Promise.resolve({
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "I started the work." }],
                },
              ],
            }),
            steps: Promise.resolve([
              {
                toolCalls: [{ toolName: "set_chat_summary" }],
                response: {
                  messages: [
                    {
                      role: "assistant",
                      content: [{ type: "text", text: "I started the work." }],
                    },
                  ],
                },
              },
            ]),
          };
        }

        return {
          fullStream: (async function* () {
            await options.tools.update_todos.execute({
              merge: true,
              todos: [{ id: "todo-1", status: "completed" }],
            });
            yield { type: "text-delta", text: "Finished the work." };
          })(),
          response: Promise.resolve({
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Finished the work." }],
              },
            ],
          }),
          steps: Promise.resolve([{ toolCalls: [] }]),
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
      expect(passCount).toBe(2);
      const secondPassMessages = streamMessagesByPass[1] ?? [];
      const hasTodoReminder = secondPassMessages.some(
        (message: any) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.includes("incomplete todo(s)") &&
              part.text.includes("Finish the requested work"),
          ),
      );
      expect(hasTodoReminder).toBe(true);
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
      expect(finalContent).toContain("First");
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
          throw new DyadError("Simulated abort error", DyadErrorKind.Internal);
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
