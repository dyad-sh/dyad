/**
 * Agent Wallet & Policy Engine — Tier 2
 *
 * Pure TypeScript service module (no Electron / no IPC).
 *
 * Provides three primitives sitting underneath A2A and the OS shell:
 *   - capability tokens (issue / revoke / list)
 *   - per-principal policies (create / update / delete / evaluate)
 *   - signed intents (sign with caller-supplied Ed25519 private key,
 *     verify against the public key in `ssi_identities`)
 *
 * Private keys are NEVER stored in the database — callers pass them in
 * for signing operations only. We persist the signature + payload hash.
 */

import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import crypto, { randomUUID } from "node:crypto";
import log from "electron-log";

import { db } from "@/db";
import {
  agentCapabilities,
  agentPolicies,
  signedIntents,
  type AgentCapabilityRow,
  type AgentPolicyRow,
  type CapabilityStatus,
  type PolicyRuleType,
  type PolicyStatus,
  type SignatureAlgorithm,
  type SignedIntentRow,
  type WalletCurrency,
} from "@/db/agent_wallet_schema";
import { agentPrincipals } from "@/db/a2a_schema";
import { osIntents, type OsIntentRow } from "@/db/agent_os_schema";
import { ssiIdentities, rewardsLedger } from "@/db/schema";

const logger = log.scope("agent_wallet");

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

/**
 * Compare a capability against a glob pattern.
 *   - "*"     matches anything
 *   - "a2a.*" matches "a2a.invoke", "a2a.read", etc.
 *   - "a2a.invoke" matches only itself.
 *   - The optional ":suffix" part of a capability is ignored when the
 *     pattern doesn't include one.
 */
export function matchPattern(capability: string, pattern: string): boolean {
  if (!pattern || pattern === "*") return true;
  if (pattern === capability) return true;

  const cap = capability.split(":")[0];
  const pat = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;

  if (pattern.endsWith(".*") || pattern.endsWith("*")) {
    return cap.startsWith(pat) || capability.startsWith(pat);
  }
  return false;
}

function bigOf(s: string | null | undefined): bigint {
  if (!s) return 0n;
  return BigInt(s);
}

// =============================================================================
// CAPABILITY TOKENS
// =============================================================================

export interface IssueCapabilityInput {
  principalId: string;
  capability: string;
  scope?: string;
  conditions?: Record<string, unknown> | null;
  issuedBy?: string;
  expiresAt?: Date | null;
}

export async function issueCapability(
  input: IssueCapabilityInput,
): Promise<AgentCapabilityRow> {
  if (!input.principalId)
    throw new Error("issueCapability: principalId required");
  if (!input.capability)
    throw new Error("issueCapability: capability required");

  // Ensure the principal exists.
  const [p] = await db
    .select()
    .from(agentPrincipals)
    .where(eq(agentPrincipals.id, input.principalId))
    .limit(1);
  if (!p) throw new Error(`issueCapability: principal not found: ${input.principalId}`);

  const id = uuid();
  const ts = now();
  const [row] = await db
    .insert(agentCapabilities)
    .values({
      id,
      principalId: input.principalId,
      capability: input.capability,
      scope: input.scope ?? null,
      conditionsJson: input.conditions ?? null,
      issuedBy: input.issuedBy ?? "system",
      issuedAt: ts,
      expiresAt: input.expiresAt ?? null,
      status: "active",
    })
    .returning();
  return row;
}

export async function revokeCapability(
  id: string,
  reason?: string,
): Promise<AgentCapabilityRow> {
  const ts = now();
  const [row] = await db
    .update(agentCapabilities)
    .set({
      status: "revoked",
      revokedAt: ts,
      revocationReason: reason ?? null,
    })
    .where(eq(agentCapabilities.id, id))
    .returning();
  if (!row) throw new Error(`revokeCapability: not found: ${id}`);
  return row;
}

export interface CapabilityFilters {
  principalId?: string;
  capability?: string;
  status?: CapabilityStatus;
}

export async function listCapabilities(
  filters: CapabilityFilters = {},
): Promise<AgentCapabilityRow[]> {
  const conds = [];
  if (filters.principalId)
    conds.push(eq(agentCapabilities.principalId, filters.principalId));
  if (filters.capability)
    conds.push(eq(agentCapabilities.capability, filters.capability));
  if (filters.status) conds.push(eq(agentCapabilities.status, filters.status));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return where
    ? await db.select().from(agentCapabilities).where(where)
    : await db.select().from(agentCapabilities);
}

