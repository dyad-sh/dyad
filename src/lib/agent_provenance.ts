/**
 * Agent Provenance & Reputation Engine — Tier 4
 *
 * Pure TypeScript service module (no Electron / no IPC).
 *
 * Provides:
 *   - Append-only signed activity feed (`emitEvent`)
 *   - Per-DID reputation rollup derived from the feed (`recomputeScore`)
 *   - Slash records with proposed → active → reversed lifecycle
 *
 * Best-effort Celestia pinning is supported via `pinEvent`.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import crypto, { randomUUID } from "node:crypto";
import log from "electron-log";

import { db } from "@/db";
import {
  provenanceEvents,
  reputationScores,
  slashRecords,
  type ProvenanceCurrency,
  type ProvenanceEventRow,
  type ProvenanceKind,
  type ReputationScoreRow,
  type SlashRecordRow,
  type SlashStatus,
} from "@/db/agent_provenance_schema";
import { celestiaBlobService } from "@/lib/celestia_blob_service";

const logger = log.scope("agent_provenance");

// =============================================================================
// HELPERS
// =============================================================================

function uuid(): string {
  return randomUUID();
}

function now(): Date {
  return new Date();
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function bigOf(s: string | null | undefined): bigint {
  if (!s) return 0n;
  return BigInt(s);
}

function canonicalEvent(input: {
  kind: ProvenanceKind;
  principalDid: string;
  subjectRef: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}): string {
  return JSON.stringify({
    type: "provenance.event.v1",
    kind: input.kind,
    principalDid: input.principalDid,
    subjectRef: input.subjectRef,
    payload: input.payload,
    createdAt: input.createdAt,
  });
}

// =============================================================================
// EVENT EMISSION
// =============================================================================

export interface EmitEventInput {
  kind: ProvenanceKind;
  principalDid: string;
  subjectRef?: string | null;
  payload?: Record<string, unknown> | null;
  /** Optional signing material. If provided, the event is signed at write time. */
  issuerDid?: string;
  privateKeyHex?: string;
  algorithm?: "ed25519" | "secp256k1";
}

export async function emitEvent(
  input: EmitEventInput,
): Promise<ProvenanceEventRow> {
  if (!input.kind) throw new Error("emitEvent: kind required");
  if (!input.principalDid)
    throw new Error("emitEvent: principalDid required");

  const id = uuid();
  const ts = now();
  const canonical = canonicalEvent({
    kind: input.kind,
    principalDid: input.principalDid,
    subjectRef: input.subjectRef ?? null,
    payload: input.payload ?? null,
    createdAt: ts.toISOString(),
  });
  const payloadHash = sha256Hex(canonical);

  let signatureHex: string | null = null;
  let algorithm: string | null = null;
  let issuerDid: string | null = input.issuerDid ?? null;

  if (input.privateKeyHex) {
    try {
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(input.privateKeyHex, "hex"),
        format: "der",
        type: "pkcs8",
      });
      const sig = crypto.sign(null, Buffer.from(canonical), privateKey);
      signatureHex = sig.toString("hex");
      algorithm = input.algorithm ?? "ed25519";
    } catch (err) {
      logger.warn("emitEvent: signing failed, storing unsigned", err);
    }
  }

  const [row] = await db
    .insert(provenanceEvents)
    .values({
      id,
      principalDid: input.principalDid,
      kind: input.kind,
      subjectRef: input.subjectRef ?? null,
      payloadJson: input.payload ?? null,
      payloadHash,
      issuerDid,
      signatureHex,
      algorithm,
      createdAt: ts,
    })
    .returning();
  return row;
}

/**
 * Best-effort pin to Celestia. Failures are logged and the local event is
 * still preserved.
 */
export async function pinEvent(eventId: string): Promise<ProvenanceEventRow> {
  const [evt] = await db
    .select()
    .from(provenanceEvents)
    .where(eq(provenanceEvents.id, eventId))
    .limit(1);
  if (!evt) throw new Error(`pinEvent: event not found: ${eventId}`);

  try {
    const result = await celestiaBlobService.submitJSON(
      {
        type: "provenance.event.v1",
        kind: evt.kind,
        principalDid: evt.principalDid,
        subjectRef: evt.subjectRef,
        payload: evt.payloadJson,
        payloadHash: evt.payloadHash,
        signatureHex: evt.signatureHex,
        algorithm: evt.algorithm,
        issuerDid: evt.issuerDid,
        createdAt: evt.createdAt.toISOString(),
      },
      undefined,
    );
    const [updated] = await db
      .update(provenanceEvents)
      .set({
        ipldCid: result.ipldCid ?? null,
        height: result.height ?? null,
        sealedAt: now(),
      })
      .where(eq(provenanceEvents.id, eventId))
      .returning();
    return updated;
  } catch (err) {
    logger.warn("pinEvent: pin failed (event preserved locally)", eventId, err);
    return evt;
  }
}

