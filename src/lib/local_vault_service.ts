// =============================================================================
// Local Vault Service — the sovereign data refinery engine
// Runs in the Electron main process
// =============================================================================

import { randomUUID } from "node:crypto";
import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import log from "electron-log";
import { eq, desc, and, inArray, like, sql } from "drizzle-orm";
import { db } from "../db";
import {
  vaultConnectors,
  vaultAssets,
  transformJobs,
  packageManifests,
  policyDocuments,
  publishBundles,
  vaultAuditLog,
} from "../db/vault_schema";
import type {
  VaultStatus,
  VaultConfig,
  ConnectorConfig,
  ConnectorType,
  AssetModality,
  VaultAsset,
  TransformJob,
  TransformStageConfig,
  PackageManifest,
  PolicyDocument,
  PublishBundle,
  VaultAuditEntry,
  AuditAction,
  PiiField,
} from "../types/local_vault";

const logger = log.scope("local-vault");

// ---- Vault paths ----
function getVaultDir(): string {
  return path.join(app.getPath("userData"), "local_vault");
}

function getContentStoreDir(): string {
  return path.join(getVaultDir(), "content_store");
}

function getVaultConfigPath(): string {
  return path.join(getVaultDir(), "vault_config.json");
}

function getVaultKeyPath(): string {
  return path.join(getVaultDir(), ".vault_key");
}

// ---- Ensure directories ----
function ensureVaultDirs(): void {
  const dirs = [getVaultDir(), getContentStoreDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ---- Default config ----
const DEFAULT_CONFIG: VaultConfig = {
  autoLockMinutes: 30,
  encryptAtRest: true,
  defaultLicense: "cc-by-4.0",
  autoDeduplication: true,
  piiRedactionEnabled: true,
  maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
  localPinning: true,
  lanDiscovery: false,
};

// ---- In-memory state ----
let vaultConfig: VaultConfig = { ...DEFAULT_CONFIG };
let vaultMasterKey: Buffer | null = null;
let vaultUnlocked = false;

// =============================================================================
// VAULT CORE
// =============================================================================

export function getVaultStatus(): VaultStatus {
  ensureVaultDirs();
  const initialized = fs.existsSync(getVaultConfigPath());

  let totalAssets = 0;
  let totalBytes = 0;
  let connectorCount = 0;

  try {
    const assetStats = db
      .select({
        count: sql<number>`COUNT(*)`,
        bytes: sql<number>`COALESCE(SUM(byte_size), 0)`,
      })
      .from(vaultAssets)
      .get();

    totalAssets = assetStats?.count ?? 0;
    totalBytes = assetStats?.bytes ?? 0;

    const connStats = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(vaultConnectors)
      .get();
    connectorCount = connStats?.count ?? 0;
  } catch {
    // DB not ready yet
  }

  return {
    initialized,
    unlocked: vaultUnlocked,
    totalAssets,
    totalBytes,
    connectorCount,
    lastSyncAt: null,
    storageHealth: "healthy",
    encryptionEnabled: vaultConfig.encryptAtRest,
  };
}

export function initializeVault(passphrase?: string): void {
  ensureVaultDirs();

  if (passphrase) {
    const salt = randomBytes(32);
    const key = pbkdf2Sync(passphrase, salt, 100_000, 32, "sha512");
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const masterKey = randomBytes(32);
    const encrypted = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    fs.writeFileSync(
      getVaultKeyPath(),
      JSON.stringify({
        salt: salt.toString("hex"),
        iv: iv.toString("hex"),
        encryptedKey: encrypted.toString("hex"),
        authTag: authTag.toString("hex"),
      }),
    );
    vaultMasterKey = masterKey;
    vaultUnlocked = true;
  }

  fs.writeFileSync(getVaultConfigPath(), JSON.stringify(vaultConfig, null, 2));
  writeAuditLog("vault_unlocked", undefined, undefined, "Vault initialized");
  logger.info("Vault initialized");
}

/**
 * Load vault config from disk on app startup.
 * Re-hydrates in-memory vaultConfig from the saved JSON if the vault was
 * previously initialized. Safe to call even if the vault doesn't exist yet.
 */
export function loadVaultConfigFromDisk(): void {
  try {
    const configPath = getVaultConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const persisted = JSON.parse(raw);
      vaultConfig = { ...DEFAULT_CONFIG, ...persisted };
      logger.info("Vault config loaded from disk");
    }
  } catch (err) {
    logger.warn("Could not load vault config from disk:", err);
  }
}

export function unlockVault(passphrase: string): boolean {
  try {
    const keyData = JSON.parse(fs.readFileSync(getVaultKeyPath(), "utf-8"));
    const salt = Buffer.from(keyData.salt, "hex");
    const iv = Buffer.from(keyData.iv, "hex");
    const encrypted = Buffer.from(keyData.encryptedKey, "hex");
    const authTag = Buffer.from(keyData.authTag, "hex");

    const key = pbkdf2Sync(passphrase, salt, 100_000, 32, "sha512");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    vaultMasterKey = decrypted;
    vaultUnlocked = true;
    writeAuditLog("vault_unlocked");
    return true;
  } catch {
    return false;
  }
}

export function lockVault(): void {
  vaultMasterKey = null;
  vaultUnlocked = false;
  writeAuditLog("vault_locked");
}

export function getVaultConfig(): VaultConfig {
  return { ...vaultConfig };
}

export function updateVaultConfig(partial: Partial<VaultConfig>): VaultConfig {
  vaultConfig = { ...vaultConfig, ...partial };
  ensureVaultDirs();
  fs.writeFileSync(getVaultConfigPath(), JSON.stringify(vaultConfig, null, 2));
  return { ...vaultConfig };
}

// =============================================================================
// CONTENT-ADDRESSED STORAGE
// =============================================================================

function hashContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function getStoragePath(hash: string): string {
  // Use 2-level directory sharding: ab/cd/abcdef...
  const dir = path.join(getContentStoreDir(), hash.slice(0, 2), hash.slice(2, 4));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, hash);
}

