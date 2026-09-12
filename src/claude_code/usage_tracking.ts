/**
 * Usage accounting for subscription-backed (Claude Code) turns.
 *
 * Flow:
 * 1. A turn starts with a pre-minted, stable `usageEventId`.
 * 2. When the CLI reports usage (also on cancelled/failed turns), the usage is
 *    normalized into a `ClaudeCodeUsageEvent`, priced locally for display, and
 *    written to the `claude_code_usage_reports` outbox as `pending`.
 * 3. `flushPendingClaudeCodeUsageReports` POSTs pending events to the Dyad
 *    Engine `track-usage` endpoint. The engine calculates and debits the
 *    authoritative charge from the token counts; the client's estimate is
 *    informational only. Retries reuse the same event id, so a lost response
 *    can never double-charge.
 *
 * Engine contract: see docs/claude-code-integration.md.
 */
import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import log from "electron-log";
import { z } from "zod";
import { db } from "@/db";
import { claudeCodeUsageReports } from "@/db/schema";
import { getDyadEngineBaseUrl } from "@/ipc/utils/dyad_engine_url";
import { readSettings } from "@/main/settings";
import { hasDyadProKey } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  calculateClaudeCodeTurnCharge,
  canonicalizeClaudeModelId,
  CLAUDE_CODE_DYAD_CHARGE_RATIO,
  CLAUDE_CODE_PRICING_CATALOG_VERSION,
  CLAUDE_CODE_PRICING_RULE_SUMMARY,
  CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
  type ClaudeCodeModelUsage,
} from "@/shared/claude_code_pricing";
import type { ChatBackendTurnUsage } from "@/chat_backend/backend";
import type { ClaudeResultUsageSource } from "./usage_normalization";
import { normalizeCliResultUsage } from "./usage_normalization";
import type { ClaudeCodeUsageSummary } from "@/ipc/types/claude_code";

const logger = log.scope("claude_code_usage_tracking");

export const CLAUDE_CODE_USAGE_EVENT_SCHEMA_VERSION = 1;
export const TRACK_USAGE_PATH = "/track-usage";

const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;
const BASE_RETRY_DELAY_MS = 30 * 1_000;

export type ClaudeCodeUsageTurnStatus = "completed" | "cancelled" | "error";

export interface ClaudeCodeUsageEventModel extends ClaudeCodeModelUsage {
  /** `primary` for the selected model; `auxiliary` for helper/subagent calls. */
  role: "primary" | "auxiliary";
}

/**
 * Exact payload sent to `POST {engine}/track-usage`. Token counts are the
 * billing input; `clientEstimate` mirrors the pricing rule so the engine can
 * detect catalog drift, but the engine never trusts a client-supplied amount.
 */
export interface ClaudeCodeUsageEvent {
  schemaVersion: typeof CLAUDE_CODE_USAGE_EVENT_SCHEMA_VERSION;
  /** Stable, idempotent id (UUID minted when the turn started). */
  eventId: string;
  backend: "claude-code";
  source: {
    client: "dyad";
    clientVersion: string;
    cliVersion: string | null;
  };
  correlation: {
    chatId: number;
    messageId: number;
    appId: number;
    sessionId: string | null;
    turnStatus: ClaudeCodeUsageTurnStatus;
    startedAt: string;
    completedAt: string;
  };
  requestedModel: string;
  /** Model id the CLI reported for the primary response, or null. */
  resolvedModel: string | null;
  /** Per-model token counts; each model counted once, no aggregate row. */
  models: ClaudeCodeUsageEventModel[];
  totals: { billableTokens: number };
  pricing: {
    catalogVersion: string;
    dyadChargeRatio: number;
    unknownModelUsdPerMillionTokens: number;
    clientEstimate: {
      listPriceUsd: number;
      dyadChargeUsd: number;
      perModel: Array<{
        model: string;
        basis: "catalog" | "unknown-model-flat-rate";
        listPriceUsd: number;
        dyadChargeUsd: number;
      }>;
    };
  };
  /** Cost figure the CLI itself printed (list-price basis), for auditing. */
  backendReportedCostUsd: number | null;
}

