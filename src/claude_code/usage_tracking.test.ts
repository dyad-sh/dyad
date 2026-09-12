import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const settingsMock = vi.hoisted(() => ({
  settings: {
    providerSettings: { auto: { apiKey: { value: "dyad-pro-key" } } },
  } as Record<string, unknown>,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => settingsMock.settings,
}));
vi.mock("@/ipc/utils/dyad_engine_url", () => ({
  getDyadEngineBaseUrl: () => "https://engine.test/v1",
}));

import { setDatabaseForTesting } from "@/db";
import { claudeCodeUsageReports } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import {
  assertClaudeCodeBillingReady,
  buildClaudeCodeUsageEvent,
  flushPendingClaudeCodeUsageReports,
  getClaudeCodeUsageSummary,
  recordClaudeCodeUsageEvent,
  recordMissingClaudeCodeUsage,
  reportClaudeCodeUsageEvent,
  type ClaudeCodeUsageEvent,
} from "./usage_tracking";

function event(id = "evt-1", overrides: Partial<ClaudeCodeUsageEvent> = {}) {
  const built = buildClaudeCodeUsageEvent({
    eventId: id,
    chatId: 1,
    messageId: 2,
    appId: 3,
    sessionId: "sess",
    turnStatus: "completed",
    startedAt: new Date("2026-09-04T00:00:00Z"),
    completedAt: new Date("2026-09-04T00:00:10Z"),
    requestedModel: "sonnet",
    resolvedModel: "claude-sonnet-5",
    clientVersion: "1.13.0",
    cliVersion: "2.1.260",
    usage: {
      perModel: [
        {
          model: "claude-sonnet-5",
          canonicalModel: "claude-sonnet-5",
          inputTokens: 4,
          cacheReadTokens: 12371,
          cacheWriteTokens: 13087,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 13087,
          outputTokens: 671,
        },
        {
          model: "claude-haiku-4-5-20251001",
          canonicalModel: "claude-haiku-4-5",
          inputTokens: 907,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 12,
        },
      ],
      backendReportedCostUsd: 0.0625072,
    },
  });
  return { ...built, ...overrides };
}

