import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { agentPrincipals } from "./a2a_schema";
import { osIntents } from "./agent_os_schema";

// =============================================================================
// AGENT WALLET & POLICY — TIER 2
//
// Builds the trust+spend layer underneath A2A and the OS shell:
//   1. agent_capabilities — fine-grained capability tokens issued to principals
//      (e.g. "a2a.invoke", "fs.read:./projects/**", "model.chat:gpt-4o").
//      Capabilities can carry conditions and expiry.
//   2. agent_policies     — per-principal rules that the policy evaluator
//      uses to allow / deny / require-confirm a capability+amount.
//   3. signed_intents     — cryptographic signatures attached to OS intents
//      (so we can prove "principal X really did request action Y at time T").
// =============================================================================

export type CapabilityStatus = "active" | "revoked" | "expired";

export type PolicyRuleType =
  | "allow_capability"
  | "deny_capability"
  | "spend_limit"
  | "time_window"
  | "require_human_verify";

export type PolicyStatus = "active" | "disabled";

export type SignedIntentVerification = "pending" | "valid" | "invalid";

export type SignatureAlgorithm = "ed25519" | "secp256k1";

export type WalletCurrency = "JOY" | "TIA" | "USDC" | "MATIC" | "points";

/**
 * AgentCapability — a token granting a principal the right to invoke a
 * specific capability, optionally with conditions (JSON-encoded) and expiry.
 */
export const agentCapabilities = sqliteTable(
  "agent_capabilities",
  {
    id: text("id").primaryKey(), // UUID
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),

    // Capability namespace + verb, e.g. "a2a.invoke", "fs.read", "model.chat".
    capability: text("capability").notNull(),
    // Optional pattern / scope, e.g. "./projects/**" or "gpt-4o".
    scope: text("scope"),

    // Free-form conditions evaluated by the policy engine.
    // Examples: { maxAmount: "100", currency: "USDC", maxCallsPerHour: 10 }.
    conditionsJson: text("conditions_json", { mode: "json" }).$type<
      Record<string, unknown> | null
    >(),

    issuedBy: text("issued_by"), // did or "system"
    issuedAt: integer("issued_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    expiresAt: integer("expires_at", { mode: "timestamp" }),

    status: text("status", {
      enum: ["active", "revoked", "expired"],
    })
      .notNull()
      .default("active"),

    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    revocationReason: text("revocation_reason"),
  },
  (t) => ({
    idxCapPrincipal: index("idx_cap_principal").on(t.principalId),
    idxCapCapability: index("idx_cap_capability").on(t.capability),
    idxCapStatus: index("idx_cap_status").on(t.status),
  }),
);

/**
 * AgentPolicy — a rule attached to a principal that the policy evaluator
 * uses when checking a capability invocation. Rules are evaluated in order;
 * deny wins over allow; spend_limit and time_window add constraints.
 */
export const agentPolicies = sqliteTable(
  "agent_policies",
  {
    id: text("id").primaryKey(), // UUID
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    ruleType: text("rule_type", {
      enum: [
        "allow_capability",
        "deny_capability",
        "spend_limit",
        "time_window",
        "require_human_verify",
      ],
    }).notNull(),

    // Capability glob pattern, e.g. "a2a.*" or "fs.read:./projects/**".
    pattern: text("pattern"),

    // Spend limit fields (only meaningful when ruleType=spend_limit)
    maxAmount: text("max_amount"),
    currency: text("currency", {
      enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
    }),
    windowSeconds: integer("window_seconds"), // rolling window for spend_limit / time_window

    // Time window fields (only meaningful when ruleType=time_window)
    // Stored as 24h clock minutes-from-midnight UTC.
    timeWindowStart: integer("time_window_start"), // 0–1439
    timeWindowEnd: integer("time_window_end"), // 0–1439

    // Evaluation order; lower = earlier.
    priority: integer("priority").notNull().default(100),

    status: text("status", {
      enum: ["active", "disabled"],
    })
      .notNull()
      .default("active"),

    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    idxPolicyPrincipal: index("idx_policy_principal").on(t.principalId),
    idxPolicyStatus: index("idx_policy_status").on(t.status),
    idxPolicyPriority: index("idx_policy_priority").on(t.priority),
  }),
);

/**
 * SignedIntent — a cryptographic signature attached to an OS intent.
 * Lets us later prove a principal really requested an action at a given time.
 */
export const signedIntents = sqliteTable(
  "signed_intents",
  {
    id: text("id").primaryKey(), // UUID
    intentId: text("intent_id")
      .notNull()
      .references(() => osIntents.id, { onDelete: "cascade" }),

    principalDid: text("principal_did").notNull(),
    payloadHash: text("payload_hash").notNull(), // sha256 of canonical payload
    signatureHex: text("signature_hex").notNull(),
    algorithm: text("algorithm", {
      enum: ["ed25519", "secp256k1"],
    })
      .notNull()
      .default("ed25519"),

    signedAt: integer("signed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    verifiedAt: integer("verified_at", { mode: "timestamp" }),
    verificationStatus: text("verification_status", {
      enum: ["pending", "valid", "invalid"],
    })
      .notNull()
      .default("pending"),
    verificationError: text("verification_error"),
  },
  (t) => ({
    idxSignedIntentIntent: index("idx_signed_intent_intent").on(t.intentId),
    idxSignedIntentDid: index("idx_signed_intent_did").on(t.principalDid),
    idxSignedIntentStatus: index(
      "idx_signed_intent_status",
    ).on(t.verificationStatus),
  }),
);

// ── Row types ───────────────────────────────────────────────────────────────

export type AgentCapabilityRow = typeof agentCapabilities.$inferSelect;
export type AgentCapabilityInsert = typeof agentCapabilities.$inferInsert;
export type AgentPolicyRow = typeof agentPolicies.$inferSelect;
export type AgentPolicyInsert = typeof agentPolicies.$inferInsert;
export type SignedIntentRow = typeof signedIntents.$inferSelect;
export type SignedIntentInsert = typeof signedIntents.$inferInsert;