function encryptBuffer(buffer: Buffer): { encrypted: Buffer; iv: string; authTag: string } {
  if (!vaultMasterKey) throw new Error("Vault is locked");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", vaultMasterKey, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

function decryptBuffer(encrypted: Buffer, ivHex: string, authTagHex: string): Buffer {
  if (!vaultMasterKey) throw new Error("Vault is locked");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", vaultMasterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function storeContent(buffer: Buffer, encrypt: boolean): { hash: string; storagePath: string; encrypted: boolean } {
  const hash = hashContent(buffer);
  const storagePath = getStoragePath(hash);

  if (fs.existsSync(storagePath)) {
    // Deduplicated — already stored
    return { hash, storagePath, encrypted: false };
  }

  if (encrypt && vaultMasterKey) {
    const { encrypted: enc, iv, authTag } = encryptBuffer(buffer);
    // Write encrypted blob + metadata sidecar
    fs.writeFileSync(storagePath, enc);
    fs.writeFileSync(
      `${storagePath}.meta`,
      JSON.stringify({ iv, authTag, encrypted: true }),
    );
    return { hash, storagePath, encrypted: true };
  }

  fs.writeFileSync(storagePath, buffer);
  return { hash, storagePath, encrypted: false };
}

function readContent(storagePath: string): Buffer {
  const metaPath = `${storagePath}.meta`;
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (meta.encrypted) {
      const encrypted = fs.readFileSync(storagePath);
      return decryptBuffer(encrypted, meta.iv, meta.authTag);
    }
  }
  return fs.readFileSync(storagePath);
}

// =============================================================================
// CONNECTOR MANAGEMENT
// =============================================================================

export function listConnectors(): ConnectorConfig[] {
  const rows = db.select().from(vaultConnectors).orderBy(desc(vaultConnectors.createdAt)).all();
  return rows.map(rowToConnectorConfig);
}

export function getConnector(id: string): ConnectorConfig | null {
  const row = db.select().from(vaultConnectors).where(eq(vaultConnectors.id, id)).get();
  return row ? rowToConnectorConfig(row) : null;
}

export function addConnector(config: {
  type: ConnectorType;
  name: string;
  description?: string;
  sourcePath?: string;
  sourceUrl?: string;
  watchPattern?: string;
  autoImport?: boolean;
  requirePreview?: boolean;
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  excludePatterns?: string[];
  syncIntervalMinutes?: number;
}): ConnectorConfig {
  const id = randomUUID();
  db.insert(vaultConnectors)
    .values({
      id,
      type: config.type,
      name: config.name,
      description: config.description ?? null,
      status: "enabled",
      sourcePath: config.sourcePath ?? null,
      sourceUrl: config.sourceUrl ?? null,
      watchPattern: config.watchPattern ?? null,
      autoImport: config.autoImport ?? false,
      requirePreview: config.requirePreview ?? true,
      allowedMimeTypes: config.allowedMimeTypes ?? null,
      maxFileSize: config.maxFileSize ?? null,
      excludePatterns: config.excludePatterns ?? null,
      syncIntervalMinutes: config.syncIntervalMinutes ?? null,
    })
    .run();

  writeAuditLog("connector_added", id, "connector", `Added connector: ${config.name}`);
  return getConnector(id)!;
}

export function updateConnector(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    status: string;
    sourcePath: string;
    sourceUrl: string;
    autoImport: boolean;
    requirePreview: boolean;
    syncIntervalMinutes: number;
  }>,
): ConnectorConfig | null {
  const existing = getConnector(id);
  if (!existing) return null;

  db.update(vaultConnectors)
    .set({
      ...(updates as any),
      updatedAt: new Date(),
    })
    .where(eq(vaultConnectors.id, id))
    .run();

  return getConnector(id);
}

