/**
 * Dataset Studio IPC Handlers
 * Offline-first dataset creation, management, and publishing
 * 
 * Integrates with:
 * - asset_studio_handlers.ts (asset management)
 * - sovereign_data_handlers.ts (P2P sync)
 * - federation_handlers.ts (marketplace publishing)
 * - local_model_handlers.ts (local AI generation)
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as fsPromises from "node:fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  datasetItems,
  datasetManifests,
  provenanceRecords,
  datasetP2pSync,
  contentBlobs,
  datasetGenerationJobs,
  type ItemLineage,
  type ItemLabels,
  type QualitySignals,
  type DatasetSchemaV2,
  type DatasetStatsV2,
  type SplitsInfo,
  type GenerationJobConfig,
} from "@/db/schema";

const logger = log.scope("dataset_studio_handlers");

// ============================================================================
// Constants and Configuration
// ============================================================================

const CONTENT_STORE_DIR = "content-store";
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks for large files

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the content-addressed storage directory
 */
function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), CONTENT_STORE_DIR);
}

/**
 * Compute SHA-256 hash of data
 */
function computeHash(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Compute SHA-256 hash of a file (streaming for large files)
 */
async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Store content in content-addressed storage
 */
async function storeContent(
  data: Buffer,
  mimeType: string
): Promise<{ hash: string; storagePath: string }> {
  const hash = computeHash(data);
  const storeDir = getContentStoreDir();
  
  // Use hash prefix for directory sharding
  const prefix = hash.substring(0, 2);
  const targetDir = path.join(storeDir, prefix);
  await fs.ensureDir(targetDir);
  
  const storagePath = path.join(targetDir, hash);
  
  // Check if already exists (deduplication)
  if (!(await fs.pathExists(storagePath))) {
    await fs.writeFile(storagePath, data);
  }
  
  // Update or insert blob record
  const existing = await db.select().from(contentBlobs).where(eq(contentBlobs.hash, hash)).limit(1);
  
  if (existing.length > 0) {
    await db.update(contentBlobs)
      .set({ refCount: sql`${contentBlobs.refCount} + 1` })
      .where(eq(contentBlobs.hash, hash));
  } else {
    await db.insert(contentBlobs).values({
      hash,
      mimeType,
      byteSize: data.length,
      storagePath: path.relative(storeDir, storagePath),
      isChunked: false,
    });
  }
  
  return { hash, storagePath };
}

/**
 * Store large file with chunking
 */
async function storeLargeFile(
  filePath: string,
  mimeType: string
): Promise<{ hash: string; storagePath: string; chunkHashes: string[] }> {
  const storeDir = getContentStoreDir();
  const stats = await fs.stat(filePath);
  const chunkHashes: string[] = [];
  
  // Read and store chunks using node:fs/promises
  const fileHandle = await fsPromises.open(filePath, "r");
  const buffer = Buffer.alloc(CHUNK_SIZE);
  let position = 0;
  
  const overallHash = crypto.createHash("sha256");
  
  try {
    let result = await fileHandle.read(buffer, 0, CHUNK_SIZE, position);
    while (result.bytesRead > 0) {
      const chunk = buffer.subarray(0, result.bytesRead);
      overallHash.update(chunk);
      
      const chunkHash = computeHash(chunk);
      chunkHashes.push(chunkHash);
      
      // Store chunk
      const prefix = chunkHash.substring(0, 2);
      const chunkDir = path.join(storeDir, "chunks", prefix);
      await fs.ensureDir(chunkDir);
      const chunkPath = path.join(chunkDir, chunkHash);
      
      if (!(await fs.pathExists(chunkPath))) {
        await fs.writeFile(chunkPath, chunk);
      }
      
      position += result.bytesRead;
      result = await fileHandle.read(buffer, 0, CHUNK_SIZE, position);
    }
  } finally {
    await fileHandle.close();
  }
  
  const hash = overallHash.digest("hex");
  const prefix = hash.substring(0, 2);
  const storagePath = path.join(prefix, hash);
  
  // Store blob record with chunk info
  await db.insert(contentBlobs).values({
    hash,
    mimeType,
    byteSize: stats.size,
    storagePath,
    isChunked: true,
    chunkCount: chunkHashes.length,
    chunkHashes,
  }).onConflictDoUpdate({
    target: contentBlobs.hash,
    set: { refCount: sql`${contentBlobs.refCount} + 1` },
  });
  
  return { hash, storagePath, chunkHashes };
}

/**
 * Detect modality from MIME type
 */
function detectModality(mimeType: string): "text" | "image" | "audio" | "video" | "context" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  return "context";
}

