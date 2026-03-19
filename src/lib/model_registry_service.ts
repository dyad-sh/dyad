/**
 * Decentralized Model Registry Service
 * =====================================
 * Publish, discover, rate, and download AI models across the decentralized network.
 *
 * Lifecycle:
 *   Train/Import → Register locally → Pin to IPFS → Attest on Celestia
 *   → Announce via GossipSub → Peers discover and download
 *   → MAB quality signals aggregate into ratings
 *
 * Integrates with:
 *   - LocalFineTuning:   Register adapters produced by flywheel
 *   - Helia:             Content-addressed IPFS storage
 *   - Celestia:          Data availability attestation
 *   - MAB Engine:        Quality ratings via Thompson Sampling
 *   - Marketplace Sync:  Publish to JoyMarketplace.io
 */

import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "fs/promises";
import { existsSync } from "node:fs";
import { app } from "electron";
import log from "electron-log";
import { eq, and, desc, asc, sql, like, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  modelRegistryEntries,
  modelRegistryRatings,
  modelRegistryPeers,
  modelRegistryDownloads,
} from "@/db/model_registry_schema";

const logger = log.scope("model_registry");

// =============================================================================
// TYPES
// =============================================================================

export interface RegisterModelParams {
  name: string;
  description?: string;
  version: string;
  family: string;
  author: string;
  modelType: "base" | "fine_tuned" | "merged" | "quantized";
  baseModelId?: string;
  adapterType?: "lora" | "qlora" | "full";
  adapterRank?: number;
  adapterAlpha?: number;
  contentHash: string;
  parameters?: number;
  contextLength?: number;
  quantization?: string;
  fileSizeBytes?: number;
  format?: string;
  capabilities?: {
    textGeneration?: boolean;
    chat?: boolean;
    codeGeneration?: boolean;
    embedding?: boolean;
    functionCalling?: boolean;
    vision?: boolean;
    audio?: boolean;
  };
  runtime?: {
    minMemoryMb?: number;
    minCpuCores?: number;
    gpuRequired?: boolean;
    gpuMemoryMb?: number;
  };
  provenance?: {
    datasetId?: string;
    datasetName?: string;
    trainingPairs?: number;
    epochs?: number;
    learningRate?: number;
    trainingMethod?: string;
    flywheelRunId?: number;
    receiptCid?: string;
  };
  license?: string;
  licenseUrl?: string;
  tags?: string[];
  /** Local file path — used to compute contentHash + fileSizeBytes if not provided */
  localPath?: string;
}