export function removeConnector(id: string): void {
  db.delete(vaultConnectors).where(eq(vaultConnectors.id, id)).run();
  writeAuditLog("connector_removed", id, "connector");
}

export function enableConnector(id: string): ConnectorConfig | null {
  return updateConnector(id, { status: "enabled" });
}

export function disableConnector(id: string): ConnectorConfig | null {
  return updateConnector(id, { status: "disabled" });
}

function rowToConnectorConfig(row: any): ConnectorConfig {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description ?? "",
    status: row.status,
    sourcePath: row.sourcePath ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    watchPattern: row.watchPattern ?? undefined,
    autoImport: row.autoImport ?? false,
    requirePreview: row.requirePreview ?? true,
    allowedMimeTypes: row.allowedMimeTypes ?? undefined,
    maxFileSize: row.maxFileSize ?? undefined,
    excludePatterns: row.excludePatterns ?? undefined,
    syncIntervalMinutes: row.syncIntervalMinutes ?? undefined,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? undefined,
    nextSyncAt: row.nextSyncAt?.toISOString() ?? undefined,
    totalImported: row.totalImported ?? 0,
    totalBytes: row.totalBytes ?? 0,
    errorCount: row.errorCount ?? 0,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

// =============================================================================
// ASSET INGESTION
// =============================================================================

export function importFile(filePath: string, connectorId?: string): VaultAsset {
  ensureVaultDirs();
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = guessMimeType(ext);
  const modality = guessModality(mimeType);

  const { hash, storagePath, encrypted } = storeContent(
    buffer,
    vaultConfig.encryptAtRest,
  );

  // Check for duplicate
  const existing = db
    .select()
    .from(vaultAssets)
    .where(eq(vaultAssets.contentHash, hash))
    .get();
  if (existing && vaultConfig.autoDeduplication) {
    logger.info(`Deduplicated: ${fileName} (hash: ${hash.slice(0, 12)}...)`);
    return rowToVaultAsset(existing);
  }

  const id = randomUUID();
  db.insert(vaultAssets)
    .values({
      id,
      name: fileName,
      modality,
      mimeType,
      status: "ingested",
      contentHash: hash,
      byteSize: buffer.length,
      storagePath,
      encrypted,
      connectorId: connectorId ?? null,
      sourcePath: filePath,
      tags: [],
      collections: [],
      piiDetected: false,
      piiRedacted: false,
    })
    .run();

  // Update connector stats
  if (connectorId) {
    db.run(sql`
      UPDATE vault_connectors
      SET total_imported = total_imported + 1,
          total_bytes = total_bytes + ${buffer.length},
          last_sync_at = unixepoch(),
          updated_at = unixepoch()
      WHERE id = ${connectorId}
    `);
  }

  writeAuditLog("asset_imported", id, "asset", `Imported: ${fileName}`);
  return rowToVaultAsset(db.select().from(vaultAssets).where(eq(vaultAssets.id, id)).get()!);
}

export function importFolder(
  folderPath: string,
  connectorId?: string,
  options?: { recursive?: boolean; allowedExtensions?: string[] },
): VaultAsset[] {
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }

  const assets: VaultAsset[] = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isFile()) {
      if (options?.allowedExtensions) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!options.allowedExtensions.includes(ext)) continue;
      }
      try {
        assets.push(importFile(fullPath, connectorId));
      } catch (err) {
        logger.warn(`Failed to import ${fullPath}: ${err}`);
      }
    } else if (entry.isDirectory() && options?.recursive) {
      assets.push(...importFolder(fullPath, connectorId, options));
    }
  }

  return assets;
}

export function importText(
  name: string,
  content: string,
  connectorId?: string,
): VaultAsset {
  ensureVaultDirs();
  const buffer = Buffer.from(content, "utf-8");
  const { hash, storagePath, encrypted } = storeContent(
    buffer,
    vaultConfig.encryptAtRest,
  );

  const id = randomUUID();
  db.insert(vaultAssets)
    .values({
      id,
      name,
      modality: "text",
      mimeType: "text/plain",
      status: "ingested",
      contentHash: hash,
      byteSize: buffer.length,
      storagePath,
      encrypted,
      connectorId: connectorId ?? null,
      tags: [],
      collections: [],
      piiDetected: false,
      piiRedacted: false,
    })
    .run();

  writeAuditLog("asset_imported", id, "asset", `Imported text: ${name}`);
  return rowToVaultAsset(db.select().from(vaultAssets).where(eq(vaultAssets.id, id)).get()!);
}

// =============================================================================
// ASSET CRUD
// =============================================================================