function fakeFetch(
  responder: (
    url: string,
    init: RequestInit,
  ) => { status: number; body?: unknown } | Error,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const outcome = responder(url, init);
    if (outcome instanceof Error) throw outcome;
    return new Response(
      outcome.body === undefined ? "" : JSON.stringify(outcome.body),
      {
        status: outcome.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("usage_tracking", () => {
  let database: TestDb;

  beforeEach(() => {
    database = createInMemoryTestDb();
    setDatabaseForTesting(database);
    settingsMock.settings = {
      providerSettings: { auto: { apiKey: { value: "dyad-pro-key" } } },
    };
  });

  afterEach(() => {
    setDatabaseForTesting(null);
    database.$client.close();
  });

  it("builds an engine payload with per-model roles and a client estimate", () => {
    const payload = event();
    expect(payload).toMatchObject({
      schemaVersion: 1,
      eventId: "evt-1",
      backend: "claude-code",
      correlation: {
        chatId: 1,
        messageId: 2,
        appId: 3,
        turnStatus: "completed",
      },
      resolvedModel: "claude-sonnet-5",
      totals: { billableTokens: 4 + 12371 + 13087 + 671 + 907 + 12 },
    });
    expect(payload.models.map((m) => [m.model, m.role])).toEqual([
      ["claude-sonnet-5", "primary"],
      ["claude-haiku-4-5-20251001", "auxiliary"],
    ]);
    // sonnet: 4*2 + 12371*0.2 + 13087*4 + 671*10 per million; haiku: 907*1 + 12*5
    const expectedList =
      (4 * 2 + 12371 * 0.2 + 13087 * 4 + 671 * 10 + 907 * 1 + 12 * 5) /
      1_000_000;
    expect(payload.pricing.clientEstimate.listPriceUsd).toBeCloseTo(
      expectedList,
      6,
    );
    expect(payload.pricing.clientEstimate.dyadChargeUsd).toBeCloseTo(
      expectedList * 0.25,
      6,
    );
    expect(payload.pricing.dyadChargeRatio).toBe(0.25);
  });

  it("stores each event once and reports it idempotently", async () => {
    await recordClaudeCodeUsageEvent(event());
    await recordClaudeCodeUsageEvent(event());
    expect(database.select().from(claudeCodeUsageReports).all()).toHaveLength(
      1,
    );

    const { impl, calls } = fakeFetch(() => ({
      status: 200,
      body: { accepted: true, chargedUsd: 0.0158 },
    }));
    const first = await flushPendingClaudeCodeUsageReports({ fetchImpl: impl });
    expect(first).toEqual({
      attempted: 1,
      reported: 1,
      pending: 0,
      rejected: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://engine.test/v1/track-usage");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer dyad-pro-key");
    expect(headers["Idempotency-Key"]).toBe("evt-1");
    expect(JSON.parse(String(calls[0].init.body)).eventId).toBe("evt-1");

    const row = database
      .select()
      .from(claudeCodeUsageReports)
      .where(eq(claudeCodeUsageReports.id, "evt-1"))
      .get()!;
    expect(row.status).toBe("reported");
    expect(row.chargedUsd).toBe("0.0158");

    // A second flush never re-sends an acknowledged event.
    const second = await flushPendingClaudeCodeUsageReports({
      fetchImpl: impl,
    });
    expect(second.attempted).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("treats an engine duplicate as reported", async () => {
    const outcome = await reportClaudeCodeUsageEvent(event(), {
      fetchImpl: fakeFetch(() => ({ status: 409, body: { duplicate: true } }))
        .impl,
    });
    expect(outcome).toEqual({ kind: "reported", chargedUsd: null });
  });

  it("keeps retrying with backoff on engine or network failures", async () => {
    await recordClaudeCodeUsageEvent(event("evt-retry"));
    const now = new Date("2026-09-04T12:00:00Z");
    const failing = fakeFetch(() => ({
      status: 503,
      body: { message: "down" },
    }));
    const result = await flushPendingClaudeCodeUsageReports({
      fetchImpl: failing.impl,
      now,
    });
    expect(result).toEqual({
      attempted: 1,
      reported: 0,
      pending: 1,
      rejected: 0,
    });
    const row = database
      .select()
      .from(claudeCodeUsageReports)
      .where(eq(claudeCodeUsageReports.id, "evt-retry"))
      .get()!;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("503");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

    // Not due yet: skipped without a request.
    const skipped = await flushPendingClaudeCodeUsageReports({
      fetchImpl: failing.impl,
      now,
    });
    expect(skipped.attempted).toBe(0);

    // Network errors are retried too, and force ignores the backoff.
    const offline = fakeFetch(() => new Error("ECONNREFUSED"));
    const forced = await flushPendingClaudeCodeUsageReports({
      fetchImpl: offline.impl,
      now,
      force: true,
    });
    expect(forced.pending).toBe(1);
    expect(offline.calls).toHaveLength(1);
  });

  it("defers reporting until a Dyad Pro key exists", async () => {
    settingsMock.settings = { providerSettings: {} };
    const outcome = await reportClaudeCodeUsageEvent(event(), {
      fetchImpl: fakeFetch(() => ({ status: 200 })).impl,
    });
    expect(outcome).toMatchObject({
      kind: "retry",
      error: expect.stringContaining("Pro key"),
    });
    expect(() => assertClaudeCodeBillingReady()).toThrow(/Dyad Pro/);
  });

  it("marks insufficient balance as rejected and blocks further turns", async () => {
    await recordClaudeCodeUsageEvent(event("evt-402"));
    const result = await flushPendingClaudeCodeUsageReports({
      fetchImpl: fakeFetch(() => ({
        status: 402,
        body: { message: "no credits" },
      })).impl,
    });
    expect(result.rejected).toBe(1);
    expect(() => assertClaudeCodeBillingReady()).toThrow(
      /Insufficient Dyad balance/,
    );
  });

  it("rejects malformed payloads without retrying forever", async () => {
    const outcome = await reportClaudeCodeUsageEvent(event(), {
      fetchImpl: fakeFetch(() => ({
        status: 422,
        body: { message: "bad schema" },
      })).impl,
    });
    expect(outcome).toMatchObject({
      kind: "rejected",
      error: expect.stringContaining("422"),
    });
  });

  it("records missing usage explicitly instead of a zero-cost event", async () => {
    await recordMissingClaudeCodeUsage({
      eventId: "evt-missing",
      chatId: 1,
      messageId: 2,
      appId: 3,
      reason: "CLI crashed before reporting usage",
    });
    const summary = await getClaudeCodeUsageSummary();
    const entry = summary.events.find((e) => e.id === "evt-missing")!;
    expect(entry.status).toBe("rejected");
    expect(entry.lastError).toContain("crashed");
    expect(entry.turnStatus).toBe("usage-missing");
    expect(entry.billableTokens).toBe(0);
    // Never reported to the engine.
    const flush = await flushPendingClaudeCodeUsageReports({
      fetchImpl: fakeFetch(() => ({ status: 200 })).impl,
    });
    expect(flush.attempted).toBe(0);
  });

  it("summarizes totals across statuses and applies both pricing rules", async () => {
    await recordClaudeCodeUsageEvent(event("evt-known"));
    await recordClaudeCodeUsageEvent(
      event("evt-unknown", {
        resolvedModel: "claude-mystery-9",
        models: [
          {
            model: "claude-mystery-9",
            canonicalModel: "claude-mystery-9",
            inputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            role: "primary",
          },
        ],
      }),
    );
    await flushPendingClaudeCodeUsageReports({
      fetchImpl: fakeFetch(() => ({ status: 200, body: { chargedUsd: 0.01 } }))
        .impl,
    });
    const summary = await getClaudeCodeUsageSummary();
    expect(summary.totals.reportedCount).toBe(2);
    expect(summary.totals.confirmedDyadChargeUsd).toBeCloseTo(0.02, 6);
    const unknown = summary.events.find((e) => e.id === "evt-unknown")!;
    expect(unknown.models[0].pricingBasis).toBe("unknown-model-flat-rate");
    expect(unknown.estimatedDyadChargeUsd).toBeCloseTo(0.1, 6);
    const known = summary.events.find((e) => e.id === "evt-known")!;
    expect(known.models.map((m) => m.pricingBasis)).toEqual([
      "catalog",
      "catalog",
    ]);
    expect(summary.pricingRule).toContain("25%");
  });
});