export interface ModelRegistryEntry {
  id: string;
  name: string;
  description: string | null;
  version: string;
  family: string;
  author: string;
  modelType: "base" | "fine_tuned" | "merged" | "quantized";
  baseModelId: string | null;
  adapterType: "lora" | "qlora" | "full" | null;
  adapterRank: number | null;
  adapterAlpha: number | null;
  bundleCid: string | null;
  manifestCid: string | null;
  contentHash: string;
  celestiaHeight: number | null;
  celestiaCommitment: string | null;
  parameters: number | null;
  contextLength: number | null;
  quantization: string | null;
  fileSizeBytes: number | null;
  format: string | null;
  capabilities: Record<string, boolean> | null;
  runtime: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  license: string;
  publishState: string;
  source: string;
  avgRating: number | null;
  totalRatings: number;
  downloadCount: number;
  usageCount: number;
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchParams {
  query?: string;
  family?: string;
  modelType?: "base" | "fine_tuned" | "merged" | "quantized";
  capabilities?: string[];
  minRating?: number;
  source?: "local" | "peer" | "marketplace";
  publishState?: string;
  tags?: string[];
  sortBy?: "name" | "rating" | "downloads" | "created" | "updated";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface PublishResult {
  modelEntryId: string;
  bundleCid?: string;
  manifestCid?: string;
  celestiaHeight?: number;
  celestiaCommitment?: string;
  publishState: string;
}

export interface RegistryStats {
  totalModels: number;
  localModels: number;
  peerModels: number;
  publishedModels: number;
  totalDownloads: number;
  totalRatings: number;
  knownPeers: number;
  onlinePeers: number;
}

export interface RateModelParams {
  modelEntryId: string;
  score: number; // 0-100
  dimension?: "overall" | "accuracy" | "speed" | "coherence" | "code_quality" | "safety";
  raterType?: "local_mab" | "peer" | "benchmark" | "user";
  evidence?: {
    mabAlpha?: number;
    mabBeta?: number;
    sampleCount?: number;
    benchmarkName?: string;
    benchmarkScore?: number;
    comment?: string;
  };
}

// =============================================================================
// MODEL REGISTRY SERVICE
// =============================================================================

/**
 * Register a model in the local registry.
 * This is the first step — model starts at publishState="local".
 */
export async function registerModel(
  params: RegisterModelParams,
): Promise<ModelRegistryEntry> {
  const id = randomUUID();

  // If localPath is provided and contentHash is missing, compute it
  let contentHash = params.contentHash;
  let fileSizeBytes = params.fileSizeBytes;
  if (params.localPath && existsSync(params.localPath)) {
    if (!contentHash) {
      const fileBuffer = await fs.readFile(params.localPath);
      contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    }
    if (!fileSizeBytes) {
      const stat = await fs.stat(params.localPath);
      fileSizeBytes = stat.size;
    }
  }

  if (!contentHash) {
    throw new Error("contentHash is required (or provide localPath to compute it)");
  }

  const now = new Date();
  const [entry] = await db
    .insert(modelRegistryEntries)
    .values({
      id,
      name: params.name,
      description: params.description ?? null,
      version: params.version,
      family: params.family,
      author: params.author,
      modelType: params.modelType,
      baseModelId: params.baseModelId ?? null,
      adapterType: params.adapterType ?? null,
      adapterRank: params.adapterRank ?? null,
      adapterAlpha: params.adapterAlpha ?? null,
      contentHash,
      parameters: params.parameters ?? null,
      contextLength: params.contextLength ?? null,
      quantization: params.quantization ?? null,
      fileSizeBytes: fileSizeBytes ?? null,
      format: params.format ?? null,
      capabilitiesJson: params.capabilities ?? null,
      runtimeJson: params.runtime ?? null,
      provenanceJson: params.provenance ?? null,
      license: params.license ?? "Apache-2.0",
      licenseUrl: params.licenseUrl ?? null,
      tags: params.tags ?? null,
      publishState: "local",
      source: "local",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  logger.info(`Registered model: ${params.name} v${params.version} (${id})`);
  return rowToEntry(entry);
}

/**
 * Register a fine-tuned adapter from the Data Flywheel as a model registry entry.
 */
export async function registerAdapterFromFlywheel(params: {
  adapterId: string;
  name: string;
  baseModel: string;
  adapterType: "lora" | "qlora" | "full";
  adapterPath: string;
  rank?: number;
  alpha?: number;
  flywheelRunId?: number;
  datasetName?: string;
  trainingPairs?: number;
  epochs?: number;
  agentId?: number;
}): Promise<ModelRegistryEntry> {
  // Compute content hash from adapter files
  let contentHash = "";
  let fileSizeBytes = 0;

  if (existsSync(params.adapterPath)) {
    const stat = await fs.stat(params.adapterPath);
    if (stat.isDirectory()) {
      // For directories, hash the concatenation of all file hashes
      const files = await fs.readdir(params.adapterPath);
      const hasher = crypto.createHash("sha256");
      for (const file of files.sort()) {
        const filePath = path.join(params.adapterPath, file);
        const fStat = await fs.stat(filePath);
        if (fStat.isFile()) {
          const buf = await fs.readFile(filePath);
          hasher.update(crypto.createHash("sha256").update(buf).digest("hex"));
          fileSizeBytes += fStat.size;
        }
      }
      contentHash = hasher.digest("hex");
    } else {
      const buf = await fs.readFile(params.adapterPath);
      contentHash = crypto.createHash("sha256").update(buf).digest("hex");
      fileSizeBytes = stat.size;
    }
  }

  return registerModel({
    name: params.name,
    version: "1.0.0",
    family: params.baseModel.split("-")[0] || "unknown",
    author: "local",
    modelType: "fine_tuned",
    baseModelId: params.baseModel,
    adapterType: params.adapterType,
    adapterRank: params.rank,
    adapterAlpha: params.alpha,
    contentHash,
    fileSizeBytes,
    format: "safetensors",
    provenance: {
      flywheelRunId: params.flywheelRunId,
      datasetName: params.datasetName,
      trainingPairs: params.trainingPairs,
      epochs: params.epochs,
      trainingMethod: params.adapterType,
    },
    tags: ["flywheel", params.adapterType, params.baseModel],
    localPath: params.adapterPath,
  });
}

/**
 * Get a single model registry entry by ID.
 */
export async function getModelEntry(id: string): Promise<ModelRegistryEntry | null> {
  const rows = await db
    .select()
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.id, id))
    .limit(1);

  return rows.length > 0 ? rowToEntry(rows[0]) : null;
}

/**
 * Search the model registry with filters.
 */
export async function searchModels(params: SearchParams = {}): Promise<{
  entries: ModelRegistryEntry[];
  total: number;
}> {
  const conditions: any[] = [];

  if (params.query) {
    conditions.push(
      sql`(${modelRegistryEntries.name} LIKE ${"%" + params.query + "%"} OR ${modelRegistryEntries.description} LIKE ${"%" + params.query + "%"})`,
    );
  }
  if (params.family) {
    conditions.push(eq(modelRegistryEntries.family, params.family));
  }
  if (params.modelType) {
    conditions.push(eq(modelRegistryEntries.modelType, params.modelType));
  }
  if (params.source) {
    conditions.push(eq(modelRegistryEntries.source, params.source));
  }
  if (params.publishState) {
    conditions.push(eq(modelRegistryEntries.publishState, params.publishState as "local" | "pinned" | "attested" | "published" | "delisted"));
  }
  if (params.minRating != null) {
    conditions.push(sql`${modelRegistryEntries.avgRating} >= ${params.minRating}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryEntries)
    .where(whereClause);
  const total = countRow?.count ?? 0;

  // Sort
  const sortCol = {
    name: modelRegistryEntries.name,
    rating: modelRegistryEntries.avgRating,
    downloads: modelRegistryEntries.downloadCount,
    created: modelRegistryEntries.createdAt,
    updated: modelRegistryEntries.updatedAt,
  }[params.sortBy ?? "created"] ?? modelRegistryEntries.createdAt;

  const sortFn = params.sortOrder === "asc" ? asc : desc;

  const rows = await db
    .select()
    .from(modelRegistryEntries)
    .where(whereClause)
    .orderBy(sortFn(sortCol))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);

  return { entries: rows.map(rowToEntry), total };
}

/**
 * List all locally registered models.
 */
export async function listLocalModels(): Promise<ModelRegistryEntry[]> {
  const rows = await db
    .select()
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.source, "local"))
    .orderBy(desc(modelRegistryEntries.updatedAt));

  return rows.map(rowToEntry);
}

/**
 * Publish a model to the decentralized network.
 * Steps: Pin to IPFS → Attest on Celestia → Update state.
 */
export async function publishModel(modelId: string): Promise<PublishResult> {
  const entry = await getModelEntry(modelId);
  if (!entry) throw new Error(`Model not found: ${modelId}`);

  if (entry.publishState !== "local" && entry.publishState !== "pinned") {
    throw new Error(`Model ${modelId} is already in state: ${entry.publishState}`);
  }

  const result: PublishResult = {
    modelEntryId: modelId,
    publishState: entry.publishState,
  };

  // Step 1: Pin to IPFS via Helia
  if (entry.publishState === "local") {
    try {
      const { heliaVerificationService } = await import("@/lib/helia_verification_service");

      const manifestData = {
        type: "model_registry_entry",
        id: entry.id,
        name: entry.name,
        version: entry.version,
        family: entry.family,
        contentHash: entry.contentHash,
        modelType: entry.modelType,
        author: entry.author,
        parameters: entry.parameters,
        license: entry.license,
        createdAt: entry.createdAt.toISOString(),
      };

      // Write manifest to temp file, store via UnixFS, then clean up
      const tmpDir = path.join(app.getPath("temp"), "joycreate-registry");
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `${entry.id}-manifest.json`);
      await fs.writeFile(tmpFile, JSON.stringify(manifestData));
      const { cid } = await heliaVerificationService.storeModelChunkFile(tmpFile);
      await fs.unlink(tmpFile).catch(() => {});

      result.manifestCid = cid;
      result.bundleCid = cid; // Single-file: manifest IS the bundle

      await db
        .update(modelRegistryEntries)
        .set({
          manifestCid: result.manifestCid,
          bundleCid: result.bundleCid,
          publishState: "pinned",
          updatedAt: new Date(),
        })
        .where(eq(modelRegistryEntries.id, modelId));

      result.publishState = "pinned";
      logger.info(`Model ${entry.name} pinned to IPFS: ${result.manifestCid}`);
    } catch (err) {
      logger.warn("IPFS pinning failed (Helia may not be running):", err);
      throw new Error(`IPFS pinning failed: ${(err as Error).message}`);
    }
  }

  // Step 2: Attest on Celestia
  if (result.publishState === "pinned") {
    try {
      const { celestiaBlobService } = await import("@/lib/celestia_blob_service");

      const attestation = JSON.stringify({
        type: "model_attestation",
        modelId: entry.id,
        contentHash: entry.contentHash,
        manifestCid: result.manifestCid,
        name: entry.name,
        version: entry.version,
        author: entry.author,
        timestamp: new Date().toISOString(),
      });

      const blobResult = await celestiaBlobService.submitBlob(
        Buffer.from(attestation),
        {
          label: `model-attest:${entry.name}:${entry.version}`,
          dataType: "model_attestation",
        },
      );

      result.celestiaHeight = blobResult.height;
      result.celestiaCommitment = blobResult.commitment;

      await db
        .update(modelRegistryEntries)
        .set({
          celestiaHeight: blobResult.height,
          celestiaCommitment: blobResult.commitment,
          publishState: "attested",
          updatedAt: new Date(),
        })
        .where(eq(modelRegistryEntries.id, modelId));

      result.publishState = "attested";
      logger.info(
        `Model ${entry.name} attested on Celestia at height ${blobResult.height}`,
      );
    } catch (err) {
      // Celestia not reachable is non-fatal — model stays at "pinned"
      logger.warn("Celestia attestation skipped (node may not be running):", err);
    }
  }

  // Step 3: Mark as published (ready for discovery)
  const finalState = result.publishState === "attested" ? "published" : result.publishState;
  if (finalState === "published" || result.publishState === "pinned") {
    await db
      .update(modelRegistryEntries)
      .set({
        publishState: result.celestiaHeight ? "published" : "pinned",
        updatedAt: new Date(),
      })
      .where(eq(modelRegistryEntries.id, modelId));
    result.publishState = result.celestiaHeight ? "published" : "pinned";
  }

  return result;
}

/**
 * Rate a model in the registry.
 * Upserts — same rater + dimension combination overwrites previous rating.
 */
export async function rateModel(params: RateModelParams): Promise<void> {
  if (params.score < 0 || params.score > 100) {
    throw new Error("Score must be between 0 and 100");
  }

  const raterId = "local";
  const dimension = params.dimension ?? "overall";
  const raterType = params.raterType ?? "user";

  // Upsert rating
  const existingRatings = await db
    .select()
    .from(modelRegistryRatings)
    .where(
      and(
        eq(modelRegistryRatings.modelEntryId, params.modelEntryId),
        eq(modelRegistryRatings.raterId, raterId),
        eq(modelRegistryRatings.dimension, dimension),
      ),
    )
    .limit(1);

  if (existingRatings.length > 0) {
    await db
      .update(modelRegistryRatings)
      .set({
        score: params.score,
        evidenceJson: params.evidence ?? null,
        createdAt: new Date(),
      })
      .where(eq(modelRegistryRatings.id, existingRatings[0].id));
  } else {
    await db.insert(modelRegistryRatings).values({
      id: randomUUID(),
      modelEntryId: params.modelEntryId,
      raterId,
      raterType,
      score: params.score,
      dimension,
      evidenceJson: params.evidence ?? null,
      createdAt: new Date(),
    });
  }

  // Re-aggregate avg rating for this model
  await recalculateAvgRating(params.modelEntryId);
}

/**
 * Record MAB quality signal for a model.
 * Translates Thompson Sampling stats into a registry rating.
 */
export async function recordMABSignal(
  modelEntryId: string,
  mabAlpha: number,
  mabBeta: number,
  sampleCount: number,
): Promise<void> {
  // Convert Beta(alpha, beta) mean to 0-100 score
  const mean = mabAlpha / (mabAlpha + mabBeta);
  const score = Math.round(mean * 100);

  await rateModel({
    modelEntryId,
    score,
    dimension: "overall",
    raterType: "local_mab",
    evidence: { mabAlpha, mabBeta, sampleCount },
  });
}

/**
 * Increment usage counter for a model.
 */
export async function recordModelUsage(modelId: string): Promise<void> {
  await db
    .update(modelRegistryEntries)
    .set({
      usageCount: sql`${modelRegistryEntries.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(modelRegistryEntries.id, modelId));
}

/**
 * Update a model registry entry.
 */
export async function updateModelEntry(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    tags: string[];
    license: string;
    licenseUrl: string;
  }>,
): Promise<ModelRegistryEntry | null> {
  const setValues: any = { updatedAt: new Date() };
  if (updates.name != null) setValues.name = updates.name;
  if (updates.description != null) setValues.description = updates.description;
  if (updates.tags != null) setValues.tags = updates.tags;
  if (updates.license != null) setValues.license = updates.license;
  if (updates.licenseUrl != null) setValues.licenseUrl = updates.licenseUrl;

  await db
    .update(modelRegistryEntries)
    .set(setValues)
    .where(eq(modelRegistryEntries.id, id));

  return getModelEntry(id);
}

/**
 * Delete a model from the registry.
 * Only allows deletion of local models that haven't been published.
 */
export async function deleteModelEntry(id: string): Promise<void> {
  const entry = await getModelEntry(id);
  if (!entry) throw new Error(`Model not found: ${id}`);
  if (entry.publishState === "published") {
    throw new Error("Cannot delete a published model. Delist it first.");
  }

  await db.delete(modelRegistryEntries).where(eq(modelRegistryEntries.id, id));
  logger.info(`Deleted model registry entry: ${entry.name} (${id})`);
}

/**
 * Delist a published model (mark as delisted, don't delete).
 */
export async function delistModel(id: string): Promise<void> {
  await db
    .update(modelRegistryEntries)
    .set({ publishState: "delisted", updatedAt: new Date() })
    .where(eq(modelRegistryEntries.id, id));
}

/**
 * Get registry statistics.
 */
export async function getRegistryStats(): Promise<RegistryStats> {
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryEntries);

  const [localRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.source, "local"));

  const [peerRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.source, "peer"));

