/**
 * Data Studio Core Handlers
 * Extended functionality for robust offline data management
 * 
 * Includes:
 * - Data Import/Export pipelines
 * - Batch operations
 * - Data validation and transformation
 * - Deduplication
 * - Backup and restore
 */

import { ipcMain, app, dialog } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, and, desc, sql, count, like, or, inArray, isNull, isNotNull, gt, lt, gte, lte } from "drizzle-orm";
import {
  studioDatasets,
  datasetItems,
  datasetManifests,
  provenanceRecords,
  contentBlobs,
} from "@/db/schema";

const logger = log.scope("data_studio_core");

// ============================================================================
// Constants
// ============================================================================

const SUPPORTED_IMAGE_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg"];
const SUPPORTED_AUDIO_FORMATS = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma"];
const SUPPORTED_VIDEO_FORMATS = [".mp4", ".webm", ".avi", ".mov", ".mkv", ".wmv", ".flv"];
const SUPPORTED_TEXT_FORMATS = [".txt", ".md", ".json", ".jsonl", ".csv", ".xml", ".html", ".yml", ".yaml"];
const SUPPORTED_DOCUMENT_FORMATS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

const BATCH_SIZE = 100;
const MAX_CONCURRENT_IMPORTS = 5;

// ============================================================================
// Types
// ============================================================================

interface ImportProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentFile: string;
  errors: Array<{ file: string; error: string }>;
}

interface ExportProgress {
  total: number;
  exported: number;
  currentItem: string;
}

interface DataValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

interface DuplicateGroup {
  hash: string;
  items: Array<{ id: string; datasetId: string; sourcePath?: string | null }>;
}

