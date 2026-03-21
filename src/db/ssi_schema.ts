import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── Self-Sovereign Identity (SSI) Tables ──────────────────────────

export const ssiIdentities = sqliteTable("ssi_identities", {
  did: text("did").primaryKey(),
  identityType: text("identity_type", {
    enum: ["primary", "chat", "federation", "jcn"],
  }).notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatar: text("avatar"),
  didDocumentJson: text("did_document_json", { mode: "json" }).notNull(),
  publicKey: text("public_key"),
  algorithm: text("algorithm", {
    enum: ["ed25519", "secp256k1"],
  }).notNull(),
  linkedToDid: text("linked_to_did"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ssiCredentials = sqliteTable("ssi_credentials", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  issuerDid: text("issuer_did").notNull(),
  subjectDid: text("subject_did").notNull(),
  credentialJson: text("credential_json", { mode: "json" }).notNull(),
  status: text("status", {
    enum: ["active", "revoked", "expired", "suspended"],
  })
    .notNull()
    .default("active"),
  issuedAt: integer("issued_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ssiPresentations = sqliteTable("ssi_presentations", {
  id: text("id").primaryKey(),
  holderDid: text("holder_did").notNull(),
  verifierDid: text("verifier_did"),
  presentationJson: text("presentation_json", { mode: "json" }).notNull(),
  credentialIds: text("credential_ids").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ssiAnchorLog = sqliteTable("ssi_anchor_log", {
  id: text("id").primaryKey(),
  eventType: text("event_type", {
    enum: [
      "created",
      "updated",
      "deactivated",
      "key-rotated",
      "service-added",
      "service-removed",
      "credential-issued",
      "credential-revoked",
      "anchored",
    ],
  }).notNull(),
  did: text("did").notNull(),
  dataHash: text("data_hash").notNull(),
  celestiaHeight: integer("celestia_height"),
  celestiaTxHash: text("celestia_tx_hash"),
  celestiaNamespace: text("celestia_namespace"),
  celestiaCommitment: text("celestia_commitment"),
  anchoredAt: integer("anchored_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