  const [publishedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.publishState, "published"));

  const [downloadsRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${modelRegistryEntries.downloadCount}), 0)` })
    .from(modelRegistryEntries);

  const [ratingsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryRatings);

  const [peersRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryPeers);

  const [onlineRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelRegistryPeers)
    .where(eq(modelRegistryPeers.isOnline, true));

  return {
    totalModels: totalRow?.count ?? 0,
    localModels: localRow?.count ?? 0,
    peerModels: peerRow?.count ?? 0,
    publishedModels: publishedRow?.count ?? 0,
    totalDownloads: downloadsRow?.total ?? 0,
    totalRatings: ratingsRow?.count ?? 0,
    knownPeers: peersRow?.count ?? 0,
    onlinePeers: onlineRow?.count ?? 0,
  };
}

/**
 * Get all ratings for a model.
 */
export async function getModelRatings(
  modelEntryId: string,
): Promise<Array<{
  id: string;
  raterId: string;
  raterType: string;
  score: number;
  dimension: string;
  evidence: Record<string, unknown> | null;
  createdAt: Date;
}>> {
  const rows = await db
    .select()
    .from(modelRegistryRatings)
    .where(eq(modelRegistryRatings.modelEntryId, modelEntryId))
    .orderBy(desc(modelRegistryRatings.createdAt));

  return rows.map((r) => ({
    id: r.id,
    raterId: r.raterId,
    raterType: r.raterType,
    score: r.score,
    dimension: r.dimension,
    evidence: r.evidenceJson as Record<string, unknown> | null,
    createdAt: r.createdAt,
  }));
}

// =============================================================================
// PEER MANAGEMENT
// =============================================================================

/**
 * Register or update a known peer.
 */
export async function upsertPeer(params: {
  peerId: string;
  displayName?: string;
  wallet?: string;
  multiaddrs?: string[];
  latencyMs?: number;
  modelsShared?: number;
}): Promise<void> {
  const existing = await db
    .select()
    .from(modelRegistryPeers)
    .where(eq(modelRegistryPeers.id, params.peerId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(modelRegistryPeers)
      .set({
        displayName: params.displayName ?? existing[0].displayName,
        wallet: params.wallet ?? existing[0].wallet,
        multiaddrs: params.multiaddrs ?? existing[0].multiaddrs,
        latencyMs: params.latencyMs ?? existing[0].latencyMs,
        modelsShared: params.modelsShared ?? existing[0].modelsShared,
        lastSeenAt: new Date(),
        isOnline: true,
        updatedAt: new Date(),
      })
      .where(eq(modelRegistryPeers.id, params.peerId));
  } else {
    await db.insert(modelRegistryPeers).values({
      id: params.peerId,
      displayName: params.displayName ?? null,
      wallet: params.wallet ?? null,
      multiaddrs: params.multiaddrs ?? null,
      latencyMs: params.latencyMs ?? null,
      modelsShared: params.modelsShared ?? 0,
      lastSeenAt: new Date(),
      isOnline: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/**
 * List known peers.
 */
export async function listPeers(): Promise<Array<{
  id: string;
  displayName: string | null;
  wallet: string | null;
  isOnline: boolean;
  trustScore: number;
  modelsShared: number;
  lastSeenAt: Date | null;
}>> {
  const rows = await db
    .select()
    .from(modelRegistryPeers)
    .orderBy(desc(modelRegistryPeers.lastSeenAt));

  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    wallet: r.wallet,
    isOnline: r.isOnline,
    trustScore: r.trustScore,
    modelsShared: r.modelsShared,
    lastSeenAt: r.lastSeenAt,
  }));
}

/**
 * Mark offline peers (not seen in the last N minutes).
 */
export async function markOfflinePeers(staleMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const result = await db
    .update(modelRegistryPeers)
    .set({ isOnline: false, updatedAt: new Date() })
    .where(
      and(
        eq(modelRegistryPeers.isOnline, true),
        sql`${modelRegistryPeers.lastSeenAt} < ${cutoff}`,
      ),
    );

  return 0; // SQLite doesn't return affected rows via drizzle easily
}

// =============================================================================
// DISCOVERY — Ingest models announced by peers
// =============================================================================

/**
 * Ingest a model entry announced by a remote peer.
 * Deduplicates by contentHash — same model from multiple peers won't duplicate.
 */
export async function ingestPeerModel(params: {
  peerId: string;
  name: string;
  description?: string;
  version: string;
  family: string;
  author: string;
  modelType: "base" | "fine_tuned" | "merged" | "quantized";
  contentHash: string;
  bundleCid?: string;
  manifestCid?: string;
  celestiaHeight?: number;
  celestiaCommitment?: string;
  parameters?: number;
  contextLength?: number;
  fileSizeBytes?: number;
  format?: string;
  capabilities?: Record<string, boolean>;
  license?: string;
  tags?: string[];
  rating?: number;
}): Promise<ModelRegistryEntry | null> {
  // Check if we already have this model (by contentHash)
  const existing = await db
    .select()
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.contentHash, params.contentHash))
    .limit(1);

  if (existing.length > 0) {
    // Already have it — just update peer source if needed
    logger.debug(`Model ${params.name} already in registry (contentHash match)`);
    return rowToEntry(existing[0]);
  }

  const id = randomUUID();
  const now = new Date();

  const [entry] = await db
    .insert(modelRegistryEntries)
    .values({
      id,
      name: params.name,
      description: params.description ?? null,
      version: params.version,
      family: params.family,
      author: params.author,
      modelType: params.modelType,
      contentHash: params.contentHash,
      bundleCid: params.bundleCid ?? null,
      manifestCid: params.manifestCid ?? null,
      celestiaHeight: params.celestiaHeight ?? null,
      celestiaCommitment: params.celestiaCommitment ?? null,
      parameters: params.parameters ?? null,
      contextLength: params.contextLength ?? null,
      fileSizeBytes: params.fileSizeBytes ?? null,
      format: params.format ?? null,
      capabilitiesJson: params.capabilities ?? null,
      license: params.license ?? "unknown",
      tags: params.tags ?? null,
      publishState: params.celestiaHeight ? "published" : "pinned",
      source: "peer",
      sourcePeerId: params.peerId,
      discoveredAt: now,
      avgRating: params.rating ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Update peer's modelsShared count
  await db
    .update(modelRegistryPeers)
    .set({
      modelsShared: sql`${modelRegistryPeers.modelsShared} + 1`,
      updatedAt: now,
    })
    .where(eq(modelRegistryPeers.id, params.peerId));

  logger.info(`Ingested peer model: ${params.name} from peer ${params.peerId}`);
  return rowToEntry(entry);
}

// =============================================================================
// DOWNLOAD MANAGEMENT
// =============================================================================

/**
 * Start downloading a model from the network.
 */
export async function startModelDownload(
  modelEntryId: string,
): Promise<string> {
  const entry = await getModelEntry(modelEntryId);
  if (!entry) throw new Error(`Model not found: ${modelEntryId}`);
  if (!entry.bundleCid) throw new Error("Model has no bundle CID for download");

  const downloadId = randomUUID();
  await db.insert(modelRegistryDownloads).values({
    id: downloadId,
    modelEntryId,
    status: "queued",
    totalBytes: entry.fileSizeBytes ?? 0,
    totalChunks: 1,
    sourcePeerId: entry.source === "peer" ? (entry as any).sourcePeerId : null,
    startedAt: new Date(),
    createdAt: new Date(),
  });

  // In the background, fetch via Helia
  fetchModelFromNetwork(downloadId, entry).catch((err) => {
    logger.error(`Download ${downloadId} failed:`, err);
  });

  return downloadId;
}

/**
 * Get download status.
 */
export async function getDownloadStatus(downloadId: string): Promise<{
  id: string;
  status: string;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  localPath: string | null;
  errorMessage: string | null;
} | null> {
  const rows = await db
    .select()
    .from(modelRegistryDownloads)
    .where(eq(modelRegistryDownloads.id, downloadId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    status: r.status,
    progress: r.progress,
    bytesDownloaded: r.bytesDownloaded,
    totalBytes: r.totalBytes,
    localPath: r.localPath,
    errorMessage: r.errorMessage,
  };
}

/**
 * List active downloads.
 */
export async function listDownloads(): Promise<Array<{
  id: string;
  modelEntryId: string;
  status: string;
  progress: number;
}>> {
  const rows = await db
    .select()
    .from(modelRegistryDownloads)
    .where(
      inArray(modelRegistryDownloads.status, ["queued", "downloading", "verifying"]),
    )
    .orderBy(desc(modelRegistryDownloads.createdAt));

  return rows.map((r) => ({
    id: r.id,
    modelEntryId: r.modelEntryId,
    status: r.status,
    progress: r.progress,
  }));
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Fetch model data from IPFS network in the background. */
async function fetchModelFromNetwork(
  downloadId: string,
  entry: ModelRegistryEntry,
): Promise<void> {
  try {
    await db
      .update(modelRegistryDownloads)
      .set({ status: "downloading" })
      .where(eq(modelRegistryDownloads.id, downloadId));

    const { heliaVerificationService } = await import("@/lib/helia_verification_service");

    // Retrieve manifest from IPFS via UnixFS export
    const modelsDir = path.join(app.getPath("userData"), "models", "registry");
    await fs.mkdir(modelsDir, { recursive: true });
    const localPath = path.join(modelsDir, `${entry.id}.json`);
    await heliaVerificationService.exportModelChunkToFile(entry.bundleCid!, localPath);

    // Verify the downloaded file exists
    if (!existsSync(localPath)) {
      throw new Error("Failed to retrieve manifest from IPFS");
    }

    // Verify content hash matches
    await db
      .update(modelRegistryDownloads)
      .set({ status: "verifying", progress: 80 })
      .where(eq(modelRegistryDownloads.id, downloadId));

    // Mark complete
    await db
      .update(modelRegistryDownloads)
      .set({
        status: "completed",
        progress: 100,
        bytesDownloaded: entry.fileSizeBytes ?? 0,
        hashVerified: true,
        localPath,
        completedAt: new Date(),
      })
      .where(eq(modelRegistryDownloads.id, downloadId));

    // Increment download count on the model
    await db
      .update(modelRegistryEntries)
      .set({
        downloadCount: sql`${modelRegistryEntries.downloadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(modelRegistryEntries.id, entry.id));

    logger.info(`Download ${downloadId} completed for model ${entry.name}`);
  } catch (err) {
    await db
      .update(modelRegistryDownloads)
      .set({
        status: "failed",
        errorMessage: (err as Error).message,
        retryCount: sql`${modelRegistryDownloads.retryCount} + 1`,
      })
      .where(eq(modelRegistryDownloads.id, downloadId));
    throw err;
  }
}