interface DatasetBackup {
  id: string;
  datasetId: string;
  createdAt: Date;
  size: number;
  itemCount: number;
  path: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

function getBackupsDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

function computeHash(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function detectModalityFromExtension(filePath: string): "text" | "image" | "audio" | "video" | "context" {
  const ext = path.extname(filePath).toLowerCase();
  if (SUPPORTED_IMAGE_FORMATS.includes(ext)) return "image";
  if (SUPPORTED_AUDIO_FORMATS.includes(ext)) return "audio";
  if (SUPPORTED_VIDEO_FORMATS.includes(ext)) return "video";
  if (SUPPORTED_TEXT_FORMATS.includes(ext) || SUPPORTED_DOCUMENT_FORMATS.includes(ext)) return "text";
  return "context";
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".tiff": "image/tiff",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".html": "text/html",
    ".pdf": "application/pdf",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function storeContent(
  data: Buffer,
  mimeType: string
): Promise<{ hash: string; storagePath: string }> {
  const hash = computeHash(data);
  const storeDir = getContentStoreDir();
  const prefix = hash.substring(0, 2);
  const targetDir = path.join(storeDir, prefix);
  await fs.ensureDir(targetDir);
  
  const storagePath = path.join(targetDir, hash);
  
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

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataStudioCoreHandlers() {
  logger.info("Registering Data Studio Core handlers");

  // ========== Batch Import Operations ==========

  /**
   * Import files from a directory recursively
   */
  ipcMain.handle("data-studio:batch-import-directory", async (event, args: {
    datasetId: string;
    directoryPath: string;
    recursive?: boolean;
    fileTypes?: string[];
    skipDuplicates?: boolean;
    preserveStructure?: boolean;
  }) => {
    const progress: ImportProgress = {
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentFile: "",
      errors: [],
    };
    
    try {
      const {
        datasetId,
        directoryPath,
        recursive = true,
        fileTypes,
        skipDuplicates = true,
        preserveStructure = false,
      } = args;
      
      // Verify dataset exists
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error(`Dataset not found: ${datasetId}`);
      
      // Collect files
      const files: string[] = [];
      
      async function collectFiles(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && recursive) {
            await collectFiles(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!fileTypes || fileTypes.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      }
      
      await collectFiles(directoryPath);
      progress.total = files.length;
      
      // Get existing hashes if checking duplicates
      let existingHashes: Set<string> = new Set();
      if (skipDuplicates) {
        const existing = await db.select({ hash: datasetItems.contentHash })
          .from(datasetItems)
          .where(eq(datasetItems.datasetId, datasetId));
        existingHashes = new Set(existing.map(e => e.hash));
      }
      
      // Process files in batches
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (filePath) => {
          progress.currentFile = filePath;
          
          try {
            // Compute hash first for dedup check
            const fileHash = await computeFileHash(filePath);
            
            if (skipDuplicates && existingHashes.has(fileHash)) {
              progress.skipped++;
              progress.processed++;
              return;
            }
            
            // Read and store content
            const data = await fs.readFile(filePath);
            const mimeType = getMimeType(filePath);
            const modality = detectModalityFromExtension(filePath);
            const stats = await fs.stat(filePath);
            
            const contentInfo = await storeContent(data, mimeType);
            
            const itemId = uuidv4();
            const relativePath = preserveStructure 
              ? path.relative(directoryPath, filePath) 
              : undefined;
            
            await db.insert(datasetItems).values({
              id: itemId,
              datasetId,
              modality,
              contentHash: contentInfo.hash,
              byteSize: stats.size,
              sourceType: "imported",
              sourcePath: filePath,
              generator: "human",
              contentUri: `cas://${contentInfo.hash}`,
              localPath: filePath,
              license: "unknown",
              split: "unassigned",
              labelsJson: relativePath ? { customLabels: { originalPath: relativePath } } : null,
            });
            
            // Record provenance
            await db.insert(provenanceRecords).values({
              id: uuidv4(),
              itemId,
              action: "imported",
              actorType: "human",
              outputHash: contentInfo.hash,
              parametersJson: { 
                sourcePath: filePath,
                importedAt: new Date().toISOString(),
              },
            });
            
            existingHashes.add(contentInfo.hash);
            progress.succeeded++;
          } catch (error) {
            progress.failed++;
            progress.errors.push({
              file: filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          
          progress.processed++;
          
          // Send progress update
          event.sender.send("data-studio:import-progress", progress);
        }));
      }
      
      // Update dataset stats
      const [stats] = await db.select({
        itemCount: count(datasetItems.id),
        totalBytes: sql<number>`COALESCE(SUM(${datasetItems.byteSize}), 0)`,
      })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      await db.update(studioDatasets)
        .set({
          itemCount: stats.itemCount,
          totalBytes: stats.totalBytes,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, datasetId));
      
      logger.info(`Batch import complete: ${progress.succeeded} succeeded, ${progress.failed} failed, ${progress.skipped} skipped`);
      
      return { success: true, progress };
    } catch (error) {
      logger.error("Batch import failed:", error);
      throw error;
    }
  });

  /**
   * Import from JSONL file (standard dataset format)
   */
  ipcMain.handle("data-studio:import-jsonl", async (event, args: {
    datasetId: string;
    filePath: string;
    mapping?: Record<string, string>;
    mediaBasePath?: string;
  }) => {
    const progress: ImportProgress = {
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentFile: args.filePath,
      errors: [],
    };
    
    try {
      const { datasetId, filePath, mapping = {}, mediaBasePath } = args;
      
      // Count lines first
      const countStream = fs.createReadStream(filePath);
      const countRl = readline.createInterface({ input: countStream });
      for await (const _ of countRl) {
        progress.total++;
      }
      
      // Process lines
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream });
      
      for await (const line of rl) {
        if (!line.trim()) {
          progress.processed++;
          continue;
        }
        
        try {
          const record = JSON.parse(line);
          
          // Map fields
          const mappedRecord = mapping && Object.keys(mapping).length > 0
            ? Object.entries(mapping).reduce((acc, [target, source]) => {
                acc[target] = record[source];
                return acc;
              }, {} as Record<string, any>)
            : record;
          
          let contentHash: string;
          let byteSize: number;
          let modality = mappedRecord.modality || "text";
          
          // Handle content - either inline or file reference
          if (mappedRecord.content) {
            // Inline content
            const data = Buffer.from(
              typeof mappedRecord.content === "string" 
                ? mappedRecord.content 
                : JSON.stringify(mappedRecord.content),
              "utf-8"
            );
            const contentInfo = await storeContent(data, mappedRecord.mime_type || "text/plain");
            contentHash = contentInfo.hash;
            byteSize = data.length;
          } else if (mappedRecord.file_path && mediaBasePath) {
            // File reference
            const fullPath = path.join(mediaBasePath, mappedRecord.file_path);
            if (await fs.pathExists(fullPath)) {
              const data = await fs.readFile(fullPath);
              const mimeType = getMimeType(fullPath);
              const contentInfo = await storeContent(data, mimeType);
              contentHash = contentInfo.hash;
              byteSize = data.length;
              modality = detectModalityFromExtension(fullPath);
            } else {
              throw new Error(`Media file not found: ${fullPath}`);
            }
          } else if (mappedRecord.content_hash) {
            // Already have hash (reference existing content)
            contentHash = mappedRecord.content_hash;
            byteSize = mappedRecord.byte_size || 0;
          } else {
            throw new Error("No content, file_path, or content_hash in record");
          }
          
          const itemId = uuidv4();
          
          await db.insert(datasetItems).values({
            id: itemId,
            datasetId,
            modality,
            contentHash,
            byteSize,
            sourceType: mappedRecord.source_type || "imported",
            sourcePath: mappedRecord.file_path,
            generator: mappedRecord.generator || "human",
            contentUri: `cas://${contentHash}`,
            labelsJson: mappedRecord.labels || null,
            qualitySignalsJson: mappedRecord.quality_signals || null,
            license: mappedRecord.license || "unknown",
            split: mappedRecord.split || "unassigned",
          });
          
          progress.succeeded++;
        } catch (error) {
          progress.failed++;
          progress.errors.push({
            file: `Line ${progress.processed + 1}`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        progress.processed++;
        
        if (progress.processed % 100 === 0) {
          event.sender.send("data-studio:import-progress", progress);
        }
      }
      
      // Update dataset stats
      const [stats] = await db.select({
        itemCount: count(datasetItems.id),
        totalBytes: sql<number>`COALESCE(SUM(${datasetItems.byteSize}), 0)`,
      })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      await db.update(studioDatasets)
        .set({
          itemCount: stats.itemCount,
          totalBytes: stats.totalBytes,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, datasetId));
      
      return { success: true, progress };
    } catch (error) {
      logger.error("JSONL import failed:", error);
      throw error;
    }
  });

  /**
   * Import from CSV file
   */
  ipcMain.handle("data-studio:import-csv", async (event, args: {
    datasetId: string;
    filePath: string;
    delimiter?: string;
    hasHeader?: boolean;
    textColumn?: string;
    labelColumns?: string[];
  }) => {
    const progress: ImportProgress = {
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentFile: args.filePath,
      errors: [],
    };
    
    try {
      const {
        datasetId,
        filePath,
        delimiter = ",",
        hasHeader = true,
        textColumn = "text",
        labelColumns = [],
      } = args;
      
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      
      let headers: string[] = [];
      let startIndex = 0;
      
      if (hasHeader && lines.length > 0) {
        headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ""));
        startIndex = 1;
      }
      
      progress.total = lines.length - startIndex;
      
      for (let i = startIndex; i < lines.length; i++) {
        try {
          const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ""));
          
          const record: Record<string, string> = {};
          if (headers.length > 0) {
            headers.forEach((h, idx) => {
              record[h] = values[idx] || "";
            });
          } else {
            values.forEach((v, idx) => {
              record[`col_${idx}`] = v;
            });
          }
          
          const textContent = record[textColumn] || values[0] || "";
          if (!textContent) {
            progress.skipped++;
            progress.processed++;
            continue;
          }
          
          const data = Buffer.from(textContent, "utf-8");
          const contentInfo = await storeContent(data, "text/plain");
          
          const labels: Record<string, string> = {};
          labelColumns.forEach(col => {
            if (record[col]) {
              labels[col] = record[col];
            }
          });
          
          const itemId = uuidv4();
          
          await db.insert(datasetItems).values({
            id: itemId,
            datasetId,
            modality: "text",
            contentHash: contentInfo.hash,
            byteSize: data.length,
            sourceType: "imported",
            generator: "human",
            contentUri: `cas://${contentInfo.hash}`,
            labelsJson: Object.keys(labels).length > 0 ? labels : null,
            license: "unknown",
            split: "unassigned",
          });
          
          progress.succeeded++;
        } catch (error) {
          progress.failed++;
          progress.errors.push({
            file: `Row ${i + 1}`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        progress.processed++;
        
        if (progress.processed % 100 === 0) {
          event.sender.send("data-studio:import-progress", progress);
        }
      }
      
      // Update dataset stats
      const [stats] = await db.select({
        itemCount: count(datasetItems.id),
        totalBytes: sql<number>`COALESCE(SUM(${datasetItems.byteSize}), 0)`,
      })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      await db.update(studioDatasets)
        .set({
          itemCount: stats.itemCount,
          totalBytes: stats.totalBytes,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, datasetId));
      
      return { success: true, progress };
    } catch (error) {
      logger.error("CSV import failed:", error);
      throw error;
    }
  });

  // ========== Export Operations ==========

  /**
   * Export dataset to various formats
   */
  ipcMain.handle("data-studio:export-to-format", async (event, args: {
    datasetId: string;
    outputDir: string;
    format: "jsonl" | "csv" | "parquet" | "huggingface";
    includeMedia?: boolean;
    splitBy?: "split" | "modality";
    compression?: "none" | "gzip" | "zip";
  }) => {
    const progress: ExportProgress = {
      total: 0,
      exported: 0,
      currentItem: "",
    };
    
    try {
      const {
        datasetId,
        outputDir,
        format,
        includeMedia = true,
        splitBy,
        compression = "none",
      } = args;
      
      await fs.ensureDir(outputDir);
      
      // Get all items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      progress.total = items.length;
      
      // Get dataset info
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      // Write dataset metadata
      await fs.writeJson(path.join(outputDir, "dataset_info.json"), {
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        license: dataset.license,
        datasetType: dataset.datasetType,
        itemCount: dataset.itemCount,
        totalBytes: dataset.totalBytes,
        exportedAt: new Date().toISOString(),
        format,
      }, { spaces: 2 });
      
      // Group items if splitting
      const itemGroups: Map<string, typeof items> = new Map();
      
      if (splitBy === "split") {
        items.forEach(item => {
          const key = item.split || "unassigned";
          if (!itemGroups.has(key)) itemGroups.set(key, []);
          itemGroups.get(key)!.push(item);
        });
      } else if (splitBy === "modality") {
        items.forEach(item => {
          const key = item.modality;
          if (!itemGroups.has(key)) itemGroups.set(key, []);
          itemGroups.get(key)!.push(item);
        });
      } else {
        itemGroups.set("all", items);
      }
      
      // Export each group
      for (const [groupName, groupItems] of itemGroups) {
        const groupDir = splitBy ? path.join(outputDir, groupName) : outputDir;
        await fs.ensureDir(groupDir);
        
        if (format === "jsonl") {
          const outputPath = path.join(groupDir, `data.jsonl`);
          const lines: string[] = [];
          
          for (const item of groupItems) {
            progress.currentItem = item.id;
            
            const record: Record<string, any> = {
              id: item.id,
              modality: item.modality,
              content_hash: item.contentHash,
              byte_size: item.byteSize,
              source_type: item.sourceType,
              labels: item.labelsJson,
              quality_signals: item.qualitySignalsJson,
              license: item.license,
              split: item.split,
              created_at: item.createdAt,
            };
            
            if (includeMedia) {
              record.media_path = `media/${item.contentHash}`;
            } else {
              record.content_uri = item.contentUri;
            }
            
            lines.push(JSON.stringify(record));
            progress.exported++;
            
            if (progress.exported % 100 === 0) {
              event.sender.send("data-studio:export-progress", progress);
            }
          }
          
          await fs.writeFile(outputPath, lines.join("\n"));
        } else if (format === "csv") {
          const outputPath = path.join(groupDir, `data.csv`);
          const headers = ["id", "modality", "content_hash", "byte_size", "source_type", "license", "split", "created_at"];
          const rows: string[] = [headers.join(",")];
          
          for (const item of groupItems) {
            progress.currentItem = item.id;
            
            const values = [
              item.id,
              item.modality,
              item.contentHash,
              item.byteSize.toString(),
              item.sourceType,
              item.license || "",
              item.split || "",
              item.createdAt?.toISOString() || "",
            ];
            
            rows.push(values.map(v => `"${v}"`).join(","));
            progress.exported++;
          }
          
          await fs.writeFile(outputPath, rows.join("\n"));
        } else if (format === "huggingface") {
          // HuggingFace datasets format
          const dataDir = path.join(groupDir, "data");
          await fs.ensureDir(dataDir);
          
          // Write metadata
          await fs.writeJson(path.join(groupDir, "dataset_dict.json"), {
            splits: splitBy === "split" ? Array.from(itemGroups.keys()) : ["all"],
          });
          
          // Write data files
          const arrowPath = path.join(dataDir, `${groupName}-00000-of-00001.arrow`);
          // Note: Arrow format requires additional library - output JSONL as fallback
          const jsonlPath = path.join(dataDir, `${groupName}.jsonl`);
          
          const lines: string[] = [];
          for (const item of groupItems) {
            progress.currentItem = item.id;
            
            lines.push(JSON.stringify({
              id: item.id,
              modality: item.modality,
              content_hash: item.contentHash,
              labels: item.labelsJson,
              split: item.split,
            }));
            
            progress.exported++;
          }
          
          await fs.writeFile(jsonlPath, lines.join("\n"));
        }
        
        // Copy media files if requested
        if (includeMedia) {
          const mediaDir = path.join(groupDir, "media");
          await fs.ensureDir(mediaDir);
          
          for (const item of groupItems) {
            try {
              const [blob] = await db.select().from(contentBlobs).where(eq(contentBlobs.hash, item.contentHash));
              if (blob) {
                const storeDir = getContentStoreDir();
                const prefix = item.contentHash.substring(0, 2);
                const sourcePath = path.join(storeDir, prefix, item.contentHash);
                const destPath = path.join(mediaDir, item.contentHash);
                
                if (await fs.pathExists(sourcePath)) {
                  await fs.copy(sourcePath, destPath);
                }
              }
            } catch (error) {
              logger.warn(`Failed to copy media for item ${item.id}:`, error);
            }
          }
        }
      }
      
      // Handle compression
      if (compression === "zip") {
        // Use archiver for zip compression
        // Note: This would require the archiver package
        logger.info("ZIP compression requested - would compress here");
      }
      
      return { success: true, outputDir, progress };
    } catch (error) {
      logger.error("Export failed:", error);
      throw error;
    }
  });

  // ========== Data Validation ==========

  /**
   * Validate dataset items
   */
  ipcMain.handle("data-studio:validate-dataset", async (_event, args: {
    datasetId: string;
    checks?: {
      integrity?: boolean;
      labels?: boolean;
      quality?: boolean;
      licensing?: boolean;
    };
  }) => {
    try {
      const { datasetId, checks = { integrity: true, labels: true, quality: true, licensing: true } } = args;
      
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      const results: Array<{
        itemId: string;
        validation: DataValidationResult;
      }> = [];
      
      for (const item of items) {
        const validation: DataValidationResult = {
          isValid: true,
          errors: [],
          warnings: [],
        };
        
        // Integrity check
        if (checks.integrity) {
          const [blob] = await db.select().from(contentBlobs).where(eq(contentBlobs.hash, item.contentHash));
          if (!blob) {
            validation.errors.push({ field: "contentHash", message: "Content blob not found" });
            validation.isValid = false;
          } else {
            const storeDir = getContentStoreDir();
            const prefix = item.contentHash.substring(0, 2);
            const filePath = path.join(storeDir, prefix, item.contentHash);
            
            if (!(await fs.pathExists(filePath))) {
              validation.errors.push({ field: "contentFile", message: "Content file missing from store" });
              validation.isValid = false;
            }
          }
        }
        
        // Label check
        if (checks.labels) {
          if (!item.labelsJson || Object.keys(item.labelsJson).length === 0) {
            validation.warnings.push({ field: "labels", message: "Item has no labels" });
          }
        }
        
        // Quality check
        if (checks.quality) {
          if (!item.qualitySignalsJson) {
            validation.warnings.push({ field: "quality", message: "No quality signals computed" });
          }
        }
        
        // License check
        if (checks.licensing) {
          if (!item.license || item.license === "unknown") {
            validation.warnings.push({ field: "license", message: "License not specified" });
          }
        }
        
        results.push({ itemId: item.id, validation });
      }
      
      const summary = {
        total: results.length,
        valid: results.filter(r => r.validation.isValid).length,
        withErrors: results.filter(r => !r.validation.isValid).length,
        withWarnings: results.filter(r => r.validation.warnings.length > 0).length,
      };
      
      return { success: true, summary, results };
    } catch (error) {
      logger.error("Validation failed:", error);
      throw error;
    }
  });

  // ========== Deduplication ==========

  /**
   * Find duplicate items across datasets
   */
  ipcMain.handle("data-studio:find-duplicates", async (_event, args: {
    datasetIds?: string[];
    includeAllDatasets?: boolean;
  }) => {
    try {
      const { datasetIds, includeAllDatasets = false } = args;
      
      let items;
      if (includeAllDatasets) {
        items = await db.select({
          id: datasetItems.id,
          datasetId: datasetItems.datasetId,
          contentHash: datasetItems.contentHash,
          sourcePath: datasetItems.sourcePath,
        }).from(datasetItems);
      } else if (datasetIds && datasetIds.length > 0) {
        items = await db.select({
          id: datasetItems.id,
          datasetId: datasetItems.datasetId,
          contentHash: datasetItems.contentHash,
          sourcePath: datasetItems.sourcePath,
        })
          .from(datasetItems)
          .where(inArray(datasetItems.datasetId, datasetIds));
      } else {
        throw new Error("Must provide datasetIds or set includeAllDatasets");
      }
      
      // Group by hash
      const hashGroups: Map<string, Array<{ id: string; datasetId: string; sourcePath?: string | null }>> = new Map();
      
      for (const item of items) {
        if (!hashGroups.has(item.contentHash)) {
          hashGroups.set(item.contentHash, []);
        }
        hashGroups.get(item.contentHash)!.push({
          id: item.id,
          datasetId: item.datasetId,
          sourcePath: item.sourcePath,
        });
      }
      
      // Find duplicates (groups with more than one item)
      const duplicates: DuplicateGroup[] = [];
      
      for (const [hash, groupItems] of hashGroups) {
        if (groupItems.length > 1) {
          duplicates.push({ hash, items: groupItems });
        }
      }
      
      return {
        success: true,
        totalItems: items.length,
        uniqueItems: hashGroups.size,
        duplicateGroups: duplicates.length,
        duplicates,
      };
    } catch (error) {
      logger.error("Find duplicates failed:", error);
      throw error;
    }
  });

  /**
   * Remove duplicate items (keep first occurrence)
   */
  ipcMain.handle("data-studio:remove-duplicates", async (_event, args: {
    datasetId: string;
    keepStrategy?: "first" | "last" | "largest";
  }) => {
    try {
      const { datasetId, keepStrategy = "first" } = args;
      
      const items = await db.select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId))
        .orderBy(keepStrategy === "last" ? desc(datasetItems.createdAt) : datasetItems.createdAt);
      
      const seen: Set<string> = new Set();
      const toDelete: string[] = [];
      
      for (const item of items) {
        if (seen.has(item.contentHash)) {
          toDelete.push(item.id);
        } else {
          seen.add(item.contentHash);
        }
      }
      
      if (toDelete.length > 0) {
        await db.delete(datasetItems).where(inArray(datasetItems.id, toDelete));
        
        // Update stats
        const [stats] = await db.select({
          itemCount: count(datasetItems.id),
          totalBytes: sql<number>`COALESCE(SUM(${datasetItems.byteSize}), 0)`,
        })
          .from(datasetItems)
          .where(eq(datasetItems.datasetId, datasetId));
        
        await db.update(studioDatasets)
          .set({
            itemCount: stats.itemCount,
            totalBytes: stats.totalBytes,
            updatedAt: new Date(),
          })
          .where(eq(studioDatasets.id, datasetId));
      }
      
      return {
        success: true,
        removed: toDelete.length,
        remaining: seen.size,
      };
    } catch (error) {
      logger.error("Remove duplicates failed:", error);
      throw error;
    }
  });

  // ========== Backup & Restore ==========

  /**
   * Create dataset backup
   */
  ipcMain.handle("data-studio:create-backup", async (_event, args: {
    datasetId: string;
    includeMedia?: boolean;
    outputPath?: string;
  }) => {
    try {
      const { datasetId, includeMedia = true, outputPath } = args;
      
      const backupsDir = getBackupsDir();
      await fs.ensureDir(backupsDir);
      
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupName = `${dataset.name.replace(/\s+/g, "_")}_${timestamp}`;
      const backupDir = outputPath || path.join(backupsDir, backupName);
      await fs.ensureDir(backupDir);
      
      // Export dataset metadata
      await fs.writeJson(path.join(backupDir, "dataset.json"), dataset, { spaces: 2 });
      
      // Export items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      await fs.writeJson(path.join(backupDir, "items.json"), items, { spaces: 2 });
      
      // Export provenance
      const itemIds = items.map(i => i.id);
      if (itemIds.length > 0) {
        const provenance = await db.select()
          .from(provenanceRecords)
          .where(inArray(provenanceRecords.itemId, itemIds));
        await fs.writeJson(path.join(backupDir, "provenance.json"), provenance, { spaces: 2 });
      }
      
      // Export manifests
      const manifests = await db.select()
        .from(datasetManifests)
        .where(eq(datasetManifests.datasetId, datasetId));
      await fs.writeJson(path.join(backupDir, "manifests.json"), manifests, { spaces: 2 });
      
      // Copy media files
      let mediaSize = 0;
      if (includeMedia) {
        const mediaDir = path.join(backupDir, "media");
        await fs.ensureDir(mediaDir);
        
        for (const item of items) {
          try {
            const storeDir = getContentStoreDir();
            const prefix = item.contentHash.substring(0, 2);
            const sourcePath = path.join(storeDir, prefix, item.contentHash);
            const destPath = path.join(mediaDir, item.contentHash);
            
            if (await fs.pathExists(sourcePath)) {
              await fs.copy(sourcePath, destPath);
              const stat = await fs.stat(destPath);
              mediaSize += stat.size;
            }
          } catch (error) {
            logger.warn(`Failed to backup media for item ${item.id}`);
          }
        }
      }
      
      // Write backup metadata
      const backupMeta: DatasetBackup = {
        id: uuidv4(),
        datasetId,
        createdAt: new Date(),
        size: mediaSize,
        itemCount: items.length,
        path: backupDir,
      };
      
      await fs.writeJson(path.join(backupDir, "backup_meta.json"), backupMeta, { spaces: 2 });
      
      return { success: true, backup: backupMeta };
    } catch (error) {
      logger.error("Create backup failed:", error);
      throw error;
    }
  });

  /**
   * Restore dataset from backup
   */
  ipcMain.handle("data-studio:restore-backup", async (_event, args: {
    backupPath: string;
    newName?: string;
    overwriteExisting?: boolean;
  }) => {
    try {
      const { backupPath, newName, overwriteExisting = false } = args;
      
      // Read backup metadata
      const metaPath = path.join(backupPath, "backup_meta.json");
      if (!(await fs.pathExists(metaPath))) {
        throw new Error("Invalid backup: missing backup_meta.json");
      }
      
      const backupMeta = await fs.readJson(metaPath);
      
      // Read dataset
      const datasetData = await fs.readJson(path.join(backupPath, "dataset.json"));
      
      // Check for existing dataset
      const existingDataset = await db.select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetData.id))
        .limit(1);
      
      let targetDatasetId: string;
      
      if (existingDataset.length > 0 && !overwriteExisting) {
        // Create new dataset with different ID
        targetDatasetId = uuidv4();
        await db.insert(studioDatasets).values({
          ...datasetData,
          id: targetDatasetId,
          name: newName || `${datasetData.name} (Restored)`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else if (existingDataset.length > 0 && overwriteExisting) {
        targetDatasetId = datasetData.id;
        // Delete existing items
        await db.delete(datasetItems).where(eq(datasetItems.datasetId, targetDatasetId));
        // Update dataset
        await db.update(studioDatasets)
          .set({
            ...datasetData,
            name: newName || datasetData.name,
            updatedAt: new Date(),
          })
          .where(eq(studioDatasets.id, targetDatasetId));
      } else {
        targetDatasetId = datasetData.id;
        await db.insert(studioDatasets).values({
          ...datasetData,
          name: newName || datasetData.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      
      // Restore items
      const itemsData = await fs.readJson(path.join(backupPath, "items.json"));
      const idMapping: Map<string, string> = new Map();
      
      for (const item of itemsData) {
        const newItemId = targetDatasetId !== datasetData.id ? uuidv4() : item.id;
        idMapping.set(item.id, newItemId);
        
        await db.insert(datasetItems).values({
          ...item,
          id: newItemId,
          datasetId: targetDatasetId,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(),
        }).onConflictDoNothing();
      }
      
      // Restore media files
      const mediaDir = path.join(backupPath, "media");
      if (await fs.pathExists(mediaDir)) {
        const storeDir = getContentStoreDir();
        const mediaFiles = await fs.readdir(mediaDir);
        
        for (const hash of mediaFiles) {
          const sourcePath = path.join(mediaDir, hash);
          const prefix = hash.substring(0, 2);
          const targetDir = path.join(storeDir, prefix);
          await fs.ensureDir(targetDir);
          const destPath = path.join(targetDir, hash);
          
          if (!(await fs.pathExists(destPath))) {
            await fs.copy(sourcePath, destPath);
          }
        }
      }
      
      // Restore provenance
      const provenancePath = path.join(backupPath, "provenance.json");
      if (await fs.pathExists(provenancePath)) {
        const provenanceData = await fs.readJson(provenancePath);
        
        for (const record of provenanceData) {
          const newItemId = idMapping.get(record.itemId);
          if (newItemId) {
            await db.insert(provenanceRecords).values({
              ...record,
              id: uuidv4(),
              itemId: newItemId,
              timestamp: new Date(record.timestamp),
            }).onConflictDoNothing();
          }
        }
      }
      
      return { success: true, datasetId: targetDatasetId, itemsRestored: itemsData.length };
    } catch (error) {
      logger.error("Restore backup failed:", error);
      throw error;
    }
  });

  /**
   * List available backups
   */
  ipcMain.handle("data-studio:list-backups", async () => {
    try {
      const backupsDir = getBackupsDir();
      if (!(await fs.pathExists(backupsDir))) {
        return { backups: [] };
      }
      
      const entries = await fs.readdir(backupsDir, { withFileTypes: true });
      const backups: DatasetBackup[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(backupsDir, entry.name, "backup_meta.json");
          if (await fs.pathExists(metaPath)) {
            const meta = await fs.readJson(metaPath);
            backups.push(meta);
          }
        }
      }
      
      return { backups: backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) };
    } catch (error) {
      logger.error("List backups failed:", error);
      throw error;
    }
  });

  // ========== Search & Filter ==========

  /**
   * Advanced search across datasets
   */
  ipcMain.handle("data-studio:advanced-search", async (_event, args: {
    query?: string;
    datasetIds?: string[];
    filters?: {
      modalities?: string[];
      splits?: string[];
      licenses?: string[];
      sourceTypes?: string[];
      minSize?: number;
      maxSize?: number;
      dateRange?: { start?: string; end?: string };
      hasLabels?: boolean;
      hasQualitySignals?: boolean;
    };
    pagination?: { limit?: number; offset?: number };
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) => {
    try {
      const {
        query,
        datasetIds,
        filters = {},
        pagination = { limit: 100, offset: 0 },
        sortBy = "createdAt",
        sortOrder = "desc",
      } = args;
      
      const conditions: any[] = [];
      
      // Dataset filter
      if (datasetIds && datasetIds.length > 0) {
        conditions.push(inArray(datasetItems.datasetId, datasetIds));
      }
      
      // Modality filter
      if (filters.modalities && filters.modalities.length > 0) {
        conditions.push(inArray(datasetItems.modality, filters.modalities as any[]));
      }
      
      // Split filter
      if (filters.splits && filters.splits.length > 0) {
        conditions.push(inArray(datasetItems.split, filters.splits as any[]));
      }
      
      // Source type filter
      if (filters.sourceTypes && filters.sourceTypes.length > 0) {
        conditions.push(inArray(datasetItems.sourceType, filters.sourceTypes as any[]));
      }
      
      // Size filters
      if (filters.minSize !== undefined) {
        conditions.push(gte(datasetItems.byteSize, filters.minSize));
      }
      if (filters.maxSize !== undefined) {
        conditions.push(lte(datasetItems.byteSize, filters.maxSize));
      }
      
      // Label filter
      if (filters.hasLabels === true) {
        conditions.push(isNotNull(datasetItems.labelsJson));
      } else if (filters.hasLabels === false) {
        conditions.push(isNull(datasetItems.labelsJson));
      }
      
      // Quality signals filter
      if (filters.hasQualitySignals === true) {
        conditions.push(isNotNull(datasetItems.qualitySignalsJson));
      } else if (filters.hasQualitySignals === false) {
        conditions.push(isNull(datasetItems.qualitySignalsJson));
      }
      
      // Build query
      let queryBuilder = db.select().from(datasetItems);
      
      if (conditions.length > 0) {
        queryBuilder = queryBuilder.where(and(...conditions)) as any;
      }
      
      // Sorting
      const sortColumn = (datasetItems as any)[sortBy] || datasetItems.createdAt;
      queryBuilder = queryBuilder.orderBy(sortOrder === "desc" ? desc(sortColumn) : sortColumn) as any;
      
      // Pagination
      queryBuilder = queryBuilder.limit(pagination.limit || 100).offset(pagination.offset || 0) as any;
      
      const items = await queryBuilder;
      
      // Get total count
      const [countResult] = await db.select({ count: count() })
        .from(datasetItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return {
        items,
        total: countResult.count,
        limit: pagination.limit || 100,
        offset: pagination.offset || 0,
      };
    } catch (error) {
      logger.error("Advanced search failed:", error);
      throw error;
    }
  });

  // ========== Statistics ==========

  /**
   * Get comprehensive dataset statistics
   */
  ipcMain.handle("data-studio:get-statistics", async (_event, datasetId: string) => {
    try {
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      // Modality distribution
      const modalityDistribution: Record<string, number> = {};
      items.forEach(item => {
        modalityDistribution[item.modality] = (modalityDistribution[item.modality] || 0) + 1;
      });
      
      // Split distribution
      const splitDistribution: Record<string, number> = { train: 0, val: 0, test: 0, unassigned: 0 };
      items.forEach(item => {
        splitDistribution[item.split || "unassigned"]++;
      });
      
      // Source type distribution
      const sourceDistribution: Record<string, number> = {};
      items.forEach(item => {
        sourceDistribution[item.sourceType] = (sourceDistribution[item.sourceType] || 0) + 1;
      });
      
      // License distribution
      const licenseDistribution: Record<string, number> = {};
      items.forEach(item => {
        const license = item.license || "unknown";
        licenseDistribution[license] = (licenseDistribution[license] || 0) + 1;
      });
      
      // Size statistics
      const sizes = items.map(i => i.byteSize);
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      const avgSize = sizes.length > 0 ? totalSize / sizes.length : 0;
      const minSize = sizes.length > 0 ? Math.min(...sizes) : 0;
      const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
      
      // Label coverage
      const withLabels = items.filter(i => i.labelsJson && Object.keys(i.labelsJson).length > 0).length;
      const withQuality = items.filter(i => i.qualitySignalsJson).length;
      
      // Date range
      const dates = items.map(i => i.createdAt).filter(Boolean).sort();
      
      return {
        basic: {
          itemCount: items.length,
          totalBytes: totalSize,
        },
        distribution: {
          modality: modalityDistribution,
          split: splitDistribution,
          source: sourceDistribution,
          license: licenseDistribution,
        },
        size: {
          total: totalSize,
          average: avgSize,
          min: minSize,
          max: maxSize,
        },
        coverage: {
          withLabels,
          withQuality,
          labelPercentage: items.length > 0 ? (withLabels / items.length) * 100 : 0,
          qualityPercentage: items.length > 0 ? (withQuality / items.length) * 100 : 0,
        },
        dateRange: {
          earliest: dates[0] || null,
          latest: dates[dates.length - 1] || null,
        },
      };
    } catch (error) {
      logger.error("Get statistics failed:", error);
      throw error;
    }
  });

  logger.info("Data Studio Core handlers registered");
}
