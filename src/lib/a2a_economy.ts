/**
 * Agent-to-Agent (A2A) Economy Engine
 *
 * Pure TypeScript service module (no Electron / no IPC).
 * Handles: principals, listings, quotes, contracts (state machine),
 * invocations, escrow against `rewards_ledger`, and trustless receipt
 * pinning to Celestia (best-effort).
 *
 * IPC handlers in `src/ipc/handlers/a2a_handlers.ts` are thin wrappers
 * around this module.
 */

import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import log from "electron-log";

import { db } from "@/db";
import {
  a2aContracts,
  a2aInvocations,
  a2aQuotes,
  agentPrincipals,
  agentServiceListings,
  type A2AContractRow,
  type A2AContractState,
  type A2ACurrency,
  type A2AInvocationRow,
  type A2AQuoteRow,
  type AgentPrincipalRow,
  type AgentServiceListingRow,
} from "@/db/a2a_schema";
import { agents, rewardsLedger, ssiIdentities } from "@/db/schema";
import { didDocumentService } from "@/lib/ssi/did_document_service";
import { celestiaBlobService } from "@/lib/celestia_blob_service";
import { emitEvent, recomputeScore } from "@/lib/agent_provenance";
import {
  startActivity as osStartActivity,
  completeActivity as osCompleteActivity,
  failActivity as osFailActivity,
} from "@/lib/agent_os";

/**
 * Best-effort cross-tier emission. Never throws — a failure to emit a
 * provenance event or OS activity update must not break the A2A flow.
 */
async function safeEmit(
  fn: () => Promise<unknown>,
  context: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn(`safeEmit failed (${context})`, err);
  }
}

const logger = log.scope("a2a_economy");

// =============================================================================
// CONSTANTS
// =============================================================================

const QUOTE_DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ESCROW_RECIPIENT_PREFIX = "escrow:contract:";

/**
 * Allowed transitions for the contract state machine.
 * Throws if a caller tries to advance state in any other way.
 */
const ALLOWED_TRANSITIONS: Record<A2AContractState, A2AContractState[]> = {
  ACCEPTED: ["ESCROWED", "FAILED"],
  ESCROWED: ["IN_PROGRESS", "REFUNDED", "FAILED"],
  IN_PROGRESS: ["DELIVERED", "FAILED", "DISPUTED"],
  DELIVERED: ["VERIFIED", "DISPUTED", "FAILED"],
  VERIFIED: ["SETTLED"],
  SETTLED: ["CLOSED"],
  DISPUTED: ["SETTLED", "REFUNDED"],
  FAILED: ["REFUNDED"],
  REFUNDED: ["CLOSED"],
  CLOSED: [],
};

// =============================================================================
// HELPERS
// =============================================================================

function uuid(): string {
  return randomUUID();
}

