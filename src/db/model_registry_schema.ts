/**
 * Decentralized Model Registry — Schema
 * Tracks published models, versions, community ratings, and peer discovery.
 */

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// =============================================================================
// MODEL REGISTRY ENTRIES
// Published model/adapter metadata with content-addressed references
// =============================================================================

export const modelRegistryEntries = sqliteTable("model_registry_entries", {
  id: text("id").primaryKey(), // UUID v4

  // Identity
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull(), // semver
  family: text("family").notNull(), // llama, mistral, qwen, etc.
  author: text("author").notNull(), // wallet address or display name

  // Model type
  modelType: text("model_type", {
    enum: ["base", "fine_tuned", "merged", "quantized"],
  }).notNull(),

  // Adapter info (for fine-tuned models)
  baseModelId: text("base_model_id"), // references parent base model
  adapterType: text("adapter_type", {
    enum: ["lora", "qlora", "full"],
  }),
  adapterRank: integer("adapter_rank"),
  adapterAlpha: integer("adapter_alpha"),

  // Content-addressed references
  bundleCid: text("bundle_cid"), // IPFS CID of the full bundle
  manifestCid: text("manifest_cid"), // CID of the manifest
  manifestHash: text("manifest_hash"), // SHA-256 of manifest
  merkleRoot: text("merkle_root"), // Merkle root of all chunks
  contentHash: text("content_hash").notNull(), // SHA-256 of model weights

  // Celestia DA attestation
  celestiaHeight: integer("celestia_height"),
  celestiaCommitment: text("celestia_commitment"),

  // Model metrics
  parameters: integer("parameters"), // parameter count
  contextLength: integer("context_length"),
  quantization: text("quantization"), // Q4_K_M, Q5_K_S, etc.
  fileSizeBytes: integer("file_size_bytes"),
  format: text("format"), // gguf, safetensors, etc.

  // Capabilities (JSON)
  capabilitiesJson: text("capabilities_json", { mode: "json" }).$type<{
    textGeneration?: boolean;
    chat?: boolean;
    codeGeneration?: boolean;
    embedding?: boolean;
    functionCalling?: boolean;
    vision?: boolean;
    audio?: boolean;
  }>(),

  // Runtime requirements (JSON)
  runtimeJson: text("runtime_json", { mode: "json" }).$type<{
    minMemoryMb?: number;
    minCpuCores?: number;
    gpuRequired?: boolean;
    gpuMemoryMb?: number;
  }>(),

  // Training provenance (JSON — for fine-tuned models)
  provenanceJson: text("provenance_json", { mode: "json" }).$type<{
    datasetId?: string;
    datasetName?: string;
    trainingPairs?: number;
    epochs?: number;
    learningRate?: number;
    trainingMethod?: string;
    flywheelRunId?: number;
    receiptCid?: string;
  }>(),

  // License
  license: text("license").notNull().default("Apache-2.0"),
  licenseUrl: text("license_url"),

  // Publishing state
  publishState: text("publish_state", {
    enum: ["local", "pinned", "attested", "published", "delisted"],
  }).notNull().default("local"),

  // Source — where did this entry come from?
  source: text("source", {
    enum: ["local", "peer", "marketplace"],
  }).notNull().default("local"),

  // Peer info (for remotely discovered models)
  sourcePeerId: text("source_peer_id"),
  discoveredAt: integer("discovered_at", { mode: "timestamp" }),

  // Marketplace link
  marketplaceAssetId: text("marketplace_asset_id"),
  nftTokenId: text("nft_token_id"),
  nftContract: text("nft_contract"),

  // Aggregated quality scores (updated from peer ratings)
  avgRating: integer("avg_rating"), // 0-100
  totalRatings: integer("total_ratings").notNull().default(0),
  downloadCount: integer("download_count").notNull().default(0),
  usageCount: integer("usage_count").notNull().default(0),

  // Tags
  tags: text("tags", { mode: "json" }).$type<string[]>(),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  unique("model_registry_name_version").on(table.name, table.version),
]);

// =============================================================================
// MODEL REGISTRY RATINGS
// Per-model quality ratings from local MAB signals + peer reviews
// =============================================================================