export interface EventFilters {
  principalDid?: string;
  kind?: ProvenanceKind | ProvenanceKind[];
  subjectRef?: string;
  limit?: number;
}

export async function listEvents(
  filters: EventFilters = {},
): Promise<ProvenanceEventRow[]> {
  const conds = [];
  if (filters.principalDid)
    conds.push(eq(provenanceEvents.principalDid, filters.principalDid));
  if (filters.kind) {
    conds.push(
      Array.isArray(filters.kind)
        ? inArray(provenanceEvents.kind, filters.kind)
        : eq(provenanceEvents.kind, filters.kind),
    );
  }
  if (filters.subjectRef)
    conds.push(eq(provenanceEvents.subjectRef, filters.subjectRef));

  const where = conds.length > 0 ? and(...conds) : undefined;
  const limit = filters.limit ?? 200;
  const q = where
    ? db.select().from(provenanceEvents).where(where)
    : db.select().from(provenanceEvents);
  return await q.orderBy(desc(provenanceEvents.createdAt)).limit(limit);
}

export async function getEvent(id: string): Promise<ProvenanceEventRow | null> {
  const rows = await db
    .select()
    .from(provenanceEvents)
    .where(eq(provenanceEvents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// =============================================================================
// REPUTATION ROLLUP
// =============================================================================

/**
 * Walk all events for a principal and recompute the reputation row.
 * Idempotent — safe to call repeatedly.
 */
export async function recomputeScore(
  principalDid: string,
): Promise<ReputationScoreRow> {
  if (!principalDid) throw new Error("recomputeScore: principalDid required");

  const events = await db
    .select()
    .from(provenanceEvents)
    .where(eq(provenanceEvents.principalDid, principalDid));

  let totalContracts = 0;
  let settledContracts = 0;
  let failedContracts = 0;
  let refundedContracts = 0;
  let totalInvocations = 0;
  let verifiedInvocations = 0;
  let rejectedInvocations = 0;
  let earned = 0n;
  let slashed = 0n;
  const currencyTally = new Map<ProvenanceCurrency, bigint>();
  let lastEventAt: Date | null = null;

  for (const e of events) {
    if (!lastEventAt || e.createdAt > lastEventAt) lastEventAt = e.createdAt;
    const payload = (e.payloadJson ?? {}) as Record<string, unknown>;
    const amountStr =
      typeof payload.amount === "string" ? payload.amount : null;
    const currency =
      typeof payload.currency === "string"
        ? (payload.currency as ProvenanceCurrency)
        : null;

    switch (e.kind) {
      case "a2a.contract.escrowed":
        totalContracts += 1;
        break;
      case "a2a.contract.settled":
        settledContracts += 1;
        if (amountStr) {
          earned = earned + bigOf(amountStr);
          if (currency) {
            currencyTally.set(
              currency,
              (currencyTally.get(currency) ?? 0n) + bigOf(amountStr),
            );
          }
        }
        break;
      case "a2a.contract.failed":
        failedContracts += 1;
        break;
      case "a2a.contract.refunded":
        refundedContracts += 1;
        break;
      case "a2a.invocation.completed":
        totalInvocations += 1;
        break;
      case "a2a.invocation.verified":
        verifiedInvocations += 1;
        break;
      case "a2a.invocation.rejected":
        rejectedInvocations += 1;
        break;
      case "reputation.slashed":
        if (amountStr) slashed = slashed + bigOf(amountStr);
        break;
      default:
        break;
    }
  }

  // Also fold in active slashes that didn't emit events.
  const slashes = await db
    .select()
    .from(slashRecords)
    .where(
      and(
        eq(slashRecords.principalDid, principalDid),
        eq(slashRecords.status, "active"),
      ),
    );
  for (const s of slashes) {
    slashed = slashed + bigOf(s.amount);
  }

  // Success rate (0–1000): verified / (verified + rejected + failed).
  const denom = verifiedInvocations + rejectedInvocations + failedContracts;
  const successRate =
    denom === 0
      ? 1000
      : Math.round((verifiedInvocations / denom) * 1000);

  // Pick the dominant currency.
  let primaryCurrency: ProvenanceCurrency | null = null;
  let max = -1n;
  for (const [c, v] of currencyTally) {
    if (v > max) {
      max = v;
      primaryCurrency = c;
    }
  }

  const ts = now();

  const existing = await db
    .select()
    .from(reputationScores)
    .where(eq(reputationScores.principalDid, principalDid))
    .limit(1);

  const values = {
    principalDid,
    totalContracts,
    settledContracts,
    failedContracts,
    refundedContracts,
    totalInvocations,
    verifiedInvocations,
    rejectedInvocations,
    totalEarnedString: earned.toString(),
    totalSlashedString: slashed.toString(),
    primaryCurrency,
    successRate,
    lastEventAt,
    lastComputedAt: ts,
  };

  if (existing.length > 0) {
    const [row] = await db
      .update(reputationScores)
      .set(values)
      .where(eq(reputationScores.principalDid, principalDid))
      .returning();
    return row;
  }
  const [row] = await db.insert(reputationScores).values(values).returning();
  return row;
}

export async function getScore(
  principalDid: string,
): Promise<ReputationScoreRow | null> {
  const rows = await db
    .select()
    .from(reputationScores)
    .where(eq(reputationScores.principalDid, principalDid))
    .limit(1);
  return rows[0] ?? null;
}

export interface ScoreFilters {
  minSuccessRate?: number;
  limit?: number;
}

export async function listScores(
  filters: ScoreFilters = {},
): Promise<ReputationScoreRow[]> {
  const limit = filters.limit ?? 100;
  const all = await db.select().from(reputationScores);
  const filtered =
    filters.minSuccessRate !== undefined
      ? all.filter((s) => s.successRate >= (filters.minSuccessRate ?? 0))
      : all;
  return filtered
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, limit);
}

// =============================================================================
// SLASHING
// =============================================================================

export interface ProposeSlashInput {
  principalDid: string;
  reason: string;
  amount?: string;
  currency?: ProvenanceCurrency;
  contractId?: string;
  evidence?: Record<string, unknown> | null;
  createdBy?: string;
}

export async function proposeSlash(
  input: ProposeSlashInput,
): Promise<SlashRecordRow> {
  if (!input.principalDid) throw new Error("proposeSlash: principalDid required");
  if (!input.reason) throw new Error("proposeSlash: reason required");
  const id = uuid();
  const ts = now();
  const [row] = await db
    .insert(slashRecords)
    .values({
      id,
      principalDid: input.principalDid,
      reason: input.reason,
      amount: input.amount ?? "0",
      currency: input.currency ?? null,
      contractId: input.contractId ?? null,
      evidenceJson: input.evidence ?? null,
      status: "proposed",
      createdBy: input.createdBy ?? "system",
      createdAt: ts,
    })
    .returning();
  return row;
}

export async function activateSlash(id: string): Promise<SlashRecordRow> {
  const ts = now();
  const [row] = await db
    .update(slashRecords)
    .set({ status: "active", activatedAt: ts })
    .where(eq(slashRecords.id, id))
    .returning();
  if (!row) throw new Error(`activateSlash: not found: ${id}`);

  // Emit an event so the score recompute picks it up.
  await emitEvent({
    kind: "reputation.slashed",
    principalDid: row.principalDid,
    subjectRef: row.id,
    payload: {
      reason: row.reason,
      amount: row.amount,
      currency: row.currency,
      contractId: row.contractId,
    },
  });
  await recomputeScore(row.principalDid);
  return row;
}

export async function reverseSlash(
  id: string,
  reason: string,
): Promise<SlashRecordRow> {
  if (!reason) throw new Error("reverseSlash: reason required");
  const ts = now();
  const [row] = await db
    .update(slashRecords)
    .set({ status: "reversed", reversedAt: ts, reversalReason: reason })
    .where(eq(slashRecords.id, id))
    .returning();
  if (!row) throw new Error(`reverseSlash: not found: ${id}`);
  await recomputeScore(row.principalDid);
  return row;
}

export interface SlashFilters {
  principalDid?: string;
  status?: SlashStatus;
  limit?: number;
}

export async function listSlashes(
  filters: SlashFilters = {},
): Promise<SlashRecordRow[]> {
  const conds = [];
  if (filters.principalDid)
    conds.push(eq(slashRecords.principalDid, filters.principalDid));
  if (filters.status) conds.push(eq(slashRecords.status, filters.status));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const limit = filters.limit ?? 100;
  const q = where
    ? db.select().from(slashRecords).where(where)
    : db.select().from(slashRecords);
  return await q.orderBy(desc(slashRecords.createdAt)).limit(limit);
}

// =============================================================================
// TEST EXPORTS
// =============================================================================

export const __test__ = {
  sha256Hex,
  canonicalEvent,
  bigOf,
};