/**
 * Sign data with Ed25519 (placeholder - integrate with vault)
 */
async function signData(_data: Buffer): Promise<string> {
  // TODO: Integrate with vault for actual signing
  return `sig_${uuidv4()}`;
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDatasetStudioHandlers() {
  logger.info("Registering Dataset Studio handlers");

  // ========== Dataset Item Operations ==========

  /**
   * Add item to dataset from file
   */
  ipcMain.handle("dataset-studio:add-item-from-file", async (_event, args: {
    datasetId: string;
    filePath: string;
    mimeType?: string;
    sourceType?: "captured" | "imported" | "generated" | "api" | "scraped";
    labels?: ItemLabels;
    license?: string;
  }) => {
    try {
      const { datasetId, filePath, sourceType = "imported", labels, license = "unknown" } = args;
      
      // Read file and detect mime type
      const data = await fs.readFile(filePath);
      const mimeType = args.mimeType || "application/octet-stream";
      
      // Store content
      const stats = await fs.stat(filePath);
      let contentInfo: { hash: string; storagePath: string };
      
      if (stats.size > CHUNK_SIZE) {
        contentInfo = await storeLargeFile(filePath, mimeType);
      } else {
        contentInfo = await storeContent(data, mimeType);
      }
      
      const itemId = uuidv4();
      const modality = detectModality(mimeType);
      
      // Create item record
      const item = {
        id: itemId,
        datasetId,
        modality,
        contentHash: contentInfo.hash,
        byteSize: stats.size,
        sourceType,
        sourcePath: filePath,
        generator: "human" as const,
        contentUri: `cas://${contentInfo.hash}`,
        localPath: filePath,
        labelsJson: labels || null,
        license,
        split: "unassigned" as const,
      };
      
      await db.insert(datasetItems).values(item);
      
      // Create provenance record
      await db.insert(provenanceRecords).values({
        id: uuidv4(),
        itemId,
        action: "imported",
        actorType: "human",
        outputHash: contentInfo.hash,
      });
      
      logger.info(`Added item ${itemId} to dataset ${datasetId}`);
      return { success: true, itemId, hash: contentInfo.hash };
    } catch (error) {
      logger.error("Failed to add item from file:", error);
      throw error;
    }
  });

  /**
   * Add item from generated content
   */
  ipcMain.handle("dataset-studio:add-generated-item", async (_event, args: {
    datasetId: string;
    content: string | Buffer;
    mimeType: string;
    lineage: ItemLineage;
    labels?: ItemLabels;
    generator: "local_model" | "provider_api" | "hybrid";
  }) => {
    try {
      const { datasetId, content, mimeType, lineage, labels, generator } = args;
      
      const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      const contentInfo = await storeContent(data, mimeType);
      
      const itemId = uuidv4();
      const modality = detectModality(mimeType);
      
      const item = {
        id: itemId,
        datasetId,
        modality,
        contentHash: contentInfo.hash,
        byteSize: data.length,
        sourceType: "generated" as const,
        generator,
        lineageJson: lineage,
        contentUri: `cas://${contentInfo.hash}`,
        labelsJson: labels || null,
        license: "generated",
        split: "unassigned" as const,
      };
      
      await db.insert(datasetItems).values(item);
      
      // Create provenance record
      await db.insert(provenanceRecords).values({
        id: uuidv4(),
        itemId,
        action: "generated",
        actorType: generator === "local_model" ? "local_model" : "remote_api",
        actorId: lineage.model,
        parametersJson: {
          prompt: lineage.prompt,
          seed: lineage.seed,
          temperature: lineage.temperature,
          ...lineage.parameters,
        },
        outputHash: contentInfo.hash,
      });
      
      return { success: true, itemId, hash: contentInfo.hash };
    } catch (error) {
      logger.error("Failed to add generated item:", error);
      throw error;
    }
  });

  /**
   * Update item labels
   */
  ipcMain.handle("dataset-studio:update-item-labels", async (_event, args: {
    itemId: string;
    labels: Partial<ItemLabels>;
    merge?: boolean;
  }) => {
    try {
      const { itemId, labels, merge = true } = args;
      
      const [existing] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!existing) throw new Error(`Item ${itemId} not found`);
      
      const updatedLabels = merge 
        ? { ...(existing.labelsJson || {}), ...labels }
        : labels;
      
      await db.update(datasetItems)
        .set({ labelsJson: updatedLabels as ItemLabels, updatedAt: new Date() })
        .where(eq(datasetItems.id, itemId));
      
      // Add provenance
      await db.insert(provenanceRecords).values({
        id: uuidv4(),
        itemId,
        action: "labeled",
        actorType: "human",
        inputHashesJson: [existing.contentHash],
        outputHash: existing.contentHash,
        parametersJson: { labels: updatedLabels },
      });
      
      return { success: true };
    } catch (error) {
      logger.error("Failed to update item labels:", error);
      throw error;
    }
  });

  /**
   * Update item quality signals
   */
  ipcMain.handle("dataset-studio:update-quality-signals", async (_event, args: {
    itemId: string;
    signals: Partial<QualitySignals>;
  }) => {
    try {
      const { itemId, signals } = args;
      
      const [existing] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!existing) throw new Error(`Item ${itemId} not found`);
      
      const updatedSignals = { ...(existing.qualitySignalsJson || {}), ...signals };
      
      await db.update(datasetItems)
        .set({ qualitySignalsJson: updatedSignals as QualitySignals, updatedAt: new Date() })
        .where(eq(datasetItems.id, itemId));
      
      return { success: true };
    } catch (error) {
      logger.error("Failed to update quality signals:", error);
      throw error;
    }
  });

  /**
   * List items in dataset
   */
  ipcMain.handle("dataset-studio:list-items", async (_event, args: {
    datasetId: string;
    limit?: number;
    offset?: number;
    modality?: string;
    split?: string;
  }) => {
    try {
      const { datasetId, limit = 100, offset = 0, modality, split } = args;
      
      // Build conditions array
      const conditions = [eq(datasetItems.datasetId, datasetId)];
      
      if (modality) {
        conditions.push(eq(datasetItems.modality, modality as any));
      }
      
      if (split) {
        conditions.push(eq(datasetItems.split, split as any));
      }
      
      const items = await db.select()
        .from(datasetItems)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(datasetItems.createdAt));
      
      return { items, total: items.length };
    } catch (error) {
      logger.error("Failed to list items:", error);
      throw error;
    }
  });

  /**
   * Get item by ID
   */
  ipcMain.handle("dataset-studio:get-item", async (_event, itemId: string) => {
    try {
      const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!item) throw new Error(`Item ${itemId} not found`);
      
      // Get provenance
      const provenance = await db.select()
        .from(provenanceRecords)
        .where(eq(provenanceRecords.itemId, itemId))
        .orderBy(provenanceRecords.timestamp);
      
      return { item, provenance };
    } catch (error) {
      logger.error("Failed to get item:", error);
      throw error;
    }
  });

  /**
   * Delete item
   */
  ipcMain.handle("dataset-studio:delete-item", async (_event, itemId: string) => {
    try {
      const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!item) throw new Error(`Item ${itemId} not found`);
      
      // Decrease ref count on blob
      await db.update(contentBlobs)
        .set({ refCount: sql`${contentBlobs.refCount} - 1` })
        .where(eq(contentBlobs.hash, item.contentHash));
      
      await db.delete(datasetItems).where(eq(datasetItems.id, itemId));
      
      return { success: true };
    } catch (error) {
      logger.error("Failed to delete item:", error);
      throw error;
    }
  });

  // ========== Dataset Manifest Operations ==========

  /**
   * Build dataset manifest
   */
  ipcMain.handle("dataset-studio:build-manifest", async (_event, args: {
    datasetId: string;
    version: string;
    license: string;
    schema?: DatasetSchemaV2;
  }) => {
    try {
      const { datasetId, version, license, schema } = args;
      
      // Get all items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      if (items.length === 0) {
        throw new Error("Cannot build manifest for empty dataset");
      }
      
      // Compute stats
      const stats: DatasetStatsV2 = {
        itemCount: items.length,
        totalBytes: items.reduce((sum, item) => sum + item.byteSize, 0),
        modalityDistribution: {},
        splitDistribution: { train: 0, val: 0, test: 0, unassigned: 0 },
      };
      
      for (const item of items) {
        stats.modalityDistribution[item.modality] = (stats.modalityDistribution[item.modality] || 0) + 1;
        stats.splitDistribution[item.split] = (stats.splitDistribution[item.split] || 0) + 1;
      }
      
      // Compute merkle root (simplified - just hash of all content hashes)
      const sortedHashes = items.map(i => i.contentHash).sort();
      const merkleRoot = computeHash(Buffer.from(sortedHashes.join("")));
      
      // Compute manifest hash
      const manifestContent = JSON.stringify({ datasetId, version, items: sortedHashes, stats, schema });
      const manifestHash = computeHash(Buffer.from(manifestContent));
      
      const manifestId = uuidv4();
      
      await db.insert(datasetManifests).values({
        id: manifestId,
        datasetId,
        version,
        manifestHash,
        merkleRoot,
        schemaJson: schema || null,
        statsJson: stats,
        totalItems: items.length,
        totalBytes: stats.totalBytes,
        license,
        publishStatus: "draft",
      });
      
      return {
        success: true,
        manifestId,
        manifestHash,
        merkleRoot,
        stats,
      };
    } catch (error) {
      logger.error("Failed to build manifest:", error);
      throw error;
    }
  });

  /**
   * Create train/val/test splits
   */
  ipcMain.handle("dataset-studio:create-splits", async (_event, args: {
    datasetId: string;
    ratios: { train: number; val: number; test: number };
    seed?: number;
  }) => {
    try {
      const { datasetId, ratios, seed = Date.now() } = args;
      
      // Validate ratios
      const total = ratios.train + ratios.val + ratios.test;
      if (Math.abs(total - 1.0) > 0.001) {
        throw new Error("Split ratios must sum to 1.0");
      }
      
      // Get all items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      // Deterministic shuffle using seed
      const shuffled = [...items];
      const random = seedRandom(seed);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      // Assign splits
      const trainEnd = Math.floor(shuffled.length * ratios.train);
      const valEnd = trainEnd + Math.floor(shuffled.length * ratios.val);
      
      const counts = { train: 0, val: 0, test: 0 };
      
      for (let i = 0; i < shuffled.length; i++) {
        let split: "train" | "val" | "test";
        if (i < trainEnd) {
          split = "train";
        } else if (i < valEnd) {
          split = "val";
        } else {
          split = "test";
        }
        
        counts[split]++;
        
        await db.update(datasetItems)
          .set({ split, updatedAt: new Date() })
          .where(eq(datasetItems.id, shuffled[i].id));
      }
      
      const splitsInfo: SplitsInfo = {
        seed,
        ratios,
        counts,
      };
      
      return { success: true, splits: splitsInfo };
    } catch (error) {
      logger.error("Failed to create splits:", error);
      throw error;
    }
  });

  /**
   * Sign manifest
   */
  ipcMain.handle("dataset-studio:sign-manifest", async (_event, manifestId: string) => {
    try {
      const [manifest] = await db.select().from(datasetManifests).where(eq(datasetManifests.id, manifestId));
      if (!manifest) throw new Error(`Manifest ${manifestId} not found`);
      
      const signature = await signData(Buffer.from(manifest.manifestHash));
      
      await db.update(datasetManifests)
        .set({ 
          creatorSignature: signature,
          publishStatus: "local",
          updatedAt: new Date(),
        })
        .where(eq(datasetManifests.id, manifestId));
      
      return { success: true, signature };
    } catch (error) {
      logger.error("Failed to sign manifest:", error);
      throw error;
    }
  });

  /**
   * Get manifest
   */
  ipcMain.handle("dataset-studio:get-manifest", async (_event, args: {
    datasetId?: string;
    manifestId?: string;
    version?: string;
  }) => {
    try {
      let query;
      
      if (args.manifestId) {
        query = db.select().from(datasetManifests).where(eq(datasetManifests.id, args.manifestId));
      } else if (args.datasetId && args.version) {
        query = db.select().from(datasetManifests).where(
          and(
            eq(datasetManifests.datasetId, args.datasetId),
            eq(datasetManifests.version, args.version)
          )
        );
      } else if (args.datasetId) {
        query = db.select().from(datasetManifests)
          .where(eq(datasetManifests.datasetId, args.datasetId))
          .orderBy(desc(datasetManifests.createdAt))
          .limit(1);
      } else {
        throw new Error("Must provide manifestId, or datasetId with optional version");
      }
      
      const [manifest] = await query;
      return manifest || null;
    } catch (error) {
      logger.error("Failed to get manifest:", error);
      throw error;
    }
  });

  // ========== Generation Job Operations ==========

  /**
   * Create generation job
   */
  ipcMain.handle("dataset-studio:create-generation-job", async (_event, args: {
    datasetId: string;
    jobType: "text_generation" | "image_generation" | "audio_transcription" | "labeling" | "augmentation" | "embedding";
    config: GenerationJobConfig;
    providerType: "local" | "remote";
    providerId: string;
    modelId: string;
  }) => {
    try {
      const jobId = uuidv4();
      
      await db.insert(datasetGenerationJobs).values({
        id: jobId,
        datasetId: args.datasetId,
        jobType: args.jobType,
        configJson: args.config,
        providerType: args.providerType,
        providerId: args.providerId,
        modelId: args.modelId,
        status: "pending",
        totalItems: args.config.targetCount || 0,
      });
      
      return { success: true, jobId };
    } catch (error) {
      logger.error("Failed to create generation job:", error);
      throw error;
    }
  });

  /**
   * Get job status
   */
  ipcMain.handle("dataset-studio:get-job-status", async (_event, jobId: string) => {
    try {
      const [job] = await db.select().from(datasetGenerationJobs).where(eq(datasetGenerationJobs.id, jobId));
      return job || null;
    } catch (error) {
      logger.error("Failed to get job status:", error);
      throw error;
    }
  });

  /**
   * List jobs for dataset
   */
  ipcMain.handle("dataset-studio:list-jobs", async (_event, datasetId: string) => {
    try {
      const jobs = await db.select()
        .from(datasetGenerationJobs)
        .where(eq(datasetGenerationJobs.datasetId, datasetId))
        .orderBy(desc(datasetGenerationJobs.createdAt));
      return jobs;
    } catch (error) {
      logger.error("Failed to list jobs:", error);
      throw error;
    }
  });

  // ========== P2P Sync Operations ==========

  /**
   * Initialize P2P sync for dataset
   */
  ipcMain.handle("dataset-studio:init-p2p-sync", async (_event, args: {
    datasetId: string;
    peerId: string;
    peerName?: string;
    direction: "push" | "pull" | "bidirectional";
  }) => {
    try {
      const syncId = uuidv4();
      
      await db.insert(datasetP2pSync).values({
        id: syncId,
        datasetId: args.datasetId,
        peerId: args.peerId,
        peerName: args.peerName,
        syncDirection: args.direction,
        syncStatus: "queued",
      });
      
      return { success: true, syncId };
    } catch (error) {
      logger.error("Failed to init P2P sync:", error);
      throw error;
    }
  });

  /**
   * Get P2P sync status
   */
  ipcMain.handle("dataset-studio:get-p2p-sync-status", async (_event, datasetId: string) => {
    try {
      const syncs = await db.select()
        .from(datasetP2pSync)
        .where(eq(datasetP2pSync.datasetId, datasetId));
      return syncs;
    } catch (error) {
      logger.error("Failed to get P2P sync status:", error);
      throw error;
    }
  });

  // ========== Content Retrieval ==========

  /**
   * Get content by hash
   */
  ipcMain.handle("dataset-studio:get-content", async (_event, hash: string) => {
    try {
      const [blob] = await db.select().from(contentBlobs).where(eq(contentBlobs.hash, hash));
      if (!blob) throw new Error(`Blob ${hash} not found`);
      
      const storeDir = getContentStoreDir();
      
      if (blob.isChunked && blob.chunkHashes) {
        // Reassemble chunked content
        const chunks: Buffer[] = [];
        for (const chunkHash of blob.chunkHashes) {
          const prefix = chunkHash.substring(0, 2);
          const chunkPath = path.join(storeDir, "chunks", prefix, chunkHash);
          const chunk = await fs.readFile(chunkPath);
          chunks.push(chunk);
        }
        return { content: Buffer.concat(chunks), mimeType: blob.mimeType };
      } else {
        const prefix = hash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, hash);
        const content = await fs.readFile(filePath);
        return { content, mimeType: blob.mimeType };
      }
    } catch (error) {
      logger.error("Failed to get content:", error);
      throw error;
    }
  });

  /**
   * Export dataset to directory
   */
  ipcMain.handle("dataset-studio:export-dataset", async (_event, args: {
    datasetId: string;
    manifestId: string;
    outputDir: string;
    format: "jsonl" | "parquet" | "huggingface";
    includeMedia?: boolean;
  }) => {
    try {
      const { datasetId, manifestId, outputDir, format, includeMedia = true } = args;
      
      await fs.ensureDir(outputDir);
      
      // Get manifest
      const [manifest] = await db.select().from(datasetManifests).where(eq(datasetManifests.id, manifestId));
      if (!manifest) throw new Error(`Manifest ${manifestId} not found`);
      
      // Get items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      // Write manifest
      await fs.writeJson(path.join(outputDir, "manifest.json"), {
        id: manifest.id,
        datasetId: manifest.datasetId,
        version: manifest.version,
        manifestHash: manifest.manifestHash,
        merkleRoot: manifest.merkleRoot,
        schema: manifest.schemaJson,
        stats: manifest.statsJson,
        license: manifest.license,
        createdAt: manifest.createdAt,
        signature: manifest.creatorSignature,
      }, { spaces: 2 });
      
      // Write items based on format
      if (format === "jsonl") {
        const itemsPath = path.join(outputDir, "items.jsonl");
        const lines = items.map(item => JSON.stringify({
          id: item.id,
          modality: item.modality,
          content_hash: item.contentHash,
          byte_size: item.byteSize,
          source_type: item.sourceType,
          generator: item.generator,
          lineage: item.lineageJson,
          labels: item.labelsJson,
          quality_signals: item.qualitySignalsJson,
          license: item.license,
          split: item.split,
          created_at: item.createdAt,
          content_uri: includeMedia ? `media/${item.contentHash}` : item.contentUri,
        }));
        await fs.writeFile(itemsPath, lines.join("\n"));
      }
      
      // Copy media files if requested
      if (includeMedia) {
        const mediaDir = path.join(outputDir, "media");
        await fs.ensureDir(mediaDir);
        
        for (const item of items) {
          const { content } = await ipcMain.emit("dataset-studio:get-content", item.contentHash) as any;
          if (content) {
            await fs.writeFile(path.join(mediaDir, item.contentHash), content);
          }
        }
      }
      
      return { success: true, outputDir };
    } catch (error) {
      logger.error("Failed to export dataset:", error);
      throw error;
    }
  });

  logger.info("Dataset Studio handlers registered");
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Seeded random number generator
 */
function seedRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