function now(): Date {
  return new Date();
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Add two amounts that are stored as decimal strings. Uses BigInt — assumes integer minor units. */
function addAmount(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function subAmount(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}

function gtAmount(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b);
}

function gteAmount(a: string, b: string): boolean {
  return BigInt(a) >= BigInt(b);
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf-8") : data)
    .digest("hex");
}

function appendStateHistory(
  rowHistory: A2AContractRow["stateHistoryJson"],
  state: A2AContractState,
  note?: string,
): A2AContractRow["stateHistoryJson"] {
  const next = [...(rowHistory ?? []), { state, at: Date.now(), note }];
  return next;
}

function assertTransition(from: A2AContractState, to: A2AContractState): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid contract transition: ${from} → ${to}`);
  }
}

// =============================================================================
// PRINCIPALS  (Tier 2 minimum slice)
// =============================================================================

export interface PrincipalBudget {
  dailyCap: string;
  perTaskCap: string;
  currency: A2ACurrency;
}

/**
 * Look up an agent's principal, or create one (issuing a fresh DID via SSI).
 * Idempotent on `agents.id`.
 */
export async function getOrCreatePrincipal(
  agentId: number,
  options?: { displayName?: string; budget?: PrincipalBudget; payoutWallet?: string },
): Promise<AgentPrincipalRow> {
  if (!Number.isInteger(agentId) || agentId <= 0) {
    throw new Error("agentId must be a positive integer");
  }

  const existing = await db
    .select()
    .from(agentPrincipals)
    .where(eq(agentPrincipals.agentId, agentId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const { identity } = await didDocumentService.createIdentity({
    displayName: options?.displayName ?? agent.name,
    keyAlgorithm: "ed25519",
  });

  const id = uuid();
  const ts = now();
  const row: AgentPrincipalRow = {
    id,
    agentId,
    did: identity.did,
    payoutWallet: options?.payoutWallet ?? null,
    publicKey: null,
    dailyCap: options?.budget?.dailyCap ?? "0",
    perTaskCap: options?.budget?.perTaskCap ?? "0",
    currency: options?.budget?.currency ?? "USDC",
    status: "active",
    spentTodayString: "0",
    spentTodayResetAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };

  await db.insert(agentPrincipals).values(row);
  logger.info(`Created principal ${id} for agent ${agentId} with DID ${identity.did}`);
  return row;
}

export async function listPrincipals(): Promise<AgentPrincipalRow[]> {
  return db.select().from(agentPrincipals).orderBy(desc(agentPrincipals.createdAt));
}

export async function getPrincipal(principalId: string): Promise<AgentPrincipalRow> {
  const [row] = await db
    .select()
    .from(agentPrincipals)
    .where(eq(agentPrincipals.id, principalId))
    .limit(1);
  if (!row) throw new Error(`Principal ${principalId} not found`);
  return row;
}

export async function setPrincipalBudget(
  principalId: string,
  budget: PrincipalBudget,
): Promise<AgentPrincipalRow> {
  const principal = await getPrincipal(principalId);
  if (BigInt(budget.dailyCap) < 0n || BigInt(budget.perTaskCap) < 0n) {
    throw new Error("Budget caps must be non-negative");
  }
  await db
    .update(agentPrincipals)
    .set({
      dailyCap: budget.dailyCap,
      perTaskCap: budget.perTaskCap,
      currency: budget.currency,
      updatedAt: now(),
    })
    .where(eq(agentPrincipals.id, principalId));
  return getPrincipal(principal.id);
}

/** Internal: roll over daily-spent counter if the day has changed. */
async function rolloverDailySpentIfNeeded(principal: AgentPrincipalRow): Promise<AgentPrincipalRow> {
  if (isSameUtcDay(principal.spentTodayResetAt, new Date())) return principal;
  const ts = now();
  await db
    .update(agentPrincipals)
    .set({ spentTodayString: "0", spentTodayResetAt: ts, updatedAt: ts })
    .where(eq(agentPrincipals.id, principal.id));
  return getPrincipal(principal.id);
}

/** Throws if `amount` would breach the principal's per-task or daily cap. */
async function assertCanSpend(
  principalId: string,
  amount: string,
  currency: A2ACurrency,
): Promise<AgentPrincipalRow> {
  let principal = await getPrincipal(principalId);
  principal = await rolloverDailySpentIfNeeded(principal);

  if (principal.status !== "active") {
    throw new Error(`Principal ${principalId} is not active (status=${principal.status})`);
  }
  if (principal.currency !== currency) {
    throw new Error(
      `Currency mismatch: principal uses ${principal.currency}, request is ${currency}`,
    );
  }
  if (gtAmount(amount, principal.perTaskCap)) {
    throw new Error(
      `Amount ${amount} ${currency} exceeds per-task cap ${principal.perTaskCap} ${currency}`,
    );
  }
  const projected = addAmount(principal.spentTodayString, amount);
  if (gtAmount(projected, principal.dailyCap)) {
    throw new Error(
      `Daily cap breached: would spend ${projected}/${principal.dailyCap} ${currency}`,
    );
  }
  return principal;
}

async function debitPrincipal(principalId: string, amount: string): Promise<void> {
  const principal = await getPrincipal(principalId);
  await db
    .update(agentPrincipals)
    .set({
      spentTodayString: addAmount(principal.spentTodayString, amount),
      updatedAt: now(),
    })
    .where(eq(agentPrincipals.id, principalId));
}

async function creditPrincipal(principalId: string, amount: string): Promise<void> {
  const principal = await getPrincipal(principalId);
  // Never let the counter go negative — clamp at 0.
  const next = gteAmount(principal.spentTodayString, amount)
    ? subAmount(principal.spentTodayString, amount)
    : "0";
  await db
    .update(agentPrincipals)
    .set({ spentTodayString: next, updatedAt: now() })
    .where(eq(agentPrincipals.id, principalId));
}

// =============================================================================
// LISTINGS
// =============================================================================

export interface CreateListingInput {
  principalId: string;
  name: string;
  description?: string;
  capability: string;
  tags?: string[];
  pricingModel: AgentServiceListingRow["pricingModel"];
  priceAmount: string;
  currency: A2ACurrency;
  maxLatencyMs?: number;
  successRatePromised?: number;
  inputSchemaJson?: Record<string, unknown> | null;
  outputSchemaJson?: Record<string, unknown> | null;
}

export async function createListing(input: CreateListingInput): Promise<AgentServiceListingRow> {
  if (!input.name?.trim()) throw new Error("Listing name is required");
  if (!input.capability?.trim()) throw new Error("Listing capability is required");
  if (BigInt(input.priceAmount) < 0n) throw new Error("priceAmount must be non-negative");

  // Verify principal exists.
  await getPrincipal(input.principalId);

  const id = uuid();
  const ts = now();
  const row: AgentServiceListingRow = {
    id,
    principalId: input.principalId,
    name: input.name,
    description: input.description ?? null,
    capability: input.capability,
    tags: input.tags ?? [],
    pricingModel: input.pricingModel,
    priceAmount: input.priceAmount,
    currency: input.currency,
    maxLatencyMs: input.maxLatencyMs ?? null,
    successRatePromised: input.successRatePromised ?? null,
    inputSchemaJson: input.inputSchemaJson ?? null,
    outputSchemaJson: input.outputSchemaJson ?? null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(agentServiceListings).values(row);
  return row;
}

export interface ListingFilters {
  principalId?: string;
  capability?: string;
  status?: AgentServiceListingRow["status"];
}

export async function listListings(filters: ListingFilters = {}): Promise<AgentServiceListingRow[]> {
  const conditions = [];
  if (filters.principalId) conditions.push(eq(agentServiceListings.principalId, filters.principalId));
  if (filters.capability) conditions.push(eq(agentServiceListings.capability, filters.capability));
  if (filters.status) conditions.push(eq(agentServiceListings.status, filters.status));
  const where = conditions.length ? and(...conditions) : undefined;
  return db
    .select()
    .from(agentServiceListings)
    .where(where)
    .orderBy(desc(agentServiceListings.createdAt));
}

export async function getListing(id: string): Promise<AgentServiceListingRow> {
  const [row] = await db
    .select()
    .from(agentServiceListings)
    .where(eq(agentServiceListings.id, id))
    .limit(1);
  if (!row) throw new Error(`Listing ${id} not found`);
  return row;
}

export type ListingPatch = Partial<
  Pick<
    AgentServiceListingRow,
    | "name"
    | "description"
    | "tags"
    | "pricingModel"
    | "priceAmount"
    | "currency"
    | "maxLatencyMs"
    | "successRatePromised"
    | "inputSchemaJson"
    | "outputSchemaJson"
    | "status"
  >
>;

export async function updateListing(
  id: string,
  patch: ListingPatch,
): Promise<AgentServiceListingRow> {
  await getListing(id);
  if (patch.priceAmount !== undefined && BigInt(patch.priceAmount) < 0n) {
    throw new Error("priceAmount must be non-negative");
  }
  await db
    .update(agentServiceListings)
    .set({ ...patch, updatedAt: now() })
    .where(eq(agentServiceListings.id, id));
  return getListing(id);
}

export async function deleteListing(id: string): Promise<void> {
  await getListing(id);
  await db.delete(agentServiceListings).where(eq(agentServiceListings.id, id));
}

// =============================================================================
// QUOTES
// =============================================================================

export interface RequestQuoteInput {
  listingId: string;
  callerPrincipalId: string;
  inputSummary?: string;
  inputJson?: Record<string, unknown> | null;
  estimatedTokens?: number;
  ttlMs?: number;
}

export async function requestQuote(input: RequestQuoteInput): Promise<A2AQuoteRow> {
  const listing = await getListing(input.listingId);
  if (listing.status !== "active") {
    throw new Error(`Listing ${listing.id} is not active (status=${listing.status})`);
  }
  const caller = await getPrincipal(input.callerPrincipalId);
  if (caller.status !== "active") {
    throw new Error(`Caller principal ${caller.id} is not active`);
  }
  if (caller.currency !== listing.currency) {
    throw new Error(
      `Currency mismatch: caller uses ${caller.currency}, listing is ${listing.currency}`,
    );
  }

  // Freeze price at quote time. (per_token / per_call use estimatedTokens or 1.)
  let quotedAmount = listing.priceAmount;
  if (listing.pricingModel === "per_token") {
    const tokens = BigInt(input.estimatedTokens ?? 0);
    quotedAmount = (BigInt(listing.priceAmount) * tokens).toString();
  } else if (listing.pricingModel === "per_call") {
    quotedAmount = listing.priceAmount;
  }

  // Tier 2 policy gate: if the caller has policies that explicitly deny
  // "a2a.invoke" (or are over a spend cap), block the quote here.
  // Default-allow when no policies exist, so existing callers keep working.
  try {
    const { evaluatePolicy } = await import("@/lib/agent_wallet");
    const decision = await evaluatePolicy({
      principalId: caller.id,
      capability: "a2a.invoke",
      amount: quotedAmount,
      currency: caller.currency as "JOY" | "TIA" | "USDC" | "MATIC" | "points",
    });
    if (!decision.allowed) {
      throw new Error(
        `policy denied a2a.invoke: ${decision.reasons.join("; ")}`,
      );
    }
  } catch (err) {
    // Re-throw policy denials; swallow only loader errors.
    if (err instanceof Error && err.message.startsWith("policy denied")) {
      throw err;
    }
    logger.warn("requestQuote: policy evaluator unavailable", err);
  }

  const id = uuid();
  const ts = now();
  const expiresAt = new Date(ts.getTime() + (input.ttlMs ?? QUOTE_DEFAULT_TTL_MS));
  const row: A2AQuoteRow = {
    id,
    listingId: input.listingId,
    callerPrincipalId: input.callerPrincipalId,
    inputSummary: input.inputSummary ?? null,
    inputJson: input.inputJson ?? null,
    estimatedTokens: input.estimatedTokens ?? null,
    quotedAmount,
    quotedCurrency: listing.currency,
    quotedLatencyMs: listing.maxLatencyMs,
    status: "pending",
    expiresAt,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(a2aQuotes).values(row);
  return row;
}

export async function getQuote(id: string): Promise<A2AQuoteRow> {
  const [row] = await db.select().from(a2aQuotes).where(eq(a2aQuotes.id, id)).limit(1);
  if (!row) throw new Error(`Quote ${id} not found`);
  return row;
}

/**
 * Accept a quote → create contract (state ACCEPTED) → escrow funds (state ESCROWED).
 * This is one atomic-ish flow because there is no business value in stopping mid-way.
 */
export async function acceptQuote(quoteId: string): Promise<A2AContractRow> {
  const quote = await getQuote(quoteId);
  if (quote.status !== "pending") {
    throw new Error(`Quote ${quoteId} is not pending (status=${quote.status})`);
  }
  if (quote.expiresAt.getTime() < Date.now()) {
    await db
      .update(a2aQuotes)
      .set({ status: "expired", updatedAt: now() })
      .where(eq(a2aQuotes.id, quoteId));
    throw new Error(`Quote ${quoteId} has expired`);
  }

  const listing = await getListing(quote.listingId);

  // Pre-flight budget check.
  await assertCanSpend(quote.callerPrincipalId, quote.quotedAmount, quote.quotedCurrency);

  // Mark quote accepted.
  await db
    .update(a2aQuotes)
    .set({ status: "accepted", updatedAt: now() })
    .where(eq(a2aQuotes.id, quoteId));

  // Create contract (ACCEPTED).
  const id = uuid();
  const ts = now();
  const contract: A2AContractRow = {
    id,
    quoteId,
    listingId: quote.listingId,
    callerPrincipalId: quote.callerPrincipalId,
    providerPrincipalId: listing.principalId,
    state: "ACCEPTED",
    stateHistoryJson: appendStateHistory([], "ACCEPTED"),
    amount: quote.quotedAmount,
    currency: quote.quotedCurrency,
    escrowLedgerId: null,
    failureReason: null,
    disputeReason: null,
    resolutionNote: null,
    createdAt: ts,
    updatedAt: ts,
    settledAt: null,
  };
  await db.insert(a2aContracts).values(contract);

  // Escrow.
  return escrowContract(id);
}

// =============================================================================
// CONTRACTS  (state machine + escrow)
// =============================================================================

export async function getContract(id: string): Promise<A2AContractRow> {
  const [row] = await db.select().from(a2aContracts).where(eq(a2aContracts.id, id)).limit(1);
  if (!row) throw new Error(`Contract ${id} not found`);
  return row;
}

export interface ContractFilters {
  callerPrincipalId?: string;
  providerPrincipalId?: string;
  state?: A2AContractState | A2AContractState[];
  limit?: number;
}

export async function listContracts(filters: ContractFilters = {}): Promise<A2AContractRow[]> {
  const conditions = [];
  if (filters.callerPrincipalId)
    conditions.push(eq(a2aContracts.callerPrincipalId, filters.callerPrincipalId));
  if (filters.providerPrincipalId)
    conditions.push(eq(a2aContracts.providerPrincipalId, filters.providerPrincipalId));
  if (filters.state) {
    if (Array.isArray(filters.state)) {
      conditions.push(inArray(a2aContracts.state, filters.state));
    } else {
      conditions.push(eq(a2aContracts.state, filters.state));
    }
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const q = db.select().from(a2aContracts).where(where).orderBy(desc(a2aContracts.createdAt));
  if (filters.limit && filters.limit > 0) return q.limit(filters.limit);
  return q;
}

async function transitionContract(
  contractId: string,
  to: A2AContractState,
  patch: Partial<A2AContractRow> = {},
  note?: string,
): Promise<A2AContractRow> {
  const contract = await getContract(contractId);
  assertTransition(contract.state, to);
  const ts = now();
  await db
    .update(a2aContracts)
    .set({
      ...patch,
      state: to,
      stateHistoryJson: appendStateHistory(contract.stateHistoryJson, to, note),
      updatedAt: ts,
      ...(to === "SETTLED" || to === "CLOSED" ? { settledAt: ts } : {}),
    })
    .where(eq(a2aContracts.id, contractId));
  return getContract(contractId);
}

/** ACCEPTED → ESCROWED. Inserts a `pending` rewards_ledger row holding the funds. */
export async function escrowContract(contractId: string): Promise<A2AContractRow> {
  const contract = await getContract(contractId);
  if (contract.state !== "ACCEPTED") {
    throw new Error(`Cannot escrow contract in state ${contract.state}`);
  }
  await assertCanSpend(contract.callerPrincipalId, contract.amount, contract.currency);

  const ledgerId = uuid();
  await db.insert(rewardsLedger).values({
    id: ledgerId,
    recipientId: `${ESCROW_RECIPIENT_PREFIX}${contractId}`,
    recipientType: "compute_provider",
    triggerType: "compute_reward",
    triggerEventId: contractId,
    amount: contract.amount,
    currency: contract.currency,
    status: "pending",
    assetId: contract.listingId,
    assetType: "a2a_listing",
    metadataJson: { contractId, escrow: true },
  });

  await debitPrincipal(contract.callerPrincipalId, contract.amount);
  const updated = await transitionContract(contractId, "ESCROWED", { escrowLedgerId: ledgerId }, "funds escrowed");
  const caller = await getPrincipal(updated.callerPrincipalId);
  await safeEmit(
    () =>
      emitEvent({
        kind: "a2a.contract.escrowed",
        principalDid: caller.did,
        subjectRef: contractId,
        payload: { amount: updated.amount, currency: updated.currency },
      }),
    "escrowContract emitEvent",
  );
  return updated;
}

export async function startContract(contractId: string): Promise<A2AContractRow> {
  return transitionContract(contractId, "IN_PROGRESS", {}, "execution started");
}

export async function failContract(contractId: string, reason: string): Promise<A2AContractRow> {
  const updated = await transitionContract(contractId, "FAILED", { failureReason: reason }, reason);
  const provider = await getPrincipal(updated.providerPrincipalId);
  await safeEmit(
    () =>
      emitEvent({
        kind: "a2a.contract.failed",
        principalDid: provider.did,
        subjectRef: contractId,
        payload: { reason, amount: updated.amount, currency: updated.currency },
      }),
    "failContract emitEvent",
  );
  return updated;
}

export async function disputeContract(
  contractId: string,
  reason: string,
): Promise<A2AContractRow> {
  return transitionContract(contractId, "DISPUTED", { disputeReason: reason }, reason);
}

/** Refund: SETTLED|VERIFIED is NOT allowed → only FAILED|DISPUTED|ESCROWED. */
export async function refundContract(contractId: string, note?: string): Promise<A2AContractRow> {
  const contract = await getContract(contractId);
  if (contract.escrowLedgerId) {
    await db
      .update(rewardsLedger)
      .set({ status: "expired" })
      .where(eq(rewardsLedger.id, contract.escrowLedgerId));
    await creditPrincipal(contract.callerPrincipalId, contract.amount);
  }
  return transitionContract(contractId, "REFUNDED", { resolutionNote: note ?? "refunded" }, note).then(
    async (updated) => {
      const caller = await getPrincipal(updated.callerPrincipalId);
      await safeEmit(
        () =>
          emitEvent({
            kind: "a2a.contract.refunded",
            principalDid: caller.did,
            subjectRef: contractId,
            payload: {
              amount: updated.amount,
              currency: updated.currency,
              note,
            },
          }),
        "refundContract emitEvent",
      );
      return updated;
    },
  );
}

/** VERIFIED → SETTLED. Flips ledger row to provider, marks confirmed. */
async function settleContract(contractId: string): Promise<A2AContractRow> {
  const contract = await getContract(contractId);
  if (contract.escrowLedgerId) {
    const provider = await getPrincipal(contract.providerPrincipalId);
    await db
      .update(rewardsLedger)
      .set({
        recipientId: provider.payoutWallet ?? provider.did,
        status: "confirmed",
      })
      .where(eq(rewardsLedger.id, contract.escrowLedgerId));
  }
  const updated = await transitionContract(contractId, "SETTLED", {}, "settled to provider");
  const provider = await getPrincipal(updated.providerPrincipalId);
  await safeEmit(
    () =>
      emitEvent({
        kind: "a2a.contract.settled",
        principalDid: provider.did,
        subjectRef: contractId,
        payload: { amount: updated.amount, currency: updated.currency },
      }),
    "settleContract emitEvent",
  );
  await safeEmit(() => recomputeScore(provider.did), "settleContract recomputeScore");
  return updated;
}

export async function closeContract(contractId: string): Promise<A2AContractRow> {
  return transitionContract(contractId, "CLOSED", {}, "closed");
}

// =============================================================================
// INVOCATIONS
// =============================================================================

export interface InvocationExecutor {
  /**
   * The pluggable function that actually runs the work for this contract.
   * Receives the input, returns output + optional metrics.
   * If it throws, the invocation is marked failed and contract is failed.
   */
  (params: {
    contract: A2AContractRow;
    listing: AgentServiceListingRow;
    input: Record<string, unknown> | null;
  }): Promise<{
    output: Record<string, unknown>;
    inputTokens?: number;
    outputTokens?: number;
    provider?: string;
    model?: string;
  }>;
}

/**
 * Run an invocation under a contract.
 * Transitions the contract IN_PROGRESS → DELIVERED on success, FAILED on error.
 * Does NOT verify or settle — that's done by `verifyInvocation` (verifier may
 * be the caller principal or an external oracle later).
 */
export async function invokeContract(
  contractId: string,
  input: Record<string, unknown> | null,
  executor: InvocationExecutor,
): Promise<A2AInvocationRow> {
  const contract = await getContract(contractId);
  if (contract.state !== "ESCROWED") {
    throw new Error(`Cannot invoke contract in state ${contract.state}`);
  }
  const listing = await getListing(contract.listingId);

  await startContract(contractId);

  // Open an OS activity so "what's running" surfaces this invocation.
  let activityId: string | null = null;
  await safeEmit(async () => {
    const act = await osStartActivity({
      source: "a2a:invocation",
      sourceRef: contractId,
      title: `A2A: ${listing.name}`,
      subtitle: listing.capability,
      metadata: { listingId: listing.id, contractId },
    });
    activityId = act.id;
  }, "invokeContract osStartActivity");

  const id = uuid();
  const startTs = now();
  await db.insert(a2aInvocations).values({
    id,
    contractId,
    status: "running",
    inputJson: input,
    startedAt: startTs,
    createdAt: startTs,
    updatedAt: startTs,
  });

  try {
    const result = await executor({ contract, listing, input });
    const completedAt = now();
    const durationMs = completedAt.getTime() - startTs.getTime();
    await db
      .update(a2aInvocations)
      .set({
        status: "completed",
        outputJson: result.output,
        completedAt,
        durationMs,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        provider: result.provider ?? null,
        model: result.model ?? null,
        updatedAt: completedAt,
      })
      .where(eq(a2aInvocations.id, id));
    await transitionContract(contractId, "DELIVERED", {}, "invocation completed");
    if (activityId) {
      await safeEmit(
        () =>
          osCompleteActivity(activityId as string, {
            invocationId: id,
            durationMs,
          }),
        "invokeContract osCompleteActivity",
      );
    }
    const provider = await getPrincipal(contract.providerPrincipalId);
    await safeEmit(
      () =>
        emitEvent({
          kind: "a2a.invocation.completed",
          principalDid: provider.did,
          subjectRef: id,
          payload: { contractId, durationMs, model: result.model ?? null },
        }),
      "invokeContract emitEvent",
    );
    return getInvocation(id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(a2aInvocations)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(a2aInvocations.id, id));
    await failContract(contractId, message);
    if (activityId) {
      await safeEmit(
        () => osFailActivity(activityId as string, message),
        "invokeContract osFailActivity",
      );
    }
    throw err;
  }
}

export async function getInvocation(id: string): Promise<A2AInvocationRow> {
  const [row] = await db.select().from(a2aInvocations).where(eq(a2aInvocations.id, id)).limit(1);
  if (!row) throw new Error(`Invocation ${id} not found`);
  return row;
}

export async function listInvocationsForContract(
  contractId: string,
): Promise<A2AInvocationRow[]> {
  return db
    .select()
    .from(a2aInvocations)
    .where(eq(a2aInvocations.contractId, contractId))
    .orderBy(desc(a2aInvocations.createdAt));
}

/**
 * Verify an invocation. `accept` settles the contract; `reject` fails it
 * (and refunds if no later attempt succeeds).
 */
export async function verifyInvocation(
  invocationId: string,
  verdict: "accept" | "reject",
  note?: string,
  evidenceJson?: Record<string, unknown> | null,
): Promise<A2AInvocationRow> {
  const invocation = await getInvocation(invocationId);
  if (invocation.status !== "completed") {
    throw new Error(`Cannot verify invocation in status ${invocation.status}`);
  }
  const contract = await getContract(invocation.contractId);
  if (contract.state !== "DELIVERED") {
    throw new Error(`Cannot verify against contract in state ${contract.state}`);
  }

  const ts = now();
  await db
    .update(a2aInvocations)
    .set({
      status: verdict === "accept" ? "verified" : "rejected",
      verdict,
      verdictNote: note ?? null,
      evidenceJson: evidenceJson ?? null,
      verifiedAt: ts,
      updatedAt: ts,
    })
    .where(eq(a2aInvocations.id, invocationId));

  if (verdict === "accept") {
    await transitionContract(contract.id, "VERIFIED", {}, note ?? "verified");
    await settleContract(contract.id);
    const provider = await getPrincipal(contract.providerPrincipalId);
    await safeEmit(
      () =>
        emitEvent({
          kind: "a2a.invocation.verified",
          principalDid: provider.did,
          subjectRef: invocationId,
          payload: { contractId: contract.id, note: note ?? null },
        }),
      "verifyInvocation emitEvent (accept)",
    );
  } else {
    await failContract(contract.id, note ?? "verification rejected");
    const provider = await getPrincipal(contract.providerPrincipalId);
    await safeEmit(
      () =>
        emitEvent({
          kind: "a2a.invocation.rejected",
          principalDid: provider.did,
          subjectRef: invocationId,
          payload: { contractId: contract.id, note: note ?? null },
        }),
      "verifyInvocation emitEvent (reject)",
    );
    await safeEmit(
      () => recomputeScore(provider.did),
      "verifyInvocation recomputeScore (reject)",
    );
  }
  return getInvocation(invocationId);
}

// =============================================================================
// RECEIPTS  (Celestia, best-effort)
// =============================================================================

/**
 * Build the canonical receipt JSON for an invocation. Deterministic.
 * The receipt is what gets hashed and pinned to Celestia.
 */
export async function buildReceipt(invocationId: string): Promise<{
  receipt: Record<string, unknown>;
  receiptHash: string;
}> {
  const invocation = await getInvocation(invocationId);
  const contract = await getContract(invocation.contractId);
  const caller = await getPrincipal(contract.callerPrincipalId);
  const provider = await getPrincipal(contract.providerPrincipalId);
  const listing = await getListing(contract.listingId);

  const receipt = {
    type: "a2a.invocation.receipt.v1",
    invocationId: invocation.id,
    contractId: contract.id,
    listingId: listing.id,
    capability: listing.capability,
    callerDid: caller.did,
    providerDid: provider.did,
    amount: contract.amount,
    currency: contract.currency,
    inputHash: invocation.inputJson ? sha256Hex(JSON.stringify(invocation.inputJson)) : null,
    outputHash: invocation.outputJson ? sha256Hex(JSON.stringify(invocation.outputJson)) : null,
    durationMs: invocation.durationMs,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
    provider: invocation.provider,
    model: invocation.model,
    verdict: invocation.verdict,
    completedAt: invocation.completedAt?.toISOString() ?? null,
    verifiedAt: invocation.verifiedAt?.toISOString() ?? null,
  };
  const receiptHash = sha256Hex(JSON.stringify(receipt));
  return { receipt, receiptHash };
}

/**
 * Pin the receipt to Celestia. Best-effort: if Celestia isn't available,
 * we still record the hash locally so the invocation has a verifiable digest.
 */
export async function pinReceipt(invocationId: string): Promise<A2AInvocationRow> {
  const { receipt, receiptHash } = await buildReceipt(invocationId);

  let receiptCid: string | null = null;
  let receiptHeight: number | null = null;
  try {
    const submission = await celestiaBlobService.submitJSON(receipt, {
      label: `a2a:invocation:${invocationId}`,
      dataType: "a2a_receipt",
    });
    receiptCid = submission.ipldCid ?? submission.commitment ?? null;
    receiptHeight = submission.height ?? null;
  } catch (err) {
    logger.warn(
      `Celestia pin failed for invocation ${invocationId}; storing hash only:`,
      err instanceof Error ? err.message : err,
    );
  }

  const ts = now();
  await db
    .update(a2aInvocations)
    .set({
      receiptHash,
      receiptCid,
      receiptHeight,
      receiptPinnedAt: ts,
      updatedAt: ts,
    })
    .where(eq(a2aInvocations.id, invocationId));
  return getInvocation(invocationId);
}

// =============================================================================
// EXPORTS for tests
// =============================================================================

export const __test__ = {
  ALLOWED_TRANSITIONS,
  addAmount,
  subAmount,
  gtAmount,
  gteAmount,
  sha256Hex,
  assertTransition,
};

// Suppress unused-import warning for `ssiIdentities` (kept for future linkage queries).
void ssiIdentities;
void drizzleSql;
