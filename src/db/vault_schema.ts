import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// =============================================================================
// LOCAL-FIRST DATA VAULT TABLES
// The user's sovereign data refinery: Ingest → Transform → Package → Publish
// =============================================================================

/**
 * Vault Connectors — explicit data ingestion sources the user controls
 */
export const vaultConnectors = sqliteTable("vault_connectors", {
  id: text("id").primaryKey(), // UUID v4
  type: text("type", {
    enum: [
      "file_import",
      "folder_watch",
      "google_takeout",
      "apple_export",
      "slack_export",
      "discord_export",
      "browser_extension",
      "bookmarks_import",
      "history_import",
      "manual_capture",
      "clipboard",
      "api_endpoint",
    ],
  }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", {
    enum: ["disabled", "enabled", "syncing", "paused", "error"],
  })
    .notNull()
    .default("disabled"),

  // Source configuration
  sourcePath: text("source_path"),
  sourceUrl: text("source_url"),
  watchPattern: text("watch_pattern"),

  // Permissions
  autoImport: integer("auto_import", { mode: "boolean" })
    .notNull()
    .default(false),
  requirePreview: integer("require_preview", { mode: "boolean" })
    .notNull()
    .default(true),

  // Filters (JSON)
  allowedMimeTypes: text("allowed_mime_types", { mode: "json" }).$type<
    string[] | null
  >(),
  maxFileSize: integer("max_file_size"),
  excludePatterns: text("exclude_patterns", { mode: "json" }).$type<
    string[] | null
  >(),

  // Schedule
  syncIntervalMinutes: integer("sync_interval_minutes"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  nextSyncAt: integer("next_sync_at", { mode: "timestamp" }),

  // Stats
  totalImported: integer("total_imported").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastError: text("last_error"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Vault Assets — every piece of user data stored in the local vault
 */
export const vaultAssets = sqliteTable("vault_assets", {
  id: text("id").primaryKey(), // UUID v4
  name: text("name").notNull(),
  description: text("description"),
  modality: text("modality", {
    enum: ["text", "image", "audio", "video", "document", "structured", "binary"],
  }).notNull(),
  mimeType: text("mime_type").notNull(),
  status: text("status", {
    enum: [
      "ingested",
      "processing",
      "ready",
      "packaged",
      "published",
      "archived",
      "error",
    ],
  })
    .notNull()
    .default("ingested"),

  // Content addressing
  contentHash: text("content_hash").notNull(), // SHA-256
  byteSize: integer("byte_size").notNull(),
  storagePath: text("storage_path").notNull(),

  // Encryption
  encrypted: integer("encrypted", { mode: "boolean" }).notNull().default(false),
  encryptionKeyId: text("encryption_key_id"),

  // Source tracking
  connectorId: text("connector_id"),
  connectorType: text("connector_type"),
  sourcePath: text("source_path"),
  sourceUrl: text("source_url"),

  // Organization (JSON)
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  collections: text("collections", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),

  // Quality & metadata
  qualityScore: integer("quality_score"), // 0-100
  metadataJson: text("metadata_json", { mode: "json" }).$type<
    Record<string, unknown> | null
  >(),

  // PII detection
  piiDetected: integer("pii_detected", { mode: "boolean" })
    .notNull()
    .default(false),
  piiRedacted: integer("pii_redacted", { mode: "boolean" })
    .notNull()
    .default(false),
  piiFieldsJson: text("pii_fields_json", { mode: "json" }).$type<
    Array<{
      type: string;
      location: string;
      confidence: number;
      redacted: boolean;
      redactionMethod?: string;
    }> | null
  >(),

  // Timestamps
  importedAt: integer("imported_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  processedAt: integer("processed_at", { mode: "timestamp" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Transform Jobs — pipeline runs that clean/label/redact/package user data
 */
export const transformJobs = sqliteTable("transform_jobs", {
  id: text("id").primaryKey(), // UUID v4
  name: text("name").notNull(),

  // What to transform
  inputAssetIds: text("input_asset_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  inputDatasetId: text("input_dataset_id"),

  // Pipeline config (JSON array of stage configs)
  stagesJson: text("stages_json", { mode: "json" })
    .$type<
      Array<{
        stage: string;
        enabled: boolean;
        config: Record<string, unknown>;
      }>
    >()
    .notNull(),
  currentStage: text("current_stage"),

  // Progress
  status: text("status", {
    enum: ["pending", "running", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  progress: integer("progress").notNull().default(0),
  itemsProcessed: integer("items_processed").notNull().default(0),
  itemsTotal: integer("items_total").notNull().default(0),

  // Output
  outputAssetIds: text("output_asset_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  outputDatasetId: text("output_dataset_id"),

  // Errors
  errorMessage: text("error_message"),
  errorCount: integer("error_count").notNull().default(0),

  // Audit trail (JSON)
  auditLogJson: text("audit_log_json", { mode: "json" })
    .$type<
      Array<{
        stage: string;
        action: string;
        inputCount: number;
        outputCount: number;
        droppedCount: number;
        duration_ms: number;
        timestamp: string;
        details?: string;
      }>
    >()
    .notNull()
    .default([]),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * Package Manifests — CID-first packaging for JoyMarketplace publishing
 */
export const packageManifests = sqliteTable("package_manifests", {
  id: text("id").primaryKey(), // UUID v4
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description"),

  // CIDs
  manifestCid: text("manifest_cid"),
  rootCid: text("root_cid"),
  metadataCid: text("metadata_cid"),
  previewCid: text("preview_cid"),
  policyCid: text("policy_cid"),

  // Content
  datasetId: text("dataset_id"),
  chunkCount: integer("chunk_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  chunkCids: text("chunk_cids", { mode: "json" }).$type<string[]>(),

  // Integrity
  merkleRoot: text("merkle_root"),
  integrityHashes: text("integrity_hashes", { mode: "json" }).$type<
    Record<string, string> | null
  >(),

  // Provenance (JSON)
  provenanceJson: text("provenance_json", { mode: "json" }).$type<{
    connectorSources: string[];
    transformStages: string[];
    totalInputItems: number;
    totalOutputItems: number;
    redactedFieldCount: number;
    privacyStatement: string;
  } | null>(),

  // Publisher
  publisherWallet: text("publisher_wallet"),
  publisherSignature: text("publisher_signature"),
  signedAt: integer("signed_at", { mode: "timestamp" }),

  // Encryption
  encrypted: integer("encrypted", { mode: "boolean" }).notNull().default(true),
  encryptionAlgorithm: text("encryption_algorithm").default("aes-256-gcm"),

  // Status
  status: text("status", {
    enum: ["draft", "built", "signed", "published"],
  })
    .notNull()
    .default("draft"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Policy Documents — license/pricing/access policies for published packages
 */
export const policyDocuments = sqliteTable("policy_documents", {
  id: text("id").primaryKey(), // UUID v4
  manifestId: text("manifest_id")
    .notNull()
    .references(() => packageManifests.id, { onDelete: "cascade" }),
  policyCid: text("policy_cid"),

  // License tiers (JSON)
  licenseTiers: text("license_tiers", { mode: "json" })
    .$type<
      Array<{
        tier: string;
        enabled: boolean;
        price?: number;
        currency?: string;
        maxAccesses?: number;
        expirationDays?: number;
        description: string;
      }>
    >()
    .notNull(),

  // Allowed uses & restrictions
  allowedUses: text("allowed_uses", { mode: "json" }).$type<string[]>(),
  restrictions: text("restrictions", { mode: "json" }).$type<string[]>(),

  // Pricing
  pricingModel: text("pricing_model", {
    enum: [
      "free",
      "one_time",
      "subscription",
      "per_use",
      "per_token",
      "pay_what_you_want",
    ],
  })
    .notNull()
    .default("free"),
  priceAmount: integer("price_amount"),
  priceCurrency: text("price_currency"),

  // Sovereign exit
  btcTaprootAddress: text("btc_taproot_address"),
  sovereignExitEnabled: integer("sovereign_exit_enabled", { mode: "boolean" })
    .notNull()
    .default(false),

  // Privacy (encrypted payload only, never raw data)
  privacyStatement: text("privacy_statement")
    .notNull()
    .default("Raw data not shared; encrypted payload only"),
  rawDataShared: integer("raw_data_shared", { mode: "boolean" })
    .notNull()
    .default(false),

  // Publisher
  publisherWallet: text("publisher_wallet"),
  publisherSignature: text("publisher_signature"),
  signedAt: integer("signed_at", { mode: "timestamp" }),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Vault Audit Log — immutable trail of everything the vault does
 */
export const vaultAuditLog = sqliteTable("vault_audit_log", {
  id: text("id").primaryKey(), // UUID v4
  action: text("action", {
    enum: [
      "asset_imported",
      "asset_transformed",
      "asset_redacted",
      "asset_packaged",
      "asset_published",
      "asset_deleted",
      "connector_added",
      "connector_synced",
      "connector_removed",
      "transform_started",
      "transform_completed",
      "transform_failed",
      "package_created",
      "policy_created",
      "bundle_published",
      "vault_unlocked",
      "vault_locked",
      "key_rotated",
      "pii_detected",
      "pii_redacted",
      "access_granted",
      "access_revoked",
    ],
  }).notNull(),
  targetId: text("target_id"),
  targetType: text("target_type"),
  details: text("details"),
  metadataJson: text("metadata_json", { mode: "json" }).$type<
    Record<string, unknown> | null
  >(),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Publish Bundles — the final "send to JoyMarketplace" outputs
 */
export const publishBundles = sqliteTable("publish_bundles", {
  id: text("id").primaryKey(), // UUID v4
  manifestId: text("manifest_id")
    .notNull()
    .references(() => packageManifests.id, { onDelete: "cascade" }),
  policyId: text("policy_id")
    .notNull()
    .references(() => policyDocuments.id, { onDelete: "cascade" }),

  // CIDs
  manifestCid: text("manifest_cid").notNull(),
  policyCid: text("policy_cid").notNull(),
  previewCid: text("preview_cid"),

  // Listing fields
  listingName: text("listing_name").notNull(),
  listingDescription: text("listing_description"),
  listingCategory: text("listing_category"),
  listingTags: text("listing_tags", { mode: "json" }).$type<string[]>(),
  listingPreviewUrl: text("listing_preview_url"),
  listingLicense: text("listing_license"),
  listingPricingModel: text("listing_pricing_model"),
  listingPrice: integer("listing_price"),
  listingCurrency: text("listing_currency"),

  // Marketplace references
  thirdwebListingId: text("thirdweb_listing_id"),
  polygonContractAddress: text("polygon_contract_address"),
  marketplaceAssetId: text("marketplace_asset_id"),

  // Publisher
  publisherWallet: text("publisher_wallet").notNull(),
  publisherSignature: text("publisher_signature").notNull(),

  // Status
  status: text("status", {
    enum: ["draft", "ready", "submitted", "listed", "delisted"],
  })
    .notNull()
    .default("draft"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---- Relations ----

export const vaultConnectorsRelations = relations(
  vaultConnectors,
  ({ many }) => ({
    assets: many(vaultAssets),
  }),
);

export const vaultAssetsRelations = relations(vaultAssets, ({ one }) => ({
  connector: one(vaultConnectors, {
    fields: [vaultAssets.connectorId],
    references: [vaultConnectors.id],
  }),
}));

export const packageManifestsRelations = relations(
  packageManifests,
  ({ one, many }) => ({
    policy: one(policyDocuments),
    bundles: many(publishBundles),
  }),
);

export const policyDocumentsRelations = relations(
  policyDocuments,
  ({ one }) => ({
    manifest: one(packageManifests, {
      fields: [policyDocuments.manifestId],
      references: [packageManifests.id],
    }),
  }),
);

export const publishBundlesRelations = relations(publishBundles, ({ one }) => ({
  manifest: one(packageManifests, {
    fields: [publishBundles.manifestId],
    references: [packageManifests.id],
  }),
  policy: one(policyDocuments, {
    fields: [publishBundles.policyId],
    references: [policyDocuments.id],
  }),
}));
