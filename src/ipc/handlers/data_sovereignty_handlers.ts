/**
 * Data Sovereignty & Monetization IPC Handlers
 * 
 * Complete protection and monetization flow:
 * 1. Encrypt & seal user data
 * 2. Set up NFT-gated access control
 * 3. Configure anti-harvesting protections
 * 4. Enable monetization with licensing
 * 5. Flow to marketplace while retaining ownership
 */

import { ipcMain, app, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";

import type {
  ProtectedDataAsset,
  DataSovereigntyVault,
  DataEncryption,
  DataAccessControl,
  DataMonetization,
  AntiHarvestingConfig,
  ProtectDataRequest,
  ProtectDataResult,
  RevokeAccessRequest,
  UpdateMonetizationRequest,
  VerifyAccessRequest,
  VerifyAccessResult,
  SovereigntyAnalytics,
  AccessLogEntry,
  BatchProtectRequest,
  BatchProtectResult,
  ProtectionLevel,
  AllowedUse,
} from "../../types/data_sovereignty_types";

import type { WalletAddress, Cid } from "../../types/jcn_types";
import type { DataType } from "../../types/sovereign_data";

const logger = log.scope("data_sovereignty");

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

interface SovereigntyState {
  vaults: Map<string, DataSovereigntyVault>;
  assets: Map<string, ProtectedDataAsset>;
  accessLogs: AccessLogEntry[];
  blockedHarvesters: Set<string>;
}

const state: SovereigntyState = {
  vaults: new Map(),
  assets: new Map(),
  accessLogs: [],
  blockedHarvesters: new Set(),
};

// =============================================================================
// DATA DIRECTORIES
// =============================================================================

function getSovereigntyDir(): string {
  return path.join(app.getPath("userData"), "data_sovereignty");
}

function getVaultsDir(): string {
  return path.join(getSovereigntyDir(), "vaults");
}

function getAssetsDir(): string {
  return path.join(getSovereigntyDir(), "assets");
}

function getLogsDir(): string {
  return path.join(getSovereigntyDir(), "logs");
}

function getEncryptedDataDir(): string {
  return path.join(getSovereigntyDir(), "encrypted");
}

async function ensureDirectories(): Promise<void> {
  await fs.ensureDir(getSovereigntyDir());
  await fs.ensureDir(getVaultsDir());
  await fs.ensureDir(getAssetsDir());
  await fs.ensureDir(getLogsDir());
  await fs.ensureDir(getEncryptedDataDir());
}

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================

function generateEncryptionKey(): Buffer {
  return crypto.randomBytes(32); // 256 bits
}

function generateIV(): Buffer {
  return crypto.randomBytes(12); // 96 bits for GCM
}

function generateSalt(): Buffer {
  return crypto.randomBytes(16);
}

async function deriveKey(
  password: string,
  salt: Buffer,
  kdf: "argon2id" | "scrypt" | "pbkdf2" = "pbkdf2"
): Promise<Buffer> {
  // Using PBKDF2 as it's built into Node.js
  // In production, argon2 would be preferred
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 32, "sha512", (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function encryptData(
  data: Buffer,
  key: Buffer,
  algorithm: "aes-256-gcm" = "aes-256-gcm"
): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = generateIV();
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return { encrypted, iv, authTag };
}

function decryptData(
  encrypted: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  algorithm: "aes-256-gcm" = "aes-256-gcm"
): Buffer {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function hashContent(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// =============================================================================
// VAULT MANAGEMENT
// =============================================================================

async function createVault(
  owner: WalletAddress,
  name: string
): Promise<DataSovereigntyVault> {
  const vaultId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  const vault: DataSovereigntyVault = {
    id: vaultId,
    owner,
    name,
    totalAssets: 0,
    totalSizeBytes: 0,
    protectedAssetsCount: 0,
    monetizedAssetsCount: 0,
    totalRevenueEarned: 0,
    vaultKeyId: crypto.randomUUID(),
    defaultProtectionLevel: "sovereign",
    defaultEncryption: {
      algorithm: "aes-256-gcm",
      kdf: "pbkdf2",
      keyLengthBits: 256,
      keyStorage: "local-vault",
    },
    defaultAccessControl: {
      nftGated: true,
      requireSignature: true,
      meteringEnabled: true,
      currentAccessCount: 0,
    },
    defaultMonetization: {
      enabled: false,
      pricingModel: "one-time",
      price: 0,
      currency: "USDC",
      royaltyPercent: 10,
      totalRevenue: 0,
      totalPurchases: 0,
      license: {
        type: "commercial",
        allowedUses: ["inference"],
        prohibitedUses: ["resale", "scraping"],
        canSublicense: false,
        canModify: false,
        canRedistribute: false,
        attributionRequired: true,
        commercialUse: true,
      },
    },
    antiHarvesting: {
      enabled: true,
      watermarkEnabled: true,
      watermarkType: "invisible",
      fingerprintEnabled: true,
      rateLimiting: {
        maxRequestsPerMinute: 10,
        maxRequestsPerHour: 100,
        maxRequestsPerDay: 500,
        maxTokensPerRequest: 10000,
        maxBytesPerRequest: 10 * 1024 * 1024,
        cooldownSeconds: 60,
        penaltyMultiplier: 2,
      },
      anomalyDetection: {
        enabled: true,
        detectRapidAccess: true,
        detectBulkDownloads: true,
        detectPatternScanning: true,
        detectAutomatedAccess: true,
        sensitivityThreshold: 70,
        actionOnDetection: "rate-limit",
      },
      accessLogging: {
        logAllAccess: true,
        logToChain: false,
        logToIpfs: true,
        retentionDays: 90,
        includeUserAgent: true,
        includeIpHash: true,
        includeRequestDetails: true,
      },
      harvesterBlocklist: [],
    },
    createdAt: now,
    lastActivityAt: now,
  };
  
  state.vaults.set(vaultId, vault);
  
  // Persist vault
  const vaultPath = path.join(getVaultsDir(), `${vaultId}.json`);
  await fs.writeJson(vaultPath, vault, { spaces: 2 });
  
  logger.info(`Created vault ${vaultId} for ${owner}`);
  return vault;
}

async function getOrCreateVault(owner: WalletAddress): Promise<DataSovereigntyVault> {
  // Find existing vault for owner
  for (const vault of Array.from(state.vaults.values())) {
    if (vault.owner === owner) {
      return vault;
    }
  }
  
  // Create new vault
  return createVault(owner, "Default Vault");
}

// =============================================================================
// DATA PROTECTION
// =============================================================================

async function protectData(request: ProtectDataRequest): Promise<ProtectDataResult> {
  try {
    const now = new Date().toISOString();
    
    // Determine if it's a path or existing asset ID
    let originalData: Buffer;
    let originalPath: string | undefined;
    let name: string;
    let dataType: DataType = "dataset";
    
    if (request.assetIdOrPath.includes("/") || request.assetIdOrPath.includes("\\")) {
      // It's a file path
      originalPath = request.assetIdOrPath;
      if (!await fs.pathExists(originalPath)) {
        return { success: false, error: "File not found" };
      }
      originalData = await fs.readFile(originalPath);
      name = path.basename(originalPath);
    } else {
      // It's an asset ID - find existing asset
      const existing = state.assets.get(request.assetIdOrPath);
      if (!existing) {
        return { success: false, error: "Asset not found" };
      }
      if (existing.originalPath) {
        originalData = await fs.readFile(existing.originalPath);
      } else {
        return { success: false, error: "Asset has no source data" };
      }
      name = existing.name;
      dataType = existing.dataType;
      originalPath = existing.originalPath;
    }
    
    // Get owner from request or default
    const owner = "0x0000000000000000000000000000000000000000" as WalletAddress;
    
    // Get or create vault
    const vault = await getOrCreateVault(owner);
    
    // Create asset ID
    const assetId = crypto.randomUUID();
    const contentHash = hashContent(originalData);
    
    // Encrypt data
    const encryptionKey = generateEncryptionKey();
    const keyId = crypto.randomUUID();
    
    const { encrypted, iv, authTag } = encryptData(originalData, encryptionKey);
    
    // Save encrypted data
    const encryptedPath = path.join(getEncryptedDataDir(), `${assetId}.enc`);
    await fs.writeFile(encryptedPath, Buffer.concat([iv, authTag, encrypted]));
    
    // Save key (in production, this would go to secure storage)
    const keyPath = path.join(getEncryptedDataDir(), `${assetId}.key`);
    await fs.writeFile(keyPath, encryptionKey);
    
    // Create encryption config
    const encryption: DataEncryption = {
      algorithm: request.encryption?.algorithm || vault.defaultEncryption.algorithm || "aes-256-gcm",
      kdf: request.encryption?.kdf || vault.defaultEncryption.kdf || "pbkdf2",
      keyLengthBits: request.encryption?.keyLengthBits || vault.defaultEncryption.keyLengthBits || 256,
      keyStorage: request.encryption?.keyStorage || vault.defaultEncryption.keyStorage || "local-vault",
      keyId,
      iv: iv.toString("base64"),
      encryptedAt: now,
    };
    
    // Create access control
    const accessControl: DataAccessControl = {
      nftGated: request.accessControl?.nftGated ?? vault.defaultAccessControl.nftGated ?? true,
      requireSignature: request.accessControl?.requireSignature ?? vault.defaultAccessControl.requireSignature ?? true,
      meteringEnabled: request.accessControl?.meteringEnabled ?? vault.defaultAccessControl.meteringEnabled ?? true,
      currentAccessCount: 0,
      maxAccesses: request.accessControl?.maxAccesses,
      rateLimits: request.accessControl?.rateLimits,
    };
    
    // Create monetization config
    const monetization: DataMonetization = {
      enabled: request.monetization?.enabled ?? false,
      pricingModel: request.monetization?.pricingModel || vault.defaultMonetization.pricingModel || "one-time",
      price: request.monetization?.price ?? vault.defaultMonetization.price ?? 0,
      currency: request.monetization?.currency || vault.defaultMonetization.currency || "USDC",
      royaltyPercent: request.monetization?.royaltyPercent ?? vault.defaultMonetization.royaltyPercent ?? 10,
      totalRevenue: 0,
      totalPurchases: 0,
      license: {
        ...vault.defaultMonetization.license,
        ...request.monetization?.license,
      } as any,
    };
    
    // Create protected asset
    const asset: ProtectedDataAsset = {
      id: assetId,
      name,
      dataType,
      originalPath,
      contentHash,
      originalSizeBytes: originalData.length,
      encryptedSizeBytes: encrypted.length + iv.length + authTag.length,
      protectionLevel: request.targetLevel,
      encryption,
      accessControl,
      monetization,
      owner,
      createdAt: now,
      updatedAt: now,
    };
    
    // Save asset
    state.assets.set(assetId, asset);
    const assetPath = path.join(getAssetsDir(), `${assetId}.json`);
    await fs.writeJson(assetPath, asset, { spaces: 2 });
    
    // Update vault stats
    vault.totalAssets++;
    vault.totalSizeBytes += asset.originalSizeBytes;
    if (asset.protectionLevel !== "unprotected") {
      vault.protectedAssetsCount++;
    }
    vault.lastActivityAt = now;
    
    const result: ProtectDataResult = {
      success: true,
      asset,
    };
    
    // Mint NFT if requested
    if (request.mintNft && accessControl.nftGated) {
      // This would integrate with deployed_contract_handlers
      // For now, we'll just note it's pending
      result.warnings = result.warnings || [];
      result.warnings.push("NFT minting queued - will complete when wallet connected");
    }
    
    // List on marketplace if requested
    if (request.listOnMarketplace && monetization.enabled) {
      // This would integrate with hyper_liquid_handlers
      result.warnings = result.warnings || [];
      result.warnings.push("Marketplace listing queued - will complete via Hyper Liquid pipeline");
    }
    
    logger.info(`Protected asset ${assetId} at level ${request.targetLevel}`);
    return result;
    
  } catch (error) {
    logger.error("Failed to protect data:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// ACCESS VERIFICATION
// =============================================================================

async function verifyAccess(request: VerifyAccessRequest): Promise<VerifyAccessResult> {
  const asset = state.assets.get(request.assetId);
  if (!asset) {
    return { granted: false, reason: "Asset not found" };
  }
  
  const vault = await getOrCreateVault(asset.owner);
  const now = new Date().toISOString();
  
  // Check if requester is in blocklist
  if (state.blockedHarvesters.has(request.requesterWallet)) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Blocked harvester");
    return { granted: false, reason: "Access denied - suspicious activity detected" };
  }
  
  // Check rate limits
  const recentAccess = state.accessLogs.filter(
    log => log.assetId === asset.id && 
           log.requesterWallet === request.requesterWallet &&
           new Date(log.timestamp).getTime() > Date.now() - 60000 // Last minute
  );
  
  if (vault.antiHarvesting.enabled && 
      recentAccess.length >= vault.antiHarvesting.rateLimiting.maxRequestsPerMinute) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Rate limit exceeded");
    return { granted: false, reason: "Rate limit exceeded - please wait" };
  }
  
  // Check if owner
  if (request.requesterWallet === asset.owner) {
    const accessToken = crypto.randomUUID();
    logAccess(asset.id, request.requesterWallet, request.intendedUse, true);
    return {
      granted: true,
      accessToken,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      rateLimitRemaining: {
        requests: vault.antiHarvesting.rateLimiting.maxRequestsPerHour - recentAccess.length,
        tokens: vault.antiHarvesting.rateLimiting.maxTokensPerRequest,
        bytes: vault.antiHarvesting.rateLimiting.maxBytesPerRequest,
      },
    };
  }
  
  // Check NFT access
  if (asset.accessControl?.nftGated) {
    if (!request.tokenId) {
      logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "NFT required");
      return { granted: false, reason: "NFT ownership required for access" };
    }
    // In production, verify NFT ownership on-chain
  }
  
  // Check whitelist
  if (asset.accessControl?.allowedWallets && 
      asset.accessControl.allowedWallets.length > 0 &&
      !asset.accessControl.allowedWallets.includes(request.requesterWallet)) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Not in whitelist");
    return { granted: false, reason: "Wallet not authorized" };
  }
  
  // Check blacklist
  if (asset.accessControl?.deniedWallets?.includes(request.requesterWallet)) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Blacklisted");
    return { granted: false, reason: "Access revoked" };
  }
  
  // Check license allows intended use
  if (asset.monetization?.license) {
    if (!asset.monetization.license.allowedUses.includes(request.intendedUse)) {
      logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Use not licensed");
      return { granted: false, reason: `License does not allow ${request.intendedUse}` };
    }
  }
  
  // Check max accesses
  if (asset.accessControl?.maxAccesses && 
      asset.accessControl.currentAccessCount >= asset.accessControl.maxAccesses) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Max accesses reached");
    return { granted: false, reason: "Maximum access limit reached" };
  }
  
  // Check expiration
  if (asset.accessControl?.accessExpiresAt && 
      new Date(asset.accessControl.accessExpiresAt) < new Date()) {
    logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Access expired");
    return { granted: false, reason: "Access has expired" };
  }
  
  // Verify signature if required
  if (asset.accessControl?.requireSignature) {
    if (!request.signature || !request.message) {
      logAccess(asset.id, request.requesterWallet, request.intendedUse, false, "Signature required");
      return { granted: false, reason: "Signed message required" };
    }
    // In production, verify signature against wallet address
  }
  
  // ACCESS GRANTED
  const accessToken = crypto.randomUUID();
  const watermarkId = vault.antiHarvesting.watermarkEnabled ? crypto.randomUUID() : undefined;
  
  // Update access count
  if (asset.accessControl) {
    asset.accessControl.currentAccessCount++;
  }
  
  logAccess(asset.id, request.requesterWallet, request.intendedUse, true);
  
  return {
    granted: true,
    accessToken,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    rateLimitRemaining: {
      requests: vault.antiHarvesting.rateLimiting.maxRequestsPerHour - recentAccess.length - 1,
      tokens: vault.antiHarvesting.rateLimiting.maxTokensPerRequest,
      bytes: vault.antiHarvesting.rateLimiting.maxBytesPerRequest,
    },
    watermarkId,
    licenseSummary: asset.monetization?.license ? 
      `${asset.monetization.license.type} license - ${asset.monetization.license.allowedUses.join(", ")} allowed` :
      "Standard access",
  };
}

function logAccess(
  assetId: string,
  requesterWallet: WalletAddress,
  accessType: AllowedUse,
  granted: boolean,
  denialReason?: string
): void {
  const entry: AccessLogEntry = {
    id: crypto.randomUUID(),
    assetId,
    requesterWallet,
    accessType,
    granted,
    denialReason,
    suspicious: false,
    timestamp: new Date().toISOString(),
  };
  
  state.accessLogs.push(entry);
  
  // Keep only recent logs in memory
  if (state.accessLogs.length > 10000) {
    state.accessLogs = state.accessLogs.slice(-5000);
  }
}

// =============================================================================
// REVOCATION
// =============================================================================

async function revokeAccess(request: RevokeAccessRequest): Promise<{ success: boolean; error?: string }> {
  const asset = state.assets.get(request.assetId);
  if (!asset) {
    return { success: false, error: "Asset not found" };
  }
  
  if (!asset.accessControl) {
    asset.accessControl = {
      nftGated: false,
      requireSignature: false,
      meteringEnabled: false,
      currentAccessCount: 0,
    };
  }
  
  if (request.wallet) {
    // Revoke specific wallet
    if (!asset.accessControl.deniedWallets) {
      asset.accessControl.deniedWallets = [];
    }
    if (!asset.accessControl.deniedWallets.includes(request.wallet)) {
      asset.accessControl.deniedWallets.push(request.wallet);
    }
    
    // Remove from whitelist if present
    if (asset.accessControl.allowedWallets) {
      asset.accessControl.allowedWallets = asset.accessControl.allowedWallets.filter(
        w => w !== request.wallet
      );
    }
  } else {
    // Revoke all access
    asset.accessControl.allowedWallets = [];
    asset.accessControl.maxAccesses = asset.accessControl.currentAccessCount;
  }
  
  asset.updatedAt = new Date().toISOString();
  
  logger.info(`Revoked access to ${request.assetId}: ${request.reason}`);
  return { success: true };
}

// =============================================================================
// MONETIZATION UPDATES
// =============================================================================

async function updateMonetization(
  request: UpdateMonetizationRequest
): Promise<{ success: boolean; asset?: ProtectedDataAsset; error?: string }> {
  const asset = state.assets.get(request.assetId);
  if (!asset) {
    return { success: false, error: "Asset not found" };
  }
  
  if (!asset.monetization) {
    return { success: false, error: "Asset not set up for monetization" };
  }
  
  if (request.price !== undefined) {
    asset.monetization.price = request.price;
  }
  
  if (request.pricingModel) {
    asset.monetization.pricingModel = request.pricingModel;
  }
  
  if (request.license) {
    asset.monetization.license = {
      ...asset.monetization.license,
      ...request.license,
    };
  }
  
  asset.updatedAt = new Date().toISOString();
  
  // Persist changes
  const assetPath = path.join(getAssetsDir(), `${asset.id}.json`);
  await fs.writeJson(assetPath, asset, { spaces: 2 });
  
  return { success: true, asset };
}

// =============================================================================
// ANALYTICS
// =============================================================================

async function getAnalytics(
  owner: WalletAddress,
  period: "day" | "week" | "month" | "year" | "all" = "month"
): Promise<SovereigntyAnalytics> {
  const now = Date.now();
  const periodMs = {
    day: 86400000,
    week: 604800000,
    month: 2592000000,
    year: 31536000000,
    all: now,
  }[period];
  
  const cutoff = new Date(now - periodMs);
  
  // Get owner's assets
  const ownerAssets = Array.from(state.assets.values()).filter(a => a.owner === owner);
  
  // Get relevant logs
  const relevantLogs = state.accessLogs.filter(
    log => ownerAssets.some(a => a.id === log.assetId) &&
           new Date(log.timestamp) >= cutoff
  );
  
  // Calculate revenue by currency
  const revenueByCurrency: Record<string, number> = {};
  let totalRevenue = 0;
  
  for (const asset of ownerAssets) {
    if (asset.monetization) {
      const currency = asset.monetization.currency;
      revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + asset.monetization.totalRevenue;
      totalRevenue += asset.monetization.totalRevenue;
    }
  }
  
  return {
    period,
    totalProtectedAssets: ownerAssets.filter(a => a.protectionLevel !== "unprotected").length,
    totalMonetizedAssets: ownerAssets.filter(a => a.monetization?.enabled).length,
    totalRevenue,
    revenueByCurrency,
    totalAccesses: relevantLogs.length,
    accessesGranted: relevantLogs.filter(l => l.granted).length,
    accessesDenied: relevantLogs.filter(l => !l.granted).length,
    harvestingBlocked: relevantLogs.filter(l => l.suspicious).length,
    topAssetsByRevenue: ownerAssets
      .filter(a => a.monetization)
      .sort((a, b) => (b.monetization?.totalRevenue || 0) - (a.monetization?.totalRevenue || 0))
      .slice(0, 5)
      .map(a => ({ assetId: a.id, name: a.name, revenue: a.monetization?.totalRevenue || 0 })),
    topAssetsByAccess: ownerAssets
      .map(a => ({
        assetId: a.id,
        name: a.name,
        accesses: relevantLogs.filter(l => l.assetId === a.id && l.granted).length,
      }))
      .sort((a, b) => b.accesses - a.accesses)
      .slice(0, 5),
    revenueTimeline: [], // Would calculate daily/weekly revenue
    calculatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

async function batchProtect(request: BatchProtectRequest): Promise<BatchProtectResult> {
  const results: BatchProtectResult["results"] = [];
  let successful = 0;
  let failed = 0;
  
  for (const item of request.assets) {
    const result = await protectData({
      assetIdOrPath: item.path,
      ...request.settings,
    });
    
    if (result.success) {
      successful++;
      results.push({
        path: item.path,
        success: true,
        assetId: result.asset?.id,
      });
    } else {
      failed++;
      results.push({
        path: item.path,
        success: false,
        error: result.error,
      });
    }
  }
  
  return {
    total: request.assets.length,
    successful,
    failed,
    results,
  };
}

// =============================================================================
// REGISTER IPC HANDLERS
// =============================================================================

export function registerDataSovereigntyHandlers(): void {
  // Initialize directories
  ensureDirectories();
  
  // ===========================================================================
  // VAULT MANAGEMENT
  // ===========================================================================
  
  ipcMain.handle("sovereignty:get-vault", async (_, owner: WalletAddress) => {
    return getOrCreateVault(owner);
  });
  
  ipcMain.handle("sovereignty:update-vault", async (_, vaultId: string, updates: Partial<DataSovereigntyVault>) => {
    const vault = state.vaults.get(vaultId);
    if (!vault) throw new Error("Vault not found");
    
    Object.assign(vault, updates, { lastActivityAt: new Date().toISOString() });
    
    const vaultPath = path.join(getVaultsDir(), `${vaultId}.json`);
    await fs.writeJson(vaultPath, vault, { spaces: 2 });
    
    return vault;
  });
  
  // ===========================================================================
  // DATA PROTECTION
  // ===========================================================================
  
  ipcMain.handle("sovereignty:protect", async (_, request: ProtectDataRequest) => {
    return protectData(request);
  });
  
  ipcMain.handle("sovereignty:batch-protect", async (_, request: BatchProtectRequest) => {
    return batchProtect(request);
  });
  
  ipcMain.handle("sovereignty:get-asset", async (_, assetId: string) => {
    return state.assets.get(assetId) || null;
  });
  
  ipcMain.handle("sovereignty:list-assets", async (_, owner: WalletAddress) => {
    return Array.from(state.assets.values()).filter(a => a.owner === owner);
  });
  
  ipcMain.handle("sovereignty:delete-asset", async (_, assetId: string) => {
    const asset = state.assets.get(assetId);
    if (!asset) return false;
    
    // Delete encrypted data
    const encryptedPath = path.join(getEncryptedDataDir(), `${assetId}.enc`);
    const keyPath = path.join(getEncryptedDataDir(), `${assetId}.key`);
    await fs.remove(encryptedPath).catch(() => {});
    await fs.remove(keyPath).catch(() => {});
    
    // Delete asset record
    const assetPath = path.join(getAssetsDir(), `${assetId}.json`);
    await fs.remove(assetPath).catch(() => {});
    
    state.assets.delete(assetId);
    return true;
  });
  
  // ===========================================================================
  // ACCESS CONTROL
  // ===========================================================================
  
  ipcMain.handle("sovereignty:verify-access", async (_, request: VerifyAccessRequest) => {
    return verifyAccess(request);
  });
  
  ipcMain.handle("sovereignty:revoke-access", async (_, request: RevokeAccessRequest) => {
    return revokeAccess(request);
  });
  
  ipcMain.handle("sovereignty:grant-access", async (_, assetId: string, wallet: WalletAddress) => {
    const asset = state.assets.get(assetId);
    if (!asset) return { success: false, error: "Asset not found" };
    
    if (!asset.accessControl) {
      asset.accessControl = {
        nftGated: false,
        requireSignature: false,
        meteringEnabled: false,
        currentAccessCount: 0,
      };
    }
    
    if (!asset.accessControl.allowedWallets) {
      asset.accessControl.allowedWallets = [];
    }
    
    if (!asset.accessControl.allowedWallets.includes(wallet)) {
      asset.accessControl.allowedWallets.push(wallet);
    }
    
    // Remove from denied if present
    if (asset.accessControl.deniedWallets) {
      asset.accessControl.deniedWallets = asset.accessControl.deniedWallets.filter(w => w !== wallet);
    }
    
    asset.updatedAt = new Date().toISOString();
    return { success: true };
  });
  
  // ===========================================================================
  // MONETIZATION
  // ===========================================================================
  
  ipcMain.handle("sovereignty:update-monetization", async (_, request: UpdateMonetizationRequest) => {
    return updateMonetization(request);
  });
  
  ipcMain.handle("sovereignty:enable-monetization", async (_, assetId: string, config: Partial<DataMonetization>) => {
    const asset = state.assets.get(assetId);
    if (!asset) return { success: false, error: "Asset not found" };
    
    const vault = await getOrCreateVault(asset.owner);
    
    asset.monetization = {
      enabled: true,
      pricingModel: config.pricingModel || "one-time",
      price: config.price || 0,
      currency: config.currency || "USDC",
      royaltyPercent: config.royaltyPercent || 10,
      totalRevenue: 0,
      totalPurchases: 0,
      license: config.license || vault.defaultMonetization.license as any,
    };
    
    asset.protectionLevel = "monetized";
    asset.updatedAt = new Date().toISOString();
    
    vault.monetizedAssetsCount++;
    
    return { success: true, asset };
  });
  
  // ===========================================================================
  // ANTI-HARVESTING
  // ===========================================================================
  
  ipcMain.handle("sovereignty:report-harvester", async (_, identifier: string, reason: string) => {
    state.blockedHarvesters.add(identifier);
    logger.warn(`Blocked harvester: ${identifier} - ${reason}`);
    return true;
  });
  
  ipcMain.handle("sovereignty:get-blocklist", async () => {
    return Array.from(state.blockedHarvesters);
  });
  
  ipcMain.handle("sovereignty:update-anti-harvesting", async (_, vaultId: string, config: Partial<AntiHarvestingConfig>) => {
    const vault = state.vaults.get(vaultId);
    if (!vault) throw new Error("Vault not found");
    
    vault.antiHarvesting = { ...vault.antiHarvesting, ...config };
    vault.lastActivityAt = new Date().toISOString();
    
    return vault.antiHarvesting;
  });
  
  // ===========================================================================
  // ANALYTICS
  // ===========================================================================
  
  ipcMain.handle("sovereignty:get-analytics", async (_, owner: WalletAddress, period?: string) => {
    return getAnalytics(owner, period as any);
  });
  
  ipcMain.handle("sovereignty:get-access-logs", async (_, assetId: string, limit?: number) => {
    const logs = state.accessLogs.filter(l => l.assetId === assetId);
    return limit ? logs.slice(-limit) : logs;
  });
  
  logger.info("Data Sovereignty handlers registered");
}