const TrackUsageResponseSchema = z
  .object({
    accepted: z.boolean().optional(),
    duplicate: z.boolean().optional(),
    chargedUsd: z.number().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export interface BuildUsageEventParams {
  eventId: string;
  chatId: number;
  messageId: number;
  appId: number;
  sessionId: string | null;
  turnStatus: ClaudeCodeUsageTurnStatus;
  startedAt: Date;
  completedAt: Date;
  requestedModel: string;
  resolvedModel: string | null;
  usage: ChatBackendTurnUsage;
  clientVersion: string;
  cliVersion: string | null;
}

export function buildClaudeCodeUsageEvent(
  params: BuildUsageEventParams,
): ClaudeCodeUsageEvent {
  const primaryCanonical = params.resolvedModel
    ? canonicalizeClaudeModelId(params.resolvedModel)
    : null;
  const models: ClaudeCodeUsageEventModel[] = params.usage.perModel.map(
    (usage) => ({
      ...usage,
      role:
        primaryCanonical !== null && usage.canonicalModel === primaryCanonical
          ? "primary"
          : "auxiliary",
    }),
  );
  const charge = calculateClaudeCodeTurnCharge(models);
  return {
    schemaVersion: CLAUDE_CODE_USAGE_EVENT_SCHEMA_VERSION,
    eventId: params.eventId,
    backend: "claude-code",
    source: {
      client: "dyad",
      clientVersion: params.clientVersion,
      cliVersion: params.cliVersion,
    },
    correlation: {
      chatId: params.chatId,
      messageId: params.messageId,
      appId: params.appId,
      sessionId: params.sessionId,
      turnStatus: params.turnStatus,
      startedAt: params.startedAt.toISOString(),
      completedAt: params.completedAt.toISOString(),
    },
    requestedModel: params.requestedModel,
    resolvedModel: params.resolvedModel,
    models,
    totals: { billableTokens: charge.billableTokens },
    pricing: {
      catalogVersion: CLAUDE_CODE_PRICING_CATALOG_VERSION,
      dyadChargeRatio: CLAUDE_CODE_DYAD_CHARGE_RATIO,
      unknownModelUsdPerMillionTokens:
        CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
      clientEstimate: {
        listPriceUsd: charge.listPriceUsd,
        dyadChargeUsd: charge.dyadChargeUsd,
        perModel: charge.perModel.map((entry) => ({
          model: entry.model,
          basis: entry.basis.kind,
          listPriceUsd: entry.listPriceUsd,
          dyadChargeUsd: entry.dyadChargeUsd,
        })),
      },
    },
    backendReportedCostUsd: params.usage.backendReportedCostUsd,
  };
}

export { normalizeCliResultUsage };
export type { ClaudeResultUsageSource };

/**
 * Persist a usage event into the outbox. Idempotent on `eventId`: a replayed
 * turn cannot create a second pending report.
 */
export async function recordClaudeCodeUsageEvent(
  event: ClaudeCodeUsageEvent,
): Promise<void> {
  await db
    .insert(claudeCodeUsageReports)
    .values({
      id: event.eventId,
      chatId: event.correlation.chatId,
      messageId: event.correlation.messageId,
      appId: event.correlation.appId,
      payloadJson: JSON.stringify(event),
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(0),
    })
    .onConflictDoNothing();
}

/**
 * Record a turn whose usage the CLI never reported (crash, spawn failure,
 * kill before the result event). Nothing can be billed from it, so it is
 * stored as `rejected` with an explicit reason instead of a zero-token event
 * that would look like free usage.
 */
export async function recordMissingClaudeCodeUsage(params: {
  eventId: string;
  chatId: number;
  messageId: number;
  appId: number;
  reason: string;
}): Promise<void> {
  await db
    .insert(claudeCodeUsageReports)
    .values({
      id: params.eventId,
      chatId: params.chatId,
      messageId: params.messageId,
      appId: params.appId,
      payloadJson: JSON.stringify({
        schemaVersion: CLAUDE_CODE_USAGE_EVENT_SCHEMA_VERSION,
        eventId: params.eventId,
        backend: "claude-code",
        usageMissing: true,
        correlation: {
          chatId: params.chatId,
          messageId: params.messageId,
          appId: params.appId,
        },
      }),
      status: "rejected",
      attempts: 0,
      lastError: params.reason,
    })
    .onConflictDoNothing();
}

export type ClaudeCodeUsageReportOutcome =
  | { kind: "reported"; chargedUsd: number | null }
  | { kind: "retry"; error: string }
  | { kind: "rejected"; error: string };

export interface TrackUsageTransportOptions {
  fetchImpl?: typeof fetch;
  engineBaseUrl?: string;
  apiKey?: string | null;
  timeoutMs?: number;
}

/**
 * Report one event to the engine. Classifies the outcome so the caller can
 * decide whether to retry: network/5xx → retry, duplicate → reported,
 * 402 → rejected (insufficient balance, user must act), other 4xx → rejected.
 */
export async function reportClaudeCodeUsageEvent(
  event: ClaudeCodeUsageEvent,
  options: TrackUsageTransportOptions = {},
): Promise<ClaudeCodeUsageReportOutcome> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiKey =
    options.apiKey === undefined
      ? readSettings().providerSettings?.auto?.apiKey?.value
      : options.apiKey;
  if (!apiKey) {
    return {
      kind: "retry",
      error:
        "Dyad Pro key is not configured; usage will be reported once it is.",
    };
  }
  const baseUrl = (options.engineBaseUrl ?? getDyadEngineBaseUrl()).replace(
    /\/$/,
    "",
  );
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${TRACK_USAGE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": event.eventId,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    return {
      kind: "retry",
      error: `Engine unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  const summarize = () => bodyText.replace(/\s+/g, " ").slice(0, 300);

  if (response.ok) {
    let chargedUsd: number | null = null;
    if (bodyText) {
      try {
        const parsed = TrackUsageResponseSchema.parse(JSON.parse(bodyText));
        chargedUsd = parsed.chargedUsd ?? null;
      } catch {
        chargedUsd = null;
      }
    }
    return { kind: "reported", chargedUsd };
  }
  if (response.status === 409) {
    // Already recorded by the engine (idempotent replay).
    return { kind: "reported", chargedUsd: null };
  }
  if (response.status === 402) {
    return {
      kind: "rejected",
      error: `Insufficient Dyad balance for the subscription usage charge (${summarize() || "402"}).`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      kind: "retry",
      error: `Engine rejected the Dyad Pro key (${response.status}). Check your Pro sign-in.`,
    };
  }
  if (response.status === 404 || response.status === 501) {
    return {
      kind: "retry",
      error: `Engine track-usage endpoint unavailable (${response.status}).`,
    };
  }
  if (response.status >= 500 || response.status === 429) {
    return {
      kind: "retry",
      error: `Engine error ${response.status}: ${summarize()}`,
    };
  }
  return {
    kind: "rejected",
    error: `Engine rejected the usage report (${response.status}): ${summarize()}`,
  };
}

function retryDelayMs(attempts: number): number {
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1),
  );
}

export interface FlushResult {
  attempted: number;
  reported: number;
  pending: number;
  rejected: number;
}

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * Send every due pending report. Serialized so overlapping triggers (turn
 * end, startup, manual retry) cannot report the same row twice concurrently.
 */
export async function flushPendingClaudeCodeUsageReports(
  options: TrackUsageTransportOptions & { force?: boolean; now?: Date } = {},
): Promise<FlushResult> {
  if (flushInFlight) {
    return flushInFlight;
  }
  // Register the in-flight promise before the body can settle: a flush with
  // nothing due completes synchronously, and assigning afterwards would leave
  // a stale resolved promise that short-circuits every later flush.
  const run = flushOnce(options);
  flushInFlight = run;
  try {
    return await run;
  } finally {
    if (flushInFlight === run) {
      flushInFlight = null;
    }
  }
}

async function flushOnce(
  options: TrackUsageTransportOptions & { force?: boolean; now?: Date },
): Promise<FlushResult> {
  const now = options.now ?? new Date();
  const result: FlushResult = {
    attempted: 0,
    reported: 0,
    pending: 0,
    rejected: 0,
  };
  {
    {
      const due = db
        .select()
        .from(claudeCodeUsageReports)
        .where(
          options.force
            ? eq(claudeCodeUsageReports.status, "pending")
            : and(
                eq(claudeCodeUsageReports.status, "pending"),
                or(
                  isNull(claudeCodeUsageReports.nextAttemptAt),
                  lte(claudeCodeUsageReports.nextAttemptAt, now),
                ),
              ),
        )
        .orderBy(claudeCodeUsageReports.createdAt)
        .all();
      for (const row of due) {
        let event: ClaudeCodeUsageEvent;
        try {
          event = JSON.parse(row.payloadJson) as ClaudeCodeUsageEvent;
        } catch (error) {
          await db
            .update(claudeCodeUsageReports)
            .set({
              status: "rejected",
              lastError: `Corrupt payload: ${error instanceof Error ? error.message : String(error)}`,
            })
            .where(eq(claudeCodeUsageReports.id, row.id));
          result.rejected += 1;
          continue;
        }
        result.attempted += 1;
        const outcome = await reportClaudeCodeUsageEvent(event, options);
        const attempts = row.attempts + 1;
        if (outcome.kind === "reported") {
          await db
            .update(claudeCodeUsageReports)
            .set({
              status: "reported",
              attempts,
              lastError: null,
              reportedAt: now,
              chargedUsd:
                outcome.chargedUsd === null ? null : String(outcome.chargedUsd),
            })
            .where(eq(claudeCodeUsageReports.id, row.id));
          result.reported += 1;
        } else if (outcome.kind === "rejected") {
          await db
            .update(claudeCodeUsageReports)
            .set({ status: "rejected", attempts, lastError: outcome.error })
            .where(eq(claudeCodeUsageReports.id, row.id));
          result.rejected += 1;
          logger.warn(`Usage report ${row.id} rejected: ${outcome.error}`);
        } else {
          await db
            .update(claudeCodeUsageReports)
            .set({
              attempts,
              lastError: outcome.error,
              nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
            })
            .where(eq(claudeCodeUsageReports.id, row.id));
          result.pending += 1;
          logger.info(
            `Usage report ${row.id} deferred (attempt ${attempts}): ${outcome.error}`,
          );
        }
      }
    }
  }
  return result;
}

let retryTimer: NodeJS.Timeout | null = null;

/** Periodic best-effort retry loop started after the database is ready. */
export function startClaudeCodeUsageReportRetries(
  intervalMs = 5 * 60_000,
): void {
  if (retryTimer) return;
  const tick = () => {
    void flushPendingClaudeCodeUsageReports().catch((error) =>
      logger.error("Failed to flush Claude Code usage reports", error),
    );
  };
  tick();
  retryTimer = setInterval(tick, intervalMs);
  retryTimer.unref?.();
}

export function stopClaudeCodeUsageReportRetries(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

/**
 * Billing precondition for starting a subscription-backed turn. Throws a
 * classified DyadError so the renderer can show the exact blocker instead of
 * silently switching payment sources.
 */
export function assertClaudeCodeBillingReady(): void {
  const settings = readSettings();
  if (!hasDyadProKey(settings)) {
    throw new DyadError(
      "Claude Code subscription usage carries a separate Dyad charge, which requires a Dyad Pro account. Sign in to Dyad Pro in Settings before using the Subscription backend.",
      DyadErrorKind.Precondition,
    );
  }
  const latestRejected = db
    .select({
      id: claudeCodeUsageReports.id,
      lastError: claudeCodeUsageReports.lastError,
    })
    .from(claudeCodeUsageReports)
    .where(eq(claudeCodeUsageReports.status, "rejected"))
    .orderBy(desc(claudeCodeUsageReports.createdAt))
    .limit(1)
    .get();
  if (latestRejected?.lastError?.startsWith("Insufficient Dyad balance")) {
    throw new DyadError(
      `${latestRejected.lastError} Add credits, then retry pending usage reports from Settings.`,
      DyadErrorKind.Precondition,
    );
  }
}

export async function getClaudeCodeUsageSummary({
  limit = 50,
}: { limit?: number } = {}): Promise<ClaudeCodeUsageSummary> {
  const rows = db
    .select()
    .from(claudeCodeUsageReports)
    .orderBy(desc(claudeCodeUsageReports.createdAt))
    .limit(limit)
    .all();
  const counts = db
    .select({
      id: claudeCodeUsageReports.id,
      status: claudeCodeUsageReports.status,
      payloadJson: claudeCodeUsageReports.payloadJson,
      chargedUsd: claudeCodeUsageReports.chargedUsd,
    })
    .from(claudeCodeUsageReports)
    .where(
      inArray(claudeCodeUsageReports.status, [
        "pending",
        "reported",
        "rejected",
      ]),
    )
    .all();

  const totals = {
    pendingCount: 0,
    reportedCount: 0,
    rejectedCount: 0,
    billableTokens: 0,
    listPriceUsd: 0,
    estimatedDyadChargeUsd: 0,
    confirmedDyadChargeUsd: 0,
  };
  for (const row of counts) {
    if (row.status === "pending") totals.pendingCount += 1;
    if (row.status === "reported") totals.reportedCount += 1;
    if (row.status === "rejected") totals.rejectedCount += 1;
    const parsed = safeParseEvent(row.payloadJson);
    if (parsed) {
      totals.billableTokens += parsed.totals.billableTokens;
      totals.listPriceUsd += parsed.pricing.clientEstimate.listPriceUsd;
      totals.estimatedDyadChargeUsd +=
        parsed.pricing.clientEstimate.dyadChargeUsd;
    }
    if (row.chargedUsd !== null) {
      const charged = Number(row.chargedUsd);
      if (Number.isFinite(charged)) totals.confirmedDyadChargeUsd += charged;
    }
  }

  return {
    pricingRule: CLAUDE_CODE_PRICING_RULE_SUMMARY,
    catalogVersion: CLAUDE_CODE_PRICING_CATALOG_VERSION,
    dyadChargeRatio: CLAUDE_CODE_DYAD_CHARGE_RATIO,
    unknownModelUsdPerMillionTokens:
      CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
    events: rows.map((row) => {
      const parsed = safeParseEvent(row.payloadJson);
      const charge = parsed
        ? calculateClaudeCodeTurnCharge(parsed.models)
        : null;
      const chargedUsd =
        row.chargedUsd === null ? null : Number(row.chargedUsd);
      return {
        id: row.id,
        chatId: row.chatId,
        messageId: row.messageId,
        appId: row.appId,
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        reportedAt: row.reportedAt ? row.reportedAt.toISOString() : null,
        turnStatus: parsed?.correlation.turnStatus ?? "usage-missing",
        models:
          parsed && charge
            ? parsed.models.map((model, index) => ({
                model: model.model,
                canonicalModel: model.canonicalModel,
                inputTokens: model.inputTokens,
                cacheReadTokens: model.cacheReadTokens,
                cacheWriteTokens: model.cacheWriteTokens,
                outputTokens: model.outputTokens,
                pricingBasis: charge.perModel[index].basis.kind,
                listPriceUsd: charge.perModel[index].listPriceUsd,
                estimatedDyadChargeUsd: charge.perModel[index].dyadChargeUsd,
              }))
            : [],
        billableTokens: charge?.billableTokens ?? 0,
        listPriceUsd: charge?.listPriceUsd ?? 0,
        estimatedDyadChargeUsd: charge?.dyadChargeUsd ?? 0,
        chargedUsd:
          chargedUsd !== null && Number.isFinite(chargedUsd)
            ? chargedUsd
            : null,
      };
    }),
    totals: {
      ...totals,
      listPriceUsd: Math.round(totals.listPriceUsd * 1_000_000) / 1_000_000,
      estimatedDyadChargeUsd:
        Math.round(totals.estimatedDyadChargeUsd * 1_000_000) / 1_000_000,
      confirmedDyadChargeUsd:
        Math.round(totals.confirmedDyadChargeUsd * 1_000_000) / 1_000_000,
    },
  };
}

function safeParseEvent(payloadJson: string): ClaudeCodeUsageEvent | null {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<ClaudeCodeUsageEvent> & {
      usageMissing?: boolean;
    };
    if (parsed.usageMissing || !Array.isArray(parsed.models)) {
      return null;
    }
    return parsed as ClaudeCodeUsageEvent;
  } catch {
    return null;
  }
}