export function listAssets(filters?: {
  status?: string;
  modality?: string;
  connectorId?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}): { assets: VaultAsset[]; total: number } {
  let query = db.select().from(vaultAssets);
  const conditions: any[] = [];

  if (filters?.status) conditions.push(eq(vaultAssets.status, filters.status as any));
  if (filters?.modality) conditions.push(eq(vaultAssets.modality, filters.modality as any));
  if (filters?.connectorId) conditions.push(eq(vaultAssets.connectorId, filters.connectorId));
  if (filters?.search) conditions.push(like(vaultAssets.name, `%${filters.search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(vaultAssets)
    .where(whereClause)
    .get();
  const total = totalResult?.count ?? 0;

  const rows = db
    .select()
    .from(vaultAssets)
    .where(whereClause)
    .orderBy(desc(vaultAssets.importedAt))
    .limit(filters?.limit ?? 100)
    .offset(filters?.offset ?? 0)
    .all();

  return { assets: rows.map(rowToVaultAsset), total };
}

export function getAsset(id: string): VaultAsset | null {
  const row = db.select().from(vaultAssets).where(eq(vaultAssets.id, id)).get();
  return row ? rowToVaultAsset(row) : null;
}

export function getAssetContent(id: string): Buffer {
  const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, id)).get();
  if (!asset) throw new Error(`Asset not found: ${id}`);
  return readContent(asset.storagePath);
}

export function updateAsset(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    tags: string[];
    collections: string[];
    status: string;
  }>,
): VaultAsset | null {
  const existing = getAsset(id);
  if (!existing) return null;

  db.update(vaultAssets)
    .set({
      ...(updates as any),
      updatedAt: new Date(),
    })
    .where(eq(vaultAssets.id, id))
    .run();

  return getAsset(id);
}

export function deleteAsset(id: string): void {
  const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, id)).get();
  if (asset) {
    // Remove content file if no other assets reference the same hash
    const otherRefs = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(vaultAssets)
      .where(and(eq(vaultAssets.contentHash, asset.contentHash), sql`id != ${id}`))
      .get();
    if ((otherRefs?.count ?? 0) === 0) {
      try {
        fs.unlinkSync(asset.storagePath);
        const metaPath = `${asset.storagePath}.meta`;
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } catch {
        // Best effort
      }
    }
  }
  db.delete(vaultAssets).where(eq(vaultAssets.id, id)).run();
  writeAuditLog("asset_deleted", id, "asset");
}

// =============================================================================
// TRANSFORM PIPELINE
// =============================================================================

export function createTransformJob(config: {
  name: string;
  inputAssetIds: string[];
  inputDatasetId?: string;
  stages: TransformStageConfig[];
}): TransformJob {
  const id = randomUUID();
  const itemsTotal = config.inputAssetIds.length;

  db.insert(transformJobs)
    .values({
      id,
      name: config.name,
      inputAssetIds: config.inputAssetIds,
      inputDatasetId: config.inputDatasetId ?? null,
      stagesJson: config.stages as any,
      status: "pending",
      progress: 0,
      itemsProcessed: 0,
      itemsTotal,
      outputAssetIds: [],
      errorCount: 0,
      auditLogJson: [],
    })
    .run();

  writeAuditLog("transform_started", id, "transform", `Created job: ${config.name}`);
  return getTransformJob(id)!;
}

export function getTransformJob(id: string): TransformJob | null {
  const row = db.select().from(transformJobs).where(eq(transformJobs.id, id)).get();
  return row ? rowToTransformJob(row) : null;
}

export function listTransformJobs(limit = 50): TransformJob[] {
  const rows = db
    .select()
    .from(transformJobs)
    .orderBy(desc(transformJobs.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToTransformJob);
}

export async function runTransformJob(id: string): Promise<TransformJob> {
  const job = db.select().from(transformJobs).where(eq(transformJobs.id, id)).get();
  if (!job) throw new Error(`Transform job not found: ${id}`);

  db.update(transformJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(transformJobs.id, id))
    .run();

  const stages: any[] = (job.stagesJson as any[]) ?? [];
  const auditLog: any[] = [];
  let processedCount = 0;
  const outputIds: string[] = [];

  try {
    for (const stageConfig of stages) {
      if (!stageConfig.enabled) continue;
      const stage = stageConfig.stage;

      db.update(transformJobs)
        .set({ currentStage: stage })
        .where(eq(transformJobs.id, id))
        .run();

      const startTime = Date.now();
      const inputIds = (job.inputAssetIds as string[]) ?? [];

      // Execute stage
      const stageResult = await executeStage(stage, inputIds, stageConfig.config);

      const duration = Date.now() - startTime;
      auditLog.push({
        stage,
        action: `Executed ${stage}`,
        inputCount: inputIds.length,
        outputCount: stageResult.outputCount,
        droppedCount: stageResult.droppedCount,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        details: stageResult.details,
      });

      processedCount += stageResult.outputCount;
      outputIds.push(...stageResult.outputIds);

      // Update progress
      const stageIndex = stages.indexOf(stageConfig);
      const progress = Math.round(((stageIndex + 1) / stages.length) * 100);
      db.update(transformJobs)
        .set({
          progress,
          itemsProcessed: processedCount,
          auditLogJson: auditLog,
        })
        .where(eq(transformJobs.id, id))
        .run();
    }

    db.update(transformJobs)
      .set({
        status: "completed",
        progress: 100,
        outputAssetIds: outputIds,
        auditLogJson: auditLog,
        completedAt: new Date(),
      })
      .where(eq(transformJobs.id, id))
      .run();

    writeAuditLog("transform_completed", id, "transform");
  } catch (err: any) {
    db.update(transformJobs)
      .set({
        status: "failed",
        errorMessage: err.message,
        errorCount: 1,
        auditLogJson: auditLog,
      })
      .where(eq(transformJobs.id, id))
      .run();
    writeAuditLog("transform_failed", id, "transform", err.message);
  }

  return getTransformJob(id)!;
}

async function executeStage(
  stage: string,
  assetIds: string[],
  config: Record<string, unknown>,
): Promise<{
  outputCount: number;
  droppedCount: number;
  outputIds: string[];
  details: string;
}> {
  switch (stage) {
    case "extract":
      return executeExtractStage(assetIds, config);
    case "normalize":
      return executeNormalizeStage(assetIds, config);
    case "deduplicate":
      return executeDeduplicateStage(assetIds, config);
    case "redact":
      return executeRedactStage(assetIds, config);
    case "label":
      return executeLabelStage(assetIds, config);
    default:
      return {
        outputCount: assetIds.length,
        droppedCount: 0,
        outputIds: assetIds,
        details: `Stage ${stage} passed through`,
      };
  }
}

async function executeExtractStage(
  assetIds: string[],
  _config: Record<string, unknown>,
): Promise<{ outputCount: number; droppedCount: number; outputIds: string[]; details: string }> {
  // Extract metadata from each asset
  for (const assetId of assetIds) {
    try {
      const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
      if (!asset) continue;

      const content = readContent(asset.storagePath);
      const metadata: Record<string, unknown> = {
        extractedAt: new Date().toISOString(),
        byteSize: content.length,
        mimeType: asset.mimeType,
      };

      if (asset.mimeType.startsWith("text/")) {
        const text = content.toString("utf-8");
        metadata.charCount = text.length;
        metadata.lineCount = text.split("\n").length;
        metadata.wordCount = text.split(/\s+/).filter(Boolean).length;
      }

      db.update(vaultAssets)
        .set({
          metadataJson: metadata,
          status: "processing",
          updatedAt: new Date(),
        })
        .where(eq(vaultAssets.id, assetId))
        .run();
    } catch (err) {
      logger.warn(`Extract failed for ${assetId}: ${err}`);
    }
  }

  return {
    outputCount: assetIds.length,
    droppedCount: 0,
    outputIds: assetIds,
    details: `Extracted metadata from ${assetIds.length} assets`,
  };
}

async function executeNormalizeStage(
  assetIds: string[],
  config: Record<string, unknown>,
): Promise<{ outputCount: number; droppedCount: number; outputIds: string[]; details: string }> {
  let normalized = 0;
  for (const assetId of assetIds) {
    try {
      const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
      if (!asset || !asset.mimeType.startsWith("text/")) continue;

      let text = readContent(asset.storagePath).toString("utf-8");

      if (config.trimWhitespace) text = text.trim();
      if (config.normalizeNewlines) text = text.replace(/\r\n/g, "\n");
      if (config.removeHtmlTags) text = text.replace(/<[^>]*>/g, "");

      // Re-store normalized content
      const buffer = Buffer.from(text, "utf-8");
      const { hash, storagePath, encrypted } = storeContent(buffer, vaultConfig.encryptAtRest);

      db.update(vaultAssets)
        .set({
          contentHash: hash,
          storagePath,
          byteSize: buffer.length,
          encrypted,
          updatedAt: new Date(),
        })
        .where(eq(vaultAssets.id, assetId))
        .run();

      normalized++;
    } catch (err) {
      logger.warn(`Normalize failed for ${assetId}: ${err}`);
    }
  }

  return {
    outputCount: assetIds.length,
    droppedCount: 0,
    outputIds: assetIds,
    details: `Normalized ${normalized} text assets`,
  };
}

async function executeDeduplicateStage(
  assetIds: string[],
  config: Record<string, unknown>,
): Promise<{ outputCount: number; droppedCount: number; outputIds: string[]; details: string }> {
  const seen = new Map<string, string>();
  const kept: string[] = [];
  let dropped = 0;

  for (const assetId of assetIds) {
    const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
    if (!asset) continue;

    if (seen.has(asset.contentHash)) {
      dropped++;
      // Mark as archived
      db.update(vaultAssets)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(vaultAssets.id, assetId))
        .run();
    } else {
      seen.set(asset.contentHash, assetId);
      kept.push(assetId);
    }
  }

  return {
    outputCount: kept.length,
    droppedCount: dropped,
    outputIds: kept,
    details: `Kept ${kept.length}, deduplicated ${dropped}`,
  };
}

async function executeRedactStage(
  assetIds: string[],
  config: Record<string, unknown>,
): Promise<{ outputCount: number; droppedCount: number; outputIds: string[]; details: string }> {
  let totalPiiFound = 0;

  const patterns: Array<{ type: string; regex: RegExp }> = [];
  if (config.detectEmails !== false) patterns.push({ type: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g });
  if (config.detectPhones !== false) patterns.push({ type: "phone", regex: /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g });
  if (config.detectApiKeys !== false) patterns.push({ type: "api_key", regex: /(?:sk|pk|api|key|token|secret)[-_]?[a-zA-Z0-9]{20,}/gi });
  if (config.detectSsn !== false) patterns.push({ type: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g });
  if (config.detectCreditCards !== false) patterns.push({ type: "credit_card", regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g });

  for (const assetId of assetIds) {
    try {
      const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
      if (!asset || !asset.mimeType.startsWith("text/")) continue;

      let text = readContent(asset.storagePath).toString("utf-8");
      const piiFields: PiiField[] = [];

      for (const { type, regex } of patterns) {
        let match: RegExpExecArray | null;
        const r = new RegExp(regex.source, regex.flags);
        while ((match = r.exec(text)) !== null) {
          piiFields.push({
            type: type as any,
            location: `char:${match.index}-${match.index + match[0].length}`,
            confidence: 0.9,
            redacted: false,
          });
        }
      }

      if (piiFields.length > 0) {
        totalPiiFound += piiFields.length;

        // Auto-redact if not requiring approval
        if (!config.requireUserApproval) {
          const method = (config.redactionMethod as string) || "mask";
          for (const { type, regex } of patterns) {
            const r = new RegExp(regex.source, regex.flags);
            if (method === "mask") {
              text = text.replace(r, (m) => "[REDACTED]");
            } else if (method === "hash") {
              text = text.replace(r, (m) => `[HASH:${createHash("sha256").update(m).digest("hex").slice(0, 8)}]`);
            } else if (method === "remove") {
              text = text.replace(r, "");
            }
          }

          const buffer = Buffer.from(text, "utf-8");
          const { hash, storagePath, encrypted } = storeContent(buffer, vaultConfig.encryptAtRest);
          for (const f of piiFields) f.redacted = true;

          db.update(vaultAssets)
            .set({
              contentHash: hash,
              storagePath,
              byteSize: buffer.length,
              encrypted,
              piiDetected: true,
              piiRedacted: true,
              piiFieldsJson: piiFields as any,
              updatedAt: new Date(),
            })
            .where(eq(vaultAssets.id, assetId))
            .run();

          writeAuditLog("pii_redacted", assetId, "asset", `Redacted ${piiFields.length} PII fields`);
        } else {
          db.update(vaultAssets)
            .set({
              piiDetected: true,
              piiRedacted: false,
              piiFieldsJson: piiFields as any,
              updatedAt: new Date(),
            })
            .where(eq(vaultAssets.id, assetId))
            .run();

          writeAuditLog("pii_detected", assetId, "asset", `Detected ${piiFields.length} PII fields`);
        }
      }
    } catch (err) {
      logger.warn(`Redact failed for ${assetId}: ${err}`);
    }
  }

  return {
    outputCount: assetIds.length,
    droppedCount: 0,
    outputIds: assetIds,
    details: `Found ${totalPiiFound} PII fields across ${assetIds.length} assets`,
  };
}

async function executeLabelStage(
  assetIds: string[],
  config: Record<string, unknown>,
): Promise<{ outputCount: number; droppedCount: number; outputIds: string[]; details: string }> {
  let labeled = 0;

  for (const assetId of assetIds) {
    try {
      const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
      if (!asset) continue;

      const tags: string[] = [...((asset.tags as string[]) ?? [])];

      // Auto-tag by modality
      if (config.autoTag) {
        if (!tags.includes(asset.modality)) tags.push(asset.modality);
        const ext = path.extname(asset.name).toLowerCase();
        if (ext && !tags.includes(ext)) tags.push(ext);
      }

      // Auto-category by mime type
      if (config.autoCategory) {
        const category = asset.mimeType.split("/")[0];
        if (!tags.includes(category)) tags.push(category);
      }

      db.update(vaultAssets)
        .set({
          tags,
          status: "ready",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vaultAssets.id, assetId))
        .run();

      labeled++;
    } catch (err) {
      logger.warn(`Label failed for ${assetId}: ${err}`);
    }
  }

  return {
    outputCount: assetIds.length,
    droppedCount: 0,
    outputIds: assetIds,
    details: `Labeled ${labeled} assets`,
  };
}

// =============================================================================
// PACKAGING
// =============================================================================

export function createPackageManifest(config: {
  name: string;
  version: string;
  description?: string;
  datasetId?: string;
  assetIds: string[];
  publisherWallet?: string;
}): any {
  const id = randomUUID();

  // Compute integrity hashes from assets
  const integrityHashes: Record<string, string> = {};
  const chunkCids: string[] = [];
  let totalBytes = 0;

  for (const assetId of config.assetIds) {
    const asset = db.select().from(vaultAssets).where(eq(vaultAssets.id, assetId)).get();
    if (asset) {
      integrityHashes[assetId] = asset.contentHash;
      chunkCids.push(asset.contentHash); // Use content hash as CID placeholder
      totalBytes += asset.byteSize;
    }
  }

  // Compute merkle root (simple hash-of-hashes for now)
  const allHashes = Object.values(integrityHashes).sort().join("");
  const merkleRoot = createHash("sha256").update(allHashes).digest("hex");

  db.insert(packageManifests)
    .values({
      id,
      name: config.name,
      version: config.version,
      description: config.description ?? null,
      datasetId: config.datasetId ?? null,
      chunkCount: config.assetIds.length,
      totalBytes,
      chunkCids,
      merkleRoot,
      integrityHashes,
      encrypted: true,
      encryptionAlgorithm: "aes-256-gcm",
      publisherWallet: config.publisherWallet ?? null,
      status: "draft",
      provenanceJson: {
        connectorSources: [],
        transformStages: [],
        totalInputItems: config.assetIds.length,
        totalOutputItems: config.assetIds.length,
        redactedFieldCount: 0,
        privacyStatement: "Raw data not shared; encrypted payload only",
      },
    })
    .run();

  // Update asset statuses
  for (const assetId of config.assetIds) {
    db.update(vaultAssets)
      .set({ status: "packaged", updatedAt: new Date() })
      .where(eq(vaultAssets.id, assetId))
      .run();
  }

  writeAuditLog("package_created", id, "package", `Created package: ${config.name} v${config.version}`);
  return db.select().from(packageManifests).where(eq(packageManifests.id, id)).get();
}

export function listPackages(limit = 50): any[] {
  return db
    .select()
    .from(packageManifests)
    .orderBy(desc(packageManifests.createdAt))
    .limit(limit)
    .all();
}

export function getPackage(id: string): any {
  return db.select().from(packageManifests).where(eq(packageManifests.id, id)).get() ?? null;
}

// =============================================================================
// POLICY
// =============================================================================

export function createPolicy(config: {
  manifestId: string;
  licenseTiers: Array<{
    tier: string;
    enabled: boolean;
    price?: number;
    currency?: string;
    maxAccesses?: number;
    expirationDays?: number;
    description: string;
  }>;
  allowedUses?: string[];
  restrictions?: string[];
  pricingModel?: string;
  priceAmount?: number;
  priceCurrency?: string;
  btcTaprootAddress?: string;
  sovereignExitEnabled?: boolean;
  publisherWallet?: string;
}): any {
  const id = randomUUID();

  db.insert(policyDocuments)
    .values({
      id,
      manifestId: config.manifestId,
      licenseTiers: config.licenseTiers,
      allowedUses: config.allowedUses ?? [],
      restrictions: config.restrictions ?? [],
      pricingModel: (config.pricingModel as any) ?? "free",
      priceAmount: config.priceAmount ?? null,
      priceCurrency: config.priceCurrency ?? null,
      btcTaprootAddress: config.btcTaprootAddress ?? null,
      sovereignExitEnabled: config.sovereignExitEnabled ?? false,
      privacyStatement: "Raw data not shared; encrypted payload only",
      rawDataShared: false,
      publisherWallet: config.publisherWallet ?? null,
    })
    .run();

  writeAuditLog("policy_created", id, "policy");
  return db.select().from(policyDocuments).where(eq(policyDocuments.id, id)).get();
}

export function getPolicy(id: string): any {
  return db.select().from(policyDocuments).where(eq(policyDocuments.id, id)).get() ?? null;
}

export function getPolicyByManifest(manifestId: string): any {
  return db
    .select()
    .from(policyDocuments)
    .where(eq(policyDocuments.manifestId, manifestId))
    .get() ?? null;
}

// =============================================================================
// PUBLISH BUNDLE
// =============================================================================

export function createPublishBundle(config: {
  manifestId: string;
  policyId: string;
  listing: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    license?: string;
    pricingModel?: string;
    price?: number;
    currency?: string;
  };
  publisherWallet: string;
}): any {
  const manifest = getPackage(config.manifestId);
  if (!manifest) throw new Error("Manifest not found");

  const policy = getPolicy(config.policyId);
  if (!policy) throw new Error("Policy not found");

  const id = randomUUID();
  const signature = createHash("sha256")
    .update(`${config.manifestId}:${config.policyId}:${config.publisherWallet}:${Date.now()}`)
    .digest("hex");

  db.insert(publishBundles)
    .values({
      id,
      manifestId: config.manifestId,
      policyId: config.policyId,
      manifestCid: manifest.manifestCid || manifest.merkleRoot || id,
      policyCid: policy.policyCid || id,
      listingName: config.listing.name,
      listingDescription: config.listing.description ?? null,
      listingCategory: config.listing.category ?? null,
      listingTags: config.listing.tags ?? [],
      listingLicense: config.listing.license ?? null,
      listingPricingModel: config.listing.pricingModel ?? null,
      listingPrice: config.listing.price ?? null,
      listingCurrency: config.listing.currency ?? null,
      publisherWallet: config.publisherWallet,
      publisherSignature: signature,
      status: "ready",
    })
    .run();

  writeAuditLog("bundle_published", id, "bundle", `Publish bundle created: ${config.listing.name}`);
  return db.select().from(publishBundles).where(eq(publishBundles.id, id)).get();
}

export function listPublishBundles(limit = 50): any[] {
  return db
    .select()
    .from(publishBundles)
    .orderBy(desc(publishBundles.createdAt))
    .limit(limit)
    .all();
}

export function getPublishBundle(id: string): any {
  return db.select().from(publishBundles).where(eq(publishBundles.id, id)).get() ?? null;
}

// =============================================================================
// AUDIT LOG
// =============================================================================

function writeAuditLog(
  action: AuditAction,
  targetId?: string,
  targetType?: string,
  details?: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    db.insert(vaultAuditLog)
      .values({
        id: randomUUID(),
        action,
        targetId: targetId ?? null,
        targetType: targetType ?? null,
        details: details ?? null,
        metadataJson: metadata ?? null,
      })
      .run();
  } catch {
    // Don't let audit log failures break anything
  }
}

export function getAuditLog(limit = 200): VaultAuditEntry[] {
  const rows = db
    .select()
    .from(vaultAuditLog)
    .orderBy(desc(vaultAuditLog.timestamp))
    .limit(limit)
    .all();

  return rows.map((r: any) => ({
    id: r.id,
    action: r.action as AuditAction,
    targetId: r.targetId ?? undefined,
    targetType: r.targetType ?? undefined,
    details: r.details ?? undefined,
    metadata: (r.metadataJson as any) ?? undefined,
    timestamp: r.timestamp?.toISOString() ?? new Date().toISOString(),
  }));
}

// =============================================================================
// HELPERS
// =============================================================================

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

function guessModality(mimeType: string): AssetModality {
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") return "text";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("application/") && (mimeType.includes("document") || mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("sheet") || mimeType.includes("presentation"))) return "document";
  if (mimeType === "text/csv" || mimeType.includes("spreadsheet")) return "structured";
  return "binary";
}

function rowToVaultAsset(row: any): VaultAsset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    modality: row.modality,
    mimeType: row.mimeType,
    status: row.status,
    contentHash: row.contentHash,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    encrypted: row.encrypted ?? false,
    encryptionKeyId: row.encryptionKeyId ?? undefined,
    connectorId: row.connectorId ?? undefined,
    connectorType: row.connectorType ?? undefined,
    sourcePath: row.sourcePath ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    tags: (row.tags as string[]) ?? [],
    collections: (row.collections as string[]) ?? [],
    qualityScore: row.qualityScore ?? undefined,
    metadataJson: (row.metadataJson as any) ?? undefined,
    piiDetected: row.piiDetected ?? false,
    piiRedacted: row.piiRedacted ?? false,
    piiFieldsJson: (row.piiFieldsJson as any) ?? undefined,
    importedAt: row.importedAt?.toISOString() ?? new Date().toISOString(),
    processedAt: row.processedAt?.toISOString() ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? undefined,
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

function rowToTransformJob(row: any): TransformJob {
  return {
    id: row.id,
    name: row.name,
    inputAssetIds: (row.inputAssetIds as string[]) ?? [],
    inputDatasetId: row.inputDatasetId ?? undefined,
    stages: (row.stagesJson as any[]) ?? [],
    currentStage: row.currentStage ?? undefined,
    status: row.status,
    progress: row.progress,
    itemsProcessed: row.itemsProcessed,
    itemsTotal: row.itemsTotal,
    outputAssetIds: (row.outputAssetIds as string[]) ?? [],
    outputDatasetId: row.outputDatasetId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    errorCount: row.errorCount ?? 0,
    auditLogJson: (row.auditLogJson as any[]) ?? [],
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    startedAt: row.startedAt?.toISOString() ?? undefined,
    completedAt: row.completedAt?.toISOString() ?? undefined,
  };
}
