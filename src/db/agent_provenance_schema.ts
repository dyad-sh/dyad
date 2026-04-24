import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// =============================================================================
// AGENT PROVENANCE & REPUTATION — TIER 4
//
// Three primitives:
//   1. provenance_events  — append-only, optionally signed + pinned activity
//      feed across the OS. Every interesting state change emits an event.
//   2. reputation_scores  — per-principal rollup derived from events.
//      Refreshed on demand via the engine's `recomputeScore()`.
//   3. slash_records      — explicit penalties recorded against a principal
//      (slashed escrow, governance fines, manual demotions). Reduces score.
// =============================================================================

export type ProvenanceKind =
  | "a2a.contract.escrowed"
  | "a2a.contract.settled"
  | "a2a.contract.refunded"
  | "a2a.contract.failed"
  | "a2a.invocation.completed"
  | "a2a.invocation.verified"
  | "a2a.invocation.rejected"
  | "os.intent.signed"
  | "os.intent.completed"
  | "wallet.capability.issued"
  | "wallet.capability.revoked"
  | "wallet.policy.denied"
  | "reputation.slashed"
  | "reputation.recomputed"
  | "external";

export type SlashStatus = "proposed" | "active" | "reversed";

export type ProvenanceCurrency =
  | "JOY"
  | "TIA"
  | "USDC"
  | "MATIC"
  | "points";

/**
 * ProvenanceEvent — append-only feed of significant agent OS events.
 *
 * The combination of `payloadHash + signatureHex + ipldCid` makes events
 * trustless: anyone with the public key can verify the row matches what
 * was sealed onto Celestia at `height`.
 */
export const provenanceEvents = sqliteTable(
  "provenance_events",
  {
    id: text("id").primaryKey(), // UUID
    principalDid: text("principal_did").notNull(),
    kind: text("kind", {
      enum: [
        "a2a.contract.escrowed",
        "a2a.contract.settled",
        "a2a.contract.refunded",
        "a2a.contract.failed",
        "a2a.invocation.completed",
        "a2a.invocation.verified",
        "a2a.invocation.rejected",
        "os.intent.signed",
        "os.intent.completed",
        "wallet.capability.issued",
        "wallet.capability.revoked",
        "wallet.policy.denied",
        "reputation.slashed",
        "reputation.recomputed",
        "external",
      ],
    }).notNull(),

    // Free-form id of the underlying record (e.g. contract id, intent id).
    subjectRef: text("subject_ref"),

    payloadJson: text("payload_json", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    payloadHash: text("payload_hash").notNull(), // sha256 of canonical payload

    // Optional cryptographic signature. Issuer DID may differ from principalDid
    // (e.g. system events signed by the OS root identity).
    issuerDid: text("issuer_did"),
    signatureHex: text("signature_hex"),
    algorithm: text("algorithm"), // "ed25519" | "secp256k1"

    // Optional Celestia pinning result.
    ipldCid: text("ipld_cid"),
    height: integer("height"),
    sealedAt: integer("sealed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    idxProvDid: index("idx_prov_did").on(t.principalDid),
    idxProvKind: index("idx_prov_kind").on(t.kind),
    idxProvCreated: index("idx_prov_created").on(t.createdAt),
    idxProvSubject: index("idx_prov_subject").on(t.subjectRef),
  }),
);

/**
 * ReputationScore — rollup per principal DID. One row per DID.
 * `successRate` is in tenths of a percent (0–1000) so we can store it as int.
 */
export const reputationScores = sqliteTable(
  "reputation_scores",
  {
    principalDid: text("principal_did").primaryKey(),

    // A2A counters
    totalContracts: integer("total_contracts").notNull().default(0),
    settledContracts: integer("settled_contracts").notNull().default(0),
    failedContracts: integer("failed_contracts").notNull().default(0),
    refundedContracts: integer("refunded_contracts").notNull().default(0),
    totalInvocations: integer("total_invocations").notNull().default(0),
    verifiedInvocations: integer("verified_invocations").notNull().default(0),
    rejectedInvocations: integer("rejected_invocations").notNull().default(0),

    // Money totals (decimal strings; per-currency split lives in the events feed)
    totalEarnedString: text("total_earned_string").notNull().default("0"),
    totalSlashedString: text("total_slashed_string").notNull().default("0"),
    primaryCurrency: text("primary_currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    }),

    // Derived score (0–1000 success-rate-style)
    successRate: integer("success_rate").notNull().default(0),

    lastEventAt: integer("last_event_at", { mode: "timestamp" }),
    lastComputedAt: integer("last_computed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    idxRepRate: index("idx_rep_rate").on(t.successRate),
  }),
);

/**
 * SlashRecord — explicit penalty. Reduces score and is shown on the principal page.
 */
export const slashRecords = sqliteTable(
  "slash_records",
  {
    id: text("id").primaryKey(), // UUID
    principalDid: text("principal_did").notNull(),

    reason: text("reason").notNull(),
    amount: text("amount").notNull().default("0"), // decimal string
    currency: text("currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    }),

    contractId: text("contract_id"), // optional link to A2A contract
    evidenceJson: text("evidence_json", { mode: "json" }).$type<
      Record<string, unknown> | null
    >(),

    status: text("status", {
      enum: ["proposed", "active", "reversed"],
    })
      .notNull()
      .default("proposed"),

    createdBy: text("created_by"), // did or "system"
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    activatedAt: integer("activated_at", { mode: "timestamp" }),
    reversedAt: integer("reversed_at", { mode: "timestamp" }),
    reversalReason: text("reversal_reason"),
  },
  (t) => ({
    idxSlashDid: index("idx_slash_did").on(t.principalDid),
    idxSlashStatus: index("idx_slash_status").on(t.status),
  }),
);

// ── Row types ───────────────────────────────────────────────────────────────

export type ProvenanceEventRow = typeof provenanceEvents.$inferSelect;
export type ProvenanceEventInsert = typeof provenanceEvents.$inferInsert;
export type ReputationScoreRow = typeof reputationScores.$inferSelect;
export type ReputationScoreInsert = typeof reputationScores.$inferInsert;
export type SlashRecordRow = typeof slashRecords.$inferSelect;
export type SlashRecordInsert = typeof slashRecords.$inferInsert;