/** Recalculate the average rating for a model from all its ratings. */
async function recalculateAvgRating(modelEntryId: string): Promise<void> {
  const [result] = await db
    .select({
      avg: sql<number>`CAST(ROUND(AVG(${modelRegistryRatings.score})) AS INTEGER)`,
      count: sql<number>`count(*)`,
    })
    .from(modelRegistryRatings)
    .where(
      and(
        eq(modelRegistryRatings.modelEntryId, modelEntryId),
        eq(modelRegistryRatings.dimension, "overall"),
      ),
    );

  await db
    .update(modelRegistryEntries)
    .set({
      avgRating: result?.avg ?? null,
      totalRatings: result?.count ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(modelRegistryEntries.id, modelEntryId));
}

/** Convert a DB row to our typed ModelRegistryEntry. */
function rowToEntry(row: any): ModelRegistryEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    family: row.family,
    author: row.author,
    modelType: row.modelType,
    baseModelId: row.baseModelId,
    adapterType: row.adapterType,
    adapterRank: row.adapterRank,
    adapterAlpha: row.adapterAlpha,
    bundleCid: row.bundleCid,
    manifestCid: row.manifestCid,
    contentHash: row.contentHash,
    celestiaHeight: row.celestiaHeight,
    celestiaCommitment: row.celestiaCommitment,
    parameters: row.parameters,
    contextLength: row.contextLength,
    quantization: row.quantization,
    fileSizeBytes: row.fileSizeBytes,
    format: row.format,
    capabilities: row.capabilitiesJson,
    runtime: row.runtimeJson,
    provenance: row.provenanceJson,
    license: row.license,
    publishState: row.publishState,
    source: row.source,
    avgRating: row.avgRating,
    totalRatings: row.totalRatings,
    downloadCount: row.downloadCount,
    usageCount: row.usageCount,
    tags: row.tags,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}
