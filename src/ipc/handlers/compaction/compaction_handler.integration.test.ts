import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { setDatabaseForTesting } from "@/db";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

const {
  mockSafeSend,
  mockStorePreCompactionMessages,
  mockStreamSimple,
  mockResolveDyadModel,
  mockBuildStreamOptions,
  settingsState,
} = vi.hoisted(() => ({
  mockSafeSend: vi.fn(),
  mockStorePreCompactionMessages: vi.fn(
    async () => ".dyad/chats/1/compaction-test.md",
  ),
  mockStreamSimple: vi.fn(),
  mockResolveDyadModel: vi.fn(async () => ({})),
  mockBuildStreamOptions: vi.fn(async () => ({})),
  settingsState: {
    current: {
      selectedModel: { provider: "anthropic", name: "test-model" },
    } as Record<string, unknown>,
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => settingsState.current,
}));

vi.mock("@/ipc/pi/model_runtime", () => ({
  getPiModels: () => ({ streamSimple: mockStreamSimple }),
  resolveDyadModel: mockResolveDyadModel,
}));

vi.mock("@/ipc/pi/stream_fn", () => ({
  buildStreamOptions: mockBuildStreamOptions,
}));

vi.mock("@/ipc/utils/provider_options", () => ({
  DYAD_INTERNAL_REQUEST_ID_HEADER: "x-dyad-request-id",
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: mockSafeSend,
}));

vi.mock("./compaction_storage", () => ({
  formatAsTranscript: () => "test transcript",
  storePreCompactionMessages: mockStorePreCompactionMessages,
}));

import { performCompaction } from "./compaction_handler";

function textEvents(chunks: string[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { type: "text_delta", delta };
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

    mockStreamSimple.mockReset();
    mockSafeSend.mockClear();
    mockStorePreCompactionMessages.mockClear();
    mockResolveDyadModel.mockClear();
    mockBuildStreamOptions.mockClear();
    settingsState.current = {
      selectedModel: { provider: "anthropic", name: "test-model" },
    };
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
    mockStreamSimple.mockReturnValue(textEvents(["partial", "ignored"]));

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
    expect(mockStreamSimple).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
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
    expect(mockStreamSimple).not.toHaveBeenCalled();
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
    mockStreamSimple.mockReturnValue(textEvents(["Complete summary"]));

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

  it("summarizes with the user's selected model for non-Pro users", async () => {
    mockStreamSimple.mockReturnValue(textEvents(["Complete summary"]));

    const result = await performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "request-id",
    );

    expect(result).toMatchObject({ success: true });
    expect(mockResolveDyadModel).toHaveBeenCalledWith({
      provider: "anthropic",
      name: "test-model",
    });
    expect(mockBuildStreamOptions).toHaveBeenCalledWith(
      { provider: "anthropic", name: "test-model" },
      settingsState.current,
    );
  });

  it("pins the benchmarked compaction model for Dyad Pro users", async () => {
    settingsState.current = {
      selectedModel: { provider: "anthropic", name: "test-model" },
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "dyad-pro-key" } } },
    };
    mockStreamSimple.mockReturnValue(textEvents(["Complete summary"]));

    const result = await performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "request-id",
    );

    expect(result).toMatchObject({ success: true });
    expect(mockResolveDyadModel).toHaveBeenCalledWith({
      provider: "openai",
      name: "gpt-5.6-luna",
    });
    expect(mockBuildStreamOptions).toHaveBeenCalledWith(
      { provider: "openai", name: "gpt-5.6-luna" },
      settingsState.current,
    );
  });

  it("single-flights concurrent compaction attempts for one chat", async () => {
    let releaseSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    mockStreamSimple.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        await summaryGate;
        yield { type: "text_delta", delta: "Only summary" };
      },
    });

    const winner = performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "winner-request",
    );
    await vi.waitFor(() => expect(mockStreamSimple).toHaveBeenCalledOnce());

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
    mockStreamSimple.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "partial" };
        await abortedSummaryGate;
        yield { type: "text_delta", delta: "ignored" };
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

    mockStreamSimple.mockReturnValueOnce(textEvents(["Retried summary"]));
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
    mockStreamSimple.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        await summaryFailureGate;
        yield await Promise.reject(new Error("provider failed"));
      },
    });

    const winner = performCompaction(
      { sender: {} } as never,
      chatId,
      "/tmp/test-app",
      "winner-request",
    );
    await vi.waitFor(() => expect(mockStreamSimple).toHaveBeenCalledOnce());

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

    mockStreamSimple.mockReturnValueOnce(textEvents(["Retried summary"]));
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
