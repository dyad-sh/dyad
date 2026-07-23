import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { setDatabaseForTesting } from "@/db";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

const { mockSafeSend, mockStorePreCompactionMessages, mockStreamText } =
  vi.hoisted(() => ({
    mockSafeSend: vi.fn(),
    mockStorePreCompactionMessages: vi.fn(
      async () => ".dyad/chats/1/compaction-test.md",
    ),
    mockStreamText: vi.fn(),
  }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: mockStreamText };
});

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    selectedModel: { provider: "anthropic", name: "test-model" },
  }),
}));

vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: async () => ({
    modelClient: {
      model: {},
      builtinProviderId: "test-provider",
    },
  }),
}));

vi.mock("@/ipc/utils/provider_options", () => ({
  DYAD_INTERNAL_REQUEST_ID_HEADER: "x-dyad-request-id",
  getAiHeaders: () => ({}),
  getProviderOptions: () => ({}),
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: mockSafeSend,
}));

vi.mock("@/ipc/utils/stream_text_utils", () => ({
  cancelOrphanedBaseStream: vi.fn(),
  fastTextOutput: () => undefined,
}));

vi.mock("./compaction_storage", () => ({
  formatAsTranscript: () => "test transcript",
  storePreCompactionMessages: mockStorePreCompactionMessages,
}));

import { performCompaction } from "./compaction_handler";

function textStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("performCompaction", () => {
  let testDb: TestDb;
  let chatId: number;

  beforeEach(() => {
    testDb = createInMemoryTestDb();
    setDatabaseForTesting(testDb);

    const app = testDb
      .insert(apps)
      .values({ name: "Test app", path: "test-app" })
      .returning()
      .get();
    const chat = testDb
      .insert(chats)
      .values({ appId: app.id, pendingCompaction: true })
      .returning()
      .get();
    chatId = chat.id;
    testDb
      .insert(messages)
      .values([
        { chatId, role: "user", content: "Original question" },
        { chatId, role: "assistant", content: "Original answer" },
      ])
      .run();

    mockStreamText.mockReset();
    mockSafeSend.mockClear();
    mockStorePreCompactionMessages.mockClear();
  });

  afterEach(() => {
    setDatabaseForTesting(null);
    testDb.$client.close();
  });

  const loadChat = () =>
    testDb.query.chats.findFirst({ where: eq(chats.id, chatId) });

  const loadSummaryMessages = () =>
    testDb.query.messages
      .findMany({
        where: eq(messages.chatId, chatId),
      })
      .then((rows) => rows.filter((message) => message.isCompactionSummary));

  it("aborts mid-summary without persisting or broadcasting and retains the pending mark", async () => {
    const controller = new AbortController();
    mockStreamText.mockReturnValue({
      textStream: textStream(["partial", "ignored"]),
    });

    const result = await performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "request-id",
      () => controller.abort(),
      { abortSignal: controller.signal },
    );

    expect(result).toEqual({
      success: false,
      aborted: true,
      error: "Compaction aborted",
    });
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    );
    await expect(loadSummaryMessages()).resolves.toEqual([]);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: true,
      compactedAt: null,
      compactionBackupPath: null,
    });
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  it("bails immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "request-id",
      undefined,
      { abortSignal: controller.signal },
    );

    expect(result).toEqual({
      success: false,
      aborted: true,
      error: "Compaction aborted",
    });
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(mockStorePreCompactionMessages).not.toHaveBeenCalled();
    await expect(loadSummaryMessages()).resolves.toEqual([]);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: true,
      compactedAt: null,
      compactionBackupPath: null,
    });
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  it("preserves the normal compaction path", async () => {
    const controller = new AbortController();
    mockStreamText.mockReturnValue({
      textStream: textStream(["Complete summary"]),
    });

    const result = await performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "request-id",
      undefined,
      { abortSignal: controller.signal },
    );

    expect(result).toMatchObject({
      success: true,
      summary: "Complete summary",
      backupPath: ".dyad/chats/1/compaction-test.md",
    });
    await expect(loadSummaryMessages()).resolves.toHaveLength(1);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: false,
      compactionBackupPath: ".dyad/chats/1/compaction-test.md",
    });
    expect(mockSafeSend).toHaveBeenCalledWith(
      expect.anything(),
      "chat:compaction:complete",
      {
        chatId,
        backupPath: ".dyad/chats/1/compaction-test.md",
      },
    );
  });

  it("single-flights concurrent compaction attempts for one chat", async () => {
    let releaseSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    mockStreamText.mockReturnValue({
      textStream: {
        async *[Symbol.asyncIterator]() {
          await summaryGate;
          yield "Only summary";
        },
      },
    });

    const winner = performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "winner-request",
    );
    await vi.waitFor(() => expect(mockStreamText).toHaveBeenCalledOnce());

    await expect(
      performCompaction(
        { sender: {} } as never,
        chatId,
        "/tmp/test-app",
        "loser-request",
      ),
    ).resolves.toEqual({ success: false, skipped: true });

    releaseSummary();
    await expect(winner).resolves.toMatchObject({
      success: true,
      summary: "Only summary",
    });
    await expect(loadSummaryMessages()).resolves.toHaveLength(1);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: false,
    });
    expect(mockSafeSend).toHaveBeenCalledTimes(1);
  });

  it("allows a third attempt after the winner aborts and retains the pending mark", async () => {
    const controller = new AbortController();
    let releaseAbortedSummary!: () => void;
    const abortedSummaryGate = new Promise<void>((resolve) => {
      releaseAbortedSummary = resolve;
    });
    mockStreamText.mockReturnValueOnce({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "partial";
          await abortedSummaryGate;
          yield "ignored";
        },
      },
    });

    const winner = performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "winner-request",
      () => controller.abort(),
      { abortSignal: controller.signal },
    );
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));

    await expect(
      performCompaction(
        { sender: {} } as never,
        chatId,
        "/tmp/test-app",
        "loser-request",
      ),
    ).resolves.toEqual({ success: false, skipped: true });

    releaseAbortedSummary();
    await expect(winner).resolves.toEqual({
      success: false,
      aborted: true,
      error: "Compaction aborted",
    });
    await expect(loadSummaryMessages()).resolves.toEqual([]);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: true,
    });

    mockStreamText.mockReturnValueOnce({
      textStream: textStream(["Retried summary"]),
    });
    await expect(
      performCompaction(
        { sender: {} } as never,
        chatId,
        "/tmp/test-app",
        "third-request",
      ),
    ).resolves.toMatchObject({
      success: true,
      summary: "Retried summary",
    });
    await expect(loadSummaryMessages()).resolves.toHaveLength(1);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: false,
    });
    expect(mockSafeSend).toHaveBeenCalledTimes(1);
  });

  it("allows a third attempt after the winner fails and retains the pending mark", async () => {
    let rejectSummary!: () => void;
    const summaryFailureGate = new Promise<void>((resolve) => {
      rejectSummary = resolve;
    });
    mockStreamText.mockReturnValueOnce({
      textStream: {
        async *[Symbol.asyncIterator]() {
          await summaryFailureGate;
          yield await Promise.reject(new Error("provider failed"));
        },
      },
    });

    const winner = performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "winner-request",
    );
    await vi.waitFor(() => expect(mockStreamText).toHaveBeenCalledOnce());

    await expect(
      performCompaction(
        { sender: {} } as never,
        chatId,
        "/tmp/test-app",
        "loser-request",
      ),
    ).resolves.toEqual({ success: false, skipped: true });

    rejectSummary();
    await expect(winner).resolves.toEqual({
      success: false,
      error: "provider failed",
    });
    await expect(loadSummaryMessages()).resolves.toEqual([]);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: true,
    });

    mockStreamText.mockReturnValueOnce({
      textStream: textStream(["Retried summary"]),
    });
    await expect(
      performCompaction(
        { sender: {} } as never,
        chatId,
        "/tmp/test-app",
        "third-request",
      ),
    ).resolves.toMatchObject({
      success: true,
      summary: "Retried summary",
    });
    await expect(loadSummaryMessages()).resolves.toHaveLength(1);
    await expect(loadChat()).resolves.toMatchObject({
      pendingCompaction: false,
    });
    expect(mockSafeSend).toHaveBeenCalledTimes(1);
  });
});