export async function getCapability(id: string): Promise<AgentCapabilityRow | null> {
  const rows = await db
    .select()
    .from(agentCapabilities)
    .where(eq(agentCapabilities.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns true if the principal currently holds at least one active,
 * non-expired capability matching the given capability string.
 */
export async function principalHasCapability(
  principalId: string,
  capability: string,
): Promise<boolean> {
  const caps = await listCapabilities({ principalId, status: "active" });
  const ts = now();
  return caps.some((c) => {
    if (c.expiresAt && c.expiresAt < ts) return false;
    return matchPattern(capability, c.capability);
  });
}

// =============================================================================
// POLICIES
// =============================================================================

export interface CreatePolicyInput {
  principalId: string;
  name: string;
  ruleType: PolicyRuleType;
  pattern?: string;
  maxAmount?: string;
  currency?: WalletCurrency;
  windowSeconds?: number;
  timeWindowStart?: number;
  timeWindowEnd?: number;
  priority?: number;
  notes?: string;
}

export async function createPolicy(
  input: CreatePolicyInput,
): Promise<AgentPolicyRow> {
  if (!input.principalId)
    throw new Error("createPolicy: principalId required");
  if (!input.name) throw new Error("createPolicy: name required");
  if (!input.ruleType) throw new Error("createPolicy: ruleType required");

  const id = uuid();
  const ts = now();
  const [row] = await db
    .insert(agentPolicies)
    .values({
      id,
      principalId: input.principalId,
      name: input.name,
      ruleType: input.ruleType,
      pattern: input.pattern ?? null,
      maxAmount: input.maxAmount ?? null,
      currency: input.currency ?? null,
      windowSeconds: input.windowSeconds ?? null,
      timeWindowStart: input.timeWindowStart ?? null,
      timeWindowEnd: input.timeWindowEnd ?? null,
      priority: input.priority ?? 100,
      status: "active",
      notes: input.notes ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row;
}

export type PolicyPatch = Partial<
  Pick<
    AgentPolicyRow,
    | "name"
    | "pattern"
    | "maxAmount"
    | "currency"
    | "windowSeconds"
    | "timeWindowStart"
    | "timeWindowEnd"
    | "priority"
    | "status"
    | "notes"
  >
>;

export async function updatePolicy(
  id: string,
  patch: PolicyPatch,
): Promise<AgentPolicyRow> {
  const ts = now();
  const [row] = await db
    .update(agentPolicies)
    .set({ ...patch, updatedAt: ts })
    .where(eq(agentPolicies.id, id))
    .returning();
  if (!row) throw new Error(`updatePolicy: not found: ${id}`);
  return row;
}

export async function deletePolicy(id: string): Promise<void> {
  await db.delete(agentPolicies).where(eq(agentPolicies.id, id));
}

export interface PolicyFilters {
  principalId?: string;
  status?: PolicyStatus;
}

export async function listPolicies(
  filters: PolicyFilters = {},
): Promise<AgentPolicyRow[]> {
  const conds = [];
  if (filters.principalId)
    conds.push(eq(agentPolicies.principalId, filters.principalId));
  if (filters.status) conds.push(eq(agentPolicies.status, filters.status));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const rows = where
    ? await db.select().from(agentPolicies).where(where)
    : await db.select().from(agentPolicies);
  return rows.sort((a, b) => a.priority - b.priority);
}

// =============================================================================
// POLICY EVALUATION
//
// Inputs: principalId, capability being invoked, optional spend amount
// Output: { allowed, reasons[], requiresHumanVerify }
//
// Rules are walked in priority order. `deny_capability` matches short-circuit.
// `spend_limit` adds a constraint that we check by summing recent ledger spend.
// `time_window` restricts to a UTC clock window.
// `require_human_verify` flags the call as needing manual confirmation.
// `allow_capability` is required if there is at least one allow rule
// (default-deny when allow rules exist; default-allow otherwise).
// =============================================================================

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
  requiresHumanVerify: boolean;
}

export interface PolicyContext {
  principalId: string;
  capability: string;
  amount?: string;
  currency?: WalletCurrency;
  at?: Date;
}

export async function evaluatePolicy(
  ctx: PolicyContext,
): Promise<PolicyDecision> {
  const at = ctx.at ?? now();
  const reasons: string[] = [];
  let requiresHumanVerify = false;

  const policies = await listPolicies({
    principalId: ctx.principalId,
    status: "active",
  });

  // 1. deny rules win first
  for (const p of policies) {
    if (p.ruleType !== "deny_capability") continue;
    if (matchPattern(ctx.capability, p.pattern ?? "*")) {
      reasons.push(`denied by policy "${p.name}"`);
      return { allowed: false, reasons, requiresHumanVerify: false };
    }
  }

  // 2. time_window enforcement
  for (const p of policies) {
    if (p.ruleType !== "time_window") continue;
    if (!matchPattern(ctx.capability, p.pattern ?? "*")) continue;
    const start = p.timeWindowStart ?? 0;
    const end = p.timeWindowEnd ?? 1439;
    const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
    const inWindow =
      start <= end
        ? minutes >= start && minutes <= end
        : minutes >= start || minutes <= end;
    if (!inWindow) {
      reasons.push(`outside time window for policy "${p.name}"`);
      return { allowed: false, reasons, requiresHumanVerify: false };
    }
  }

  // 3. spend_limit enforcement
  for (const p of policies) {
    if (p.ruleType !== "spend_limit") continue;
    if (!matchPattern(ctx.capability, p.pattern ?? "*")) continue;
    if (!p.maxAmount) continue;
    if (ctx.currency && p.currency && p.currency !== ctx.currency) continue;

    const want = bigOf(ctx.amount);
    const cap = bigOf(p.maxAmount);
    const windowSec = p.windowSeconds ?? 86_400; // default 24h
    const sinceSec = Math.floor(at.getTime() / 1000) - windowSec;

    // Sum prior spends on rewards_ledger by this principal in the window.
    // We approximate by counting confirmed/pending rows whose senderId
    // matches the principal's DID. (rewards_ledger.senderId is text.)
    const principal = await db
      .select()
      .from(agentPrincipals)
      .where(eq(agentPrincipals.id, ctx.principalId))
      .limit(1);
    if (principal.length === 0) continue;
    const senderRef = principal[0].did;

    const recent = await db
      .select()
      .from(rewardsLedger)
      .where(
        and(
          eq(rewardsLedger.senderId, senderRef),
          gt(rewardsLedger.createdAt, new Date(sinceSec * 1000)),
        ),
      );
    let spent = 0n;
    for (const r of recent) {
      // Best-effort: amount may be on different fields across handlers.
      const amt = (r as Record<string, unknown>).amount;
      if (typeof amt === "string") spent += BigInt(amt);
      else if (typeof amt === "number") spent += BigInt(amt);
    }
    if (spent + want > cap) {
      reasons.push(
        `spend cap exceeded by policy "${p.name}" (${spent + want} > ${cap})`,
      );
      return { allowed: false, reasons, requiresHumanVerify: false };
    }
  }

  // 4. require_human_verify flag
  for (const p of policies) {
    if (p.ruleType !== "require_human_verify") continue;
    if (matchPattern(ctx.capability, p.pattern ?? "*")) {
      requiresHumanVerify = true;
      reasons.push(`policy "${p.name}" requires human verification`);
    }
  }

  // 5. allow rules — if any exist, the call must match at least one
  const allowRules = policies.filter((p) => p.ruleType === "allow_capability");
  if (allowRules.length > 0) {
    const matched = allowRules.find((p) =>
      matchPattern(ctx.capability, p.pattern ?? "*"),
    );
    if (!matched) {
      reasons.push(
        "default-deny: no allow rule matches and at least one allow rule exists",
      );
      return { allowed: false, reasons, requiresHumanVerify };
    }
    reasons.push(`allowed by policy "${matched.name}"`);
  } else {
    reasons.push("default-allow: no allow rules configured");
  }

  return { allowed: true, reasons, requiresHumanVerify };
}

// =============================================================================
// SIGNED INTENTS
// =============================================================================

/**
 * Build the canonical payload for an intent that we sign.
 * Hashing this gives us a stable digest independent of DB id.
 */
function canonicalIntentPayload(intent: OsIntentRow): string {
  return JSON.stringify({
    type: "os.intent.v1",
    id: intent.id,
    query: intent.query,
    scope: intent.scope ?? null,
    matchedCommandId: intent.matchedCommandId ?? null,
    inputJson: intent.inputJson ?? null,
    requestedBy: intent.requestedBy ?? null,
    createdAt: intent.createdAt.toISOString(),
  });
}

export interface SignIntentInput {
  intentId: string;
  principalDid: string;
  privateKeyHex: string;
  algorithm?: SignatureAlgorithm;
}

export async function signIntent(
  input: SignIntentInput,
): Promise<SignedIntentRow> {
  if (!input.intentId) throw new Error("signIntent: intentId required");
  if (!input.principalDid) throw new Error("signIntent: principalDid required");
  if (!input.privateKeyHex) throw new Error("signIntent: privateKeyHex required");
  const algorithm: SignatureAlgorithm = input.algorithm ?? "ed25519";

  const [intent] = await db
    .select()
    .from(osIntents)
    .where(eq(osIntents.id, input.intentId))
    .limit(1);
  if (!intent) throw new Error(`signIntent: intent not found: ${input.intentId}`);

  const payload = canonicalIntentPayload(intent);
  const payloadHash = sha256Hex(payload);

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(input.privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const sig = crypto.sign(null, Buffer.from(payload), privateKey);
  const signatureHex = sig.toString("hex");

  const id = uuid();
  const ts = now();
  const [row] = await db
    .insert(signedIntents)
    .values({
      id,
      intentId: input.intentId,
      principalDid: input.principalDid,
      payloadHash,
      signatureHex,
      algorithm,
      signedAt: ts,
      verificationStatus: "pending",
    })
    .returning();
  return row;
}

export async function verifySignedIntent(
  id: string,
): Promise<SignedIntentRow> {
  const [signed] = await db
    .select()
    .from(signedIntents)
    .where(eq(signedIntents.id, id))
    .limit(1);
  if (!signed) throw new Error(`verifySignedIntent: not found: ${id}`);

  const [intent] = await db
    .select()
    .from(osIntents)
    .where(eq(osIntents.id, signed.intentId))
    .limit(1);
  if (!intent) {
    const [bad] = await db
      .update(signedIntents)
      .set({
        verificationStatus: "invalid",
        verifiedAt: now(),
        verificationError: "intent not found",
      })
      .where(eq(signedIntents.id, id))
      .returning();
    return bad;
  }

  const [identity] = await db
    .select()
    .from(ssiIdentities)
    .where(eq(ssiIdentities.did, signed.principalDid))
    .limit(1);
  if (!identity?.publicKey) {
    const [bad] = await db
      .update(signedIntents)
      .set({
        verificationStatus: "invalid",
        verifiedAt: now(),
        verificationError: "no public key for did",
      })
      .where(eq(signedIntents.id, id))
      .returning();
    return bad;
  }

  const payload = canonicalIntentPayload(intent);
  const payloadHash = sha256Hex(payload);
  if (payloadHash !== signed.payloadHash) {
    const [bad] = await db
      .update(signedIntents)
      .set({
        verificationStatus: "invalid",
        verifiedAt: now(),
        verificationError: "payload hash mismatch (intent mutated)",
      })
      .where(eq(signedIntents.id, id))
      .returning();
    return bad;
  }

  let ok = false;
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(identity.publicKey, "hex"),
      format: "der",
      type: "spki",
    });
    ok = crypto.verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(signed.signatureHex, "hex"),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [bad] = await db
      .update(signedIntents)
      .set({
        verificationStatus: "invalid",
        verifiedAt: now(),
        verificationError: message,
      })
      .where(eq(signedIntents.id, id))
      .returning();
    logger.warn("verifySignedIntent crypto error", id, message);
    return bad;
  }

  const [row] = await db
    .update(signedIntents)
    .set({
      verificationStatus: ok ? "valid" : "invalid",
      verifiedAt: now(),
      verificationError: ok ? null : "signature mismatch",
    })
    .where(eq(signedIntents.id, id))
    .returning();
  return row;
}

export async function listSignedIntents(filters: {
  intentId?: string;
  principalDid?: string;
  limit?: number;
}): Promise<SignedIntentRow[]> {
  const conds = [];
  if (filters.intentId)
    conds.push(eq(signedIntents.intentId, filters.intentId));
  if (filters.principalDid)
    conds.push(eq(signedIntents.principalDid, filters.principalDid));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const limit = filters.limit ?? 100;
  const q = where
    ? db.select().from(signedIntents).where(where)
    : db.select().from(signedIntents);
  return await q.orderBy(desc(signedIntents.signedAt)).limit(limit);
}

// =============================================================================
// TEST EXPORTS
// =============================================================================

export const __test__ = {
  matchPattern,
  sha256Hex,
  canonicalIntentPayload,
  bigOf,
};
