import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, unique } from "drizzle-orm/sqlite-core";
import { agents } from "./schema";

// =============================================================================
// AGENT-TO-AGENT (A2A) ECONOMY TABLES
//
// Promotes each agent to an economic principal with a DID and budget,
// lets agents publish service listings, request/accept quotes, escrow
// payment, invoke each other, and pin trustless receipts to Celestia.
//
// Money flow reuses `rewards_ledger` (no new ledger primitive).
// Provenance reuses `celestia:blob:*` handlers (no new pinning primitive).
// =============================================================================

/**
 * AgentPrincipal — the economic identity of an agent.
 * One row per `agents.id`. Carries the SSI DID and budget caps.
 */
export const agentPrincipals = sqliteTable(
  "agent_principals",
  {
    id: text("id").primaryKey(), // UUID v4
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    // Identity
    did: text("did").notNull().unique(), // FK-by-convention to ssi_identities.did
    payoutWallet: text("payout_wallet"), // 0x… or other on-chain address
    publicKey: text("public_key"), // mirrors ssi_identities.public_key for fast lookup

    // Budget caps (string for precision; "0" = no spend allowed)
    dailyCap: text("daily_cap").notNull().default("0"),
    perTaskCap: text("per_task_cap").notNull().default("0"),
    currency: text("currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    })
      .notNull()
      .default("USDC"),

    // Lifecycle
    status: text("status", {
      enum: ["active", "suspended", "revoked"],
    })
      .notNull()
      .default("active"),

    // Counters (denormalised for fast budget checks; authoritative ledger is rewards_ledger)
    spentTodayString: text("spent_today_string").notNull().default("0"),
    spentTodayResetAt: integer("spent_today_reset_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    agentIdx: unique("uniq_agent_principal_agent").on(table.agentId),
    statusIdx: index("idx_agent_principal_status").on(table.status),
  }),
);

/**
 * AgentServiceListing — what an agent offers in the A2A marketplace.
 * Mirrors the shape of `workflowListings` but with pricing + I/O schema.
 */
export const agentServiceListings = sqliteTable(
  "agent_service_listings",
  {
    id: text("id").primaryKey(), // UUID v4
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),

    // What
    name: text("name").notNull(),
    description: text("description"),
    capability: text("capability").notNull(), // e.g. "summarise.text", "image.generate", "data.scrape"
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),

    // Pricing
    pricingModel: text("pricing_model", {
      enum: ["free", "fixed", "per_token", "per_call", "subscription"],
    })
      .notNull()
      .default("fixed"),
    priceAmount: text("price_amount").notNull().default("0"), // string for precision
    currency: text("currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    })
      .notNull()
      .default("USDC"),

    // SLA hints (advisory, not enforced)
    maxLatencyMs: integer("max_latency_ms"),
    successRatePromised: integer("success_rate_promised"), // 0-1000 (per mille)

    // Schemas (JSON Schema-ish; opaque to the engine)
    inputSchemaJson: text("input_schema_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    outputSchemaJson: text("output_schema_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

    // Lifecycle
    status: text("status", {
      enum: ["draft", "active", "paused", "retired"],
    })
      .notNull()
      .default("draft"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    principalIdx: index("idx_listing_principal").on(table.principalId),
    capabilityIdx: index("idx_listing_capability").on(table.capability),
    statusIdx: index("idx_listing_status").on(table.status),
  }),
);

/**
 * A2AQuote — a caller-requested quote against a listing.
 * Short-lived; either accepted (→ contract) or expires.
 */
export const a2aQuotes = sqliteTable(
  "a2a_quotes",
  {
    id: text("id").primaryKey(), // UUID v4
    listingId: text("listing_id")
      .notNull()
      .references(() => agentServiceListings.id, { onDelete: "cascade" }),
    callerPrincipalId: text("caller_principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),

    // The asked-for work
    inputSummary: text("input_summary"), // human-readable
    inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    estimatedTokens: integer("estimated_tokens"),

    // The quote itself (frozen at request time from listing pricing)
    quotedAmount: text("quoted_amount").notNull(),
    quotedCurrency: text("quoted_currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    }).notNull(),
    quotedLatencyMs: integer("quoted_latency_ms"),

    status: text("status", {
      enum: ["pending", "accepted", "rejected", "expired"],
    })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    listingIdx: index("idx_quote_listing").on(table.listingId),
    callerIdx: index("idx_quote_caller").on(table.callerPrincipalId),
    statusIdx: index("idx_quote_status").on(table.status),
  }),
);

/**
 * A2AContract — the accepted, escrowed agreement between two principals.
 *
 * State machine:
 *   ACCEPTED → ESCROWED → IN_PROGRESS → DELIVERED → VERIFIED → SETTLED → CLOSED
 *                                       │
 *                                       ├─ FAILED ─→ REFUNDED
 *                                       └─ DISPUTED ─→ (SETTLED|REFUNDED)
 */
export const a2aContracts = sqliteTable(
  "a2a_contracts",
  {
    id: text("id").primaryKey(), // UUID v4
    quoteId: text("quote_id")
      .notNull()
      .references(() => a2aQuotes.id, { onDelete: "restrict" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => agentServiceListings.id, { onDelete: "restrict" }),
    callerPrincipalId: text("caller_principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "restrict" }),
    providerPrincipalId: text("provider_principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "restrict" }),

    state: text("state", {
      enum: [
        "ACCEPTED",
        "ESCROWED",
        "IN_PROGRESS",
        "DELIVERED",
        "VERIFIED",
        "SETTLED",
        "CLOSED",
        "FAILED",
        "DISPUTED",
        "REFUNDED",
      ],
    })
      .notNull()
      .default("ACCEPTED"),
    stateHistoryJson: text("state_history_json", { mode: "json" })
      .$type<Array<{ state: string; at: number; note?: string }>>()
      .notNull()
      .default([]),

    // Frozen pricing
    amount: text("amount").notNull(),
    currency: text("currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    }).notNull(),

    // Escrow link → rewards_ledger.id (the row holding the funds in pending state)
    escrowLedgerId: text("escrow_ledger_id"),

    // Failure / dispute
    failureReason: text("failure_reason"),
    disputeReason: text("dispute_reason"),
    resolutionNote: text("resolution_note"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    settledAt: integer("settled_at", { mode: "timestamp" }),
  },
  (table) => ({
    callerIdx: index("idx_contract_caller").on(table.callerPrincipalId),
    providerIdx: index("idx_contract_provider").on(table.providerPrincipalId),
    stateIdx: index("idx_contract_state").on(table.state),
  }),
);

/**
 * A2AInvocation — each actual execution under a contract.
 * One contract may have multiple invocations (e.g. retries) but only one
 * VERIFIED invocation triggers settlement.
 */
export const a2aInvocations = sqliteTable(
  "a2a_invocations",
  {
    id: text("id").primaryKey(), // UUID v4
    contractId: text("contract_id")
      .notNull()
      .references(() => a2aContracts.id, { onDelete: "cascade" }),

    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "verified", "rejected"],
    })
      .notNull()
      .default("queued"),

    inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    outputJson: text("output_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    errorMessage: text("error_message"),

    // Execution metrics
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    provider: text("provider"), // ollama | anthropic | openai | …
    model: text("model"),

    // Verification
    verifiedAt: integer("verified_at", { mode: "timestamp" }),
    verdict: text("verdict", { enum: ["accept", "reject"] }),
    verdictNote: text("verdict_note"),
    evidenceJson: text("evidence_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

    // Trustless receipt (Celestia)
    receiptHash: text("receipt_hash"),
    receiptCid: text("receipt_cid"),
    receiptHeight: integer("receipt_height"),
    receiptPinnedAt: integer("receipt_pinned_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    contractIdx: index("idx_invocation_contract").on(table.contractId),
    statusIdx: index("idx_invocation_status").on(table.status),
  }),
);

// ── Inferred row types for use in the engine + handlers ──────────────────
export type AgentPrincipalRow = typeof agentPrincipals.$inferSelect;
export type AgentServiceListingRow = typeof agentServiceListings.$inferSelect;
export type A2AQuoteRow = typeof a2aQuotes.$inferSelect;
export type A2AContractRow = typeof a2aContracts.$inferSelect;
export type A2AInvocationRow = typeof a2aInvocations.$inferSelect;

export type A2ACurrency = "JOY" | "TIA" | "USDC" | "MATIC" | "points";
export type A2AContractState = A2AContractRow["state"];
export type A2AInvocationStatus = A2AInvocationRow["status"];