export const modelRegistryRatings = sqliteTable("model_registry_ratings", {
  id: text("id").primaryKey(), // UUID v4

  // Which model
  modelEntryId: text("model_entry_id")
    .notNull()
    .references(() => modelRegistryEntries.id, { onDelete: "cascade" }),

  // Who rated
  raterId: text("rater_id").notNull(), // wallet, peer ID, or "local"
  raterType: text("rater_type", {
    enum: ["local_mab", "peer", "benchmark", "user"],
  }).notNull(),

  // Rating
  score: integer("score").notNull(), // 0-100
  dimension: text("dimension", {
    enum: ["overall", "accuracy", "speed", "coherence", "code_quality", "safety"],
  }).notNull().default("overall"),

  // Evidence
  evidenceJson: text("evidence_json", { mode: "json" }).$type<{
    mabAlpha?: number;
    mabBeta?: number;
    sampleCount?: number;
    benchmarkName?: string;
    benchmarkScore?: number;
    comment?: string;
  }>(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  unique("rating_model_rater_dimension").on(
    table.modelEntryId,
    table.raterId,
    table.dimension,
  ),
]);

// =============================================================================
// MODEL REGISTRY PEERS
// Tracks known peers serving model registry entries
// =============================================================================

export const modelRegistryPeers = sqliteTable("model_registry_peers", {
  id: text("id").primaryKey(), // peer ID (libp2p)

  // Peer info
  displayName: text("display_name"),
  wallet: text("wallet"),
  multiaddrs: text("multiaddrs", { mode: "json" }).$type<string[]>(),

  // Connectivity
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  latencyMs: integer("latency_ms"),
  isOnline: integer("is_online", { mode: "boolean" }).notNull().default(false),

  // Trust
  trustScore: integer("trust_score").notNull().default(50), // 0-100
  modelsShared: integer("models_shared").notNull().default(0),
  successfulTransfers: integer("successful_transfers").notNull().default(0),
  failedTransfers: integer("failed_transfers").notNull().default(0),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// =============================================================================
// MODEL REGISTRY DOWNLOADS
// Tracks download status for remote models being fetched
// =============================================================================

export const modelRegistryDownloads = sqliteTable("model_registry_downloads", {
  id: text("id").primaryKey(), // UUID v4

  modelEntryId: text("model_entry_id")
    .notNull()
    .references(() => modelRegistryEntries.id, { onDelete: "cascade" }),

  // Download state
  status: text("status", {
    enum: ["queued", "downloading", "verifying", "completed", "failed", "cancelled"],
  }).notNull().default("queued"),

  // Progress
  bytesDownloaded: integer("bytes_downloaded").notNull().default(0),
  totalBytes: integer("total_bytes").notNull(),
  chunksCompleted: integer("chunks_completed").notNull().default(0),
  totalChunks: integer("total_chunks").notNull().default(1),
  progress: integer("progress").notNull().default(0), // 0-100

  // Source
  sourcePeerId: text("source_peer_id"),
  sourceUrl: text("source_url"),

  // Verification
  hashVerified: integer("hash_verified", { mode: "boolean" }),
  merkleVerified: integer("merkle_verified", { mode: "boolean" }),

  // Local path (once downloaded)
  localPath: text("local_path"),

  // Error
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),

  // Timestamps
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// =============================================================================
// RELATIONS
// =============================================================================

export const modelRegistryEntriesRelations = relations(
  modelRegistryEntries,
  ({ many }) => ({
    ratings: many(modelRegistryRatings),
    downloads: many(modelRegistryDownloads),
  }),
);

export const modelRegistryRatingsRelations = relations(
  modelRegistryRatings,
  ({ one }) => ({
    modelEntry: one(modelRegistryEntries, {
      fields: [modelRegistryRatings.modelEntryId],
      references: [modelRegistryEntries.id],
    }),
  }),
);

export const modelRegistryDownloadsRelations = relations(
  modelRegistryDownloads,
  ({ one }) => ({
    modelEntry: one(modelRegistryEntries, {
      fields: [modelRegistryDownloads.modelEntryId],
      references: [modelRegistryEntries.id],
    }),
  }),
);
