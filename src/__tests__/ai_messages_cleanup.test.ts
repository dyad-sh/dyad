import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { update, set, where };
});

const schemaMocks = vi.hoisted(() => {
  return {
    messages: {
      createdAt: "messages.createdAt",
    },
  };
});

const logMocks = vi.hoisted(() => {
  return {
    log: vi.fn(),
    warn: vi.fn(),
  };
});

const drizzleMocks = vi.hoisted(() => {
  return {
    lt: vi.fn<(a: unknown, b: unknown) => string>(() => "LT_EXPR"),
  };
});

vi.mock("@/db", () => ({
  db: {
    update: dbMocks.update,
  },
}));

vi.mock("@/db/schema", () => ({
  messages: schemaMocks.messages,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => logMocks),
  },
}));

vi.mock("drizzle-orm", () => ({
  lt: drizzleMocks.lt,
}));

import {
  AI_MESSAGES_TTL_DAYS,
  cleanupOldAiMessagesJson,
} from "@/pro/main/ipc/handlers/local_agent/ai_messages_cleanup";

describe("cleanupOldAiMessagesJson", () => {
  beforeEach(() => {
    dbMocks.update.mockClear();
    dbMocks.set.mockClear();
    dbMocks.where.mockClear();
    drizzleMocks.lt.mockClear();
    logMocks.log.mockClear();
    logMocks.warn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use the expected TTL constant", () => {
    expect(AI_MESSAGES_TTL_DAYS).toBe(30);
  });

  it("should clear aiMessagesJson for messages older than the cutoff date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    dbMocks.where.mockResolvedValueOnce(undefined);

    await cleanupOldAiMessagesJson();

    // db.update(messages).set({ aiMessagesJson: null }).where(...)
    expect(dbMocks.update).toHaveBeenCalledTimes(1);
    expect(dbMocks.update).toHaveBeenCalledWith(schemaMocks.messages);
    expect(dbMocks.set).toHaveBeenCalledWith({ aiMessagesJson: null });
    expect(dbMocks.where).toHaveBeenCalledTimes(1);

    // lt(messages.createdAt, cutoffDate)
    expect(drizzleMocks.lt).toHaveBeenCalledTimes(1);
    const [createdAtArg, cutoffDateArg] = drizzleMocks.lt.mock.calls[0];
    expect(createdAtArg).toBe(schemaMocks.messages.createdAt);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expectedCutoffSeconds =
      nowSeconds - AI_MESSAGES_TTL_DAYS * 24 * 60 * 60;
    const expectedCutoffDate = new Date(expectedCutoffSeconds * 1000);
    expect(cutoffDateArg).toEqual(expectedCutoffDate);

    expect(logMocks.log).toHaveBeenCalledWith(
      "Cleaned up old ai_messages_json entries",
    );
    expect(logMocks.warn).not.toHaveBeenCalled();
  });

  it("should not throw if the cleanup fails (logs a warning)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const err = new Error("boom");
    dbMocks.where.mockRejectedValueOnce(err);

    await expect(cleanupOldAiMessagesJson()).resolves.toBeUndefined();

    expect(logMocks.warn).toHaveBeenCalledTimes(1);
    expect(logMocks.warn.mock.calls[0][0]).toBe(
      "Failed to cleanup old ai_messages_json:",
    );
    expect(logMocks.warn.mock.calls[0][1]).toBe(err);
  });
});
