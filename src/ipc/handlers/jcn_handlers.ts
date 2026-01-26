/**
 * JCN IPC Handlers
 * Electron IPC handlers for all JCN operations.
 * 
 * These handlers bridge the renderer process (UI) to the main process JCN services.
 * All operations require proper authentication and authorization.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import * as crypto from "crypto";
import log from "electron-log";

import { jcnPublishStateMachine, type PublishRequest } from "@/lib/jcn_publish_state_machine";
import { jcnJobExecutor, type JobRequest } from "@/lib/jcn_job_executor";
import { jcnAuthGateway } from "@/lib/jcn_auth_gateway";
import { jcnKeyManager } from "@/lib/jcn_key_manager";
import { jcnStorageAdapter } from "@/lib/jcn_storage_adapter";
import { jcnBundleBuilder } from "@/lib/jcn_bundle_builder";
import { jcnChainAdapter } from "@/lib/jcn_chain_adapter";
import { db } from "@/db";
import { jcnAuditLog, jcnPublishRecords, jcnJobRecords, jcnBundles, jcnLicenses } from "@/db/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";

import type {
  AuthContext,
  JobTicket,
  PublishState,
  JobState,
  BundleType,
  JcnRole,
  StorageProvider,
  RequestId,
  Cid,
  WalletAddress,
  StoreId,
  LicenseId,
} from "@/types/jcn_types";

const logger = log.scope("jcn_ipc_handlers");

// =============================================================================
// AUTH HELPERS
// =============================================================================

/**
 * Extract auth context from IPC params
 */
async function extractAuth(params: {
  token?: string;
  wallet?: WalletAddress;
  signature?: string;
  message?: string;
  nonce?: string;
  timestamp?: number;
}): Promise<AuthContext> {
  return jcnAuthGateway.extractAuthContext(params);
}

/**
 * Generate a new request ID for idempotency
 */
function generateRequestId(): RequestId {
  return crypto.randomUUID() as RequestId;
}

// =============================================================================
// CHANNEL NAMES
// =============================================================================

const CHANNELS = {
  // Auth
  AUTH_CREATE_TOKEN: "jcn:auth:createToken",
  AUTH_VERIFY_TOKEN: "jcn:auth:verifyToken",
  AUTH_SIGN_MESSAGE: "jcn:auth:signMessage",
  
  // Publish
  PUBLISH_ASSET: "jcn:publish:asset",
  PUBLISH_GET_STATUS: "jcn:publish:getStatus",
  PUBLISH_LIST: "jcn:publish:list",
  PUBLISH_RETRY: "jcn:publish:retry",
  
  // Jobs
  JOB_SUBMIT: "jcn:job:submit",
  JOB_GET_STATUS: "jcn:job:getStatus",
  JOB_LIST: "jcn:job:list",
  JOB_CANCEL: "jcn:job:cancel",
  
  // Bundles
  BUNDLE_BUILD: "jcn:bundle:build",
  BUNDLE_VERIFY: "jcn:bundle:verify",
  BUNDLE_GET: "jcn:bundle:get",
  BUNDLE_LIST: "jcn:bundle:list",
  
  // Storage
  STORAGE_PIN: "jcn:storage:pin",
  STORAGE_FETCH: "jcn:storage:fetch",
  STORAGE_VERIFY: "jcn:storage:verify",
  
  // Licenses
  LICENSE_REGISTER: "jcn:license:register",
  LICENSE_VERIFY: "jcn:license:verify",
  LICENSE_LIST: "jcn:license:list",
  LICENSE_REVOKE: "jcn:license:revoke",
  
  // Keys
  KEY_GENERATE: "jcn:key:generate",
  KEY_IMPORT: "jcn:key:import",
  KEY_LIST: "jcn:key:list",
  KEY_DELETE: "jcn:key:delete",
  KEY_SIGN: "jcn:key:sign",
  KEY_VERIFY: "jcn:key:verify",
  KEY_ROTATE: "jcn:key:rotate",
  
  // Admin
  ADMIN_AUDIT_LOG: "jcn:admin:auditLog",
  ADMIN_REPLAY: "jcn:admin:replay",
  ADMIN_RECOVER: "jcn:admin:recover",
  ADMIN_STATS: "jcn:admin:stats",
  
  // Chain
  CHAIN_POLL_PENDING: "jcn:chain:pollPending",
  CHAIN_CHECK_REORGS: "jcn:chain:checkReorgs",
} as const;

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

/**
 * Register all JCN IPC handlers
 */
export function registerJcnHandlers(): void {
  logger.info("Registering JCN IPC handlers");
  
  // =========================================================================
  // AUTH HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.AUTH_CREATE_TOKEN, async (_event, params: {
    wallet: WalletAddress;
    signature: string;
    message: string;
    nonce: string;
    timestamp: number;
    requestedRoles?: JcnRole[];
  }) => {
    // Verify signature
    const auth = await jcnAuthGateway.authenticateWithSignature({
      wallet: params.wallet,
      message: params.message,
      signature: params.signature,
      nonce: params.nonce,
      timestamp: params.timestamp,
    });
    
    if (!auth) {
      throw new Error("Authentication failed");
    }
    
    // Create token
    const token = await jcnAuthGateway.createToken({
      wallet: params.wallet,
      roles: auth.roles || [],
    });
    
    await jcnAuthGateway.logAuthEvent("token_created", auth);
    
    return { token, auth };
  });
  
  ipcMain.handle(CHANNELS.AUTH_VERIFY_TOKEN, async (_event, params: {
    token: string;
  }) => {
    const auth = await jcnAuthGateway.verifyToken(params.token);
    return auth;
  });
  
  ipcMain.handle(CHANNELS.AUTH_SIGN_MESSAGE, async (_event, params: {
    message: string;
    keyId?: string;
    token?: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    // Use specified key or default
    const keyId = params.keyId || (await jcnKeyManager.getDefaultSigningKey()).keyId;
    const signature = await jcnKeyManager.sign(keyId, params.message);
    
    return { signature };
  });
  
  // =========================================================================
  // PUBLISH HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.PUBLISH_ASSET, async (_event, params: {
    token?: string;
    storeId: StoreId;
    bundleType: BundleType;
    source: { type: "local_path" | "cid"; value: string };
    metadata: {
      name: string;
      description?: string;
      version: string;
      license: string;
      licenseUrl?: string;
      tags?: string[];
    };
    entryPoint?: string;
    pricing?: {
      model: "free" | "one_time" | "subscription";
      amount?: number;
      currency?: string;
    };
    mintOnChain?: boolean;
    indexInMarketplace?: boolean;
    storageProviders?: StorageProvider[];
    requestId?: RequestId;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "publish:create");
    jcnAuthGateway.requireStoreAccess(auth, params.storeId);
    
    // Check rate limit
    const rateLimit = await jcnAuthGateway.checkRateLimit(
      "wallet",
      auth.wallet || "anonymous",
      "publish:create"
    );
    if (!rateLimit.allowed) {
      throw new Error(`Rate limit exceeded. Retry after ${new Date(rateLimit.resetAt).toISOString()}`);
    }
    
    const request: PublishRequest = {
      requestId: params.requestId || generateRequestId(),
      storeId: params.storeId,
      publisherWallet: auth.wallet!,
      bundleType: params.bundleType,
      source: params.source,
      metadata: params.metadata,
      entryPoint: params.entryPoint,
      pricing: params.pricing,
      mintOnChain: params.mintOnChain ?? false,
      indexInMarketplace: params.indexInMarketplace ?? true,
      storageProviders: params.storageProviders,
    };
    
    const result = await jcnPublishStateMachine.publish(request);
    
    return result;
  });
  
  ipcMain.handle(CHANNELS.PUBLISH_GET_STATUS, async (_event, params: {
    token?: string;
    publishId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "publish:read");
    
    const record = await jcnPublishStateMachine.getRecord(params.publishId);
    
    if (!record) {
      throw new Error(`Publish not found: ${params.publishId}`);
    }
    
    // Check access
    if (auth.storeId !== record.storeId && !jcnAuthGateway.hasRole(auth, "auditor")) {
      throw new Error("Access denied");
    }
    
    return record;
  });
  
  ipcMain.handle(CHANNELS.PUBLISH_LIST, async (_event, params: {
    token?: string;
    state?: PublishState;
    storeId?: StoreId;
    limit?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "publish:read");
    
    const records = await jcnPublishStateMachine.listRecords({
      state: params.state,
      limit: params.limit,
    });
    
    // Filter by store access
    return records.filter((r) => 
      auth.storeId === r.storeId || 
      jcnAuthGateway.hasRole(auth, "auditor") ||
      (params.storeId && r.storeId === params.storeId)
    );
  });
  
  ipcMain.handle(CHANNELS.PUBLISH_RETRY, async (_event, params: {
    token?: string;
    publishId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "publish:update");
    
    const record = await jcnPublishStateMachine.getRecord(params.publishId);
    if (!record) {
      throw new Error(`Publish not found: ${params.publishId}`);
    }
    
    jcnAuthGateway.requireStoreAccess(auth, record.storeId);
    
    return jcnPublishStateMachine.retry(params.publishId);
  });
  
  // =========================================================================
  // JOB HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.JOB_SUBMIT, async (_event, params: {
    token?: string;
    ticket: JobTicket;
    sandboxOverrides?: {
      maxMemoryMb?: number;
      maxCpuPercent?: number;
      maxExecutionMs?: number;
      allowNetwork?: boolean;
    };
    priority?: number;
    requestId?: RequestId;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "job:create");
    
    // Check rate limit
    const rateLimit = await jcnAuthGateway.checkRateLimit(
      "wallet",
      auth.wallet || "anonymous",
      "job:create"
    );
    if (!rateLimit.allowed) {
      throw new Error(`Rate limit exceeded. Retry after ${new Date(rateLimit.resetAt).toISOString()}`);
    }
    
    const request: JobRequest = {
      requestId: params.requestId || generateRequestId(),
      ticket: params.ticket,
      auth,
      sandboxOverrides: params.sandboxOverrides,
      priority: params.priority,
    };
    
    return jcnJobExecutor.submitJob(request);
  });
  
  ipcMain.handle(CHANNELS.JOB_GET_STATUS, async (_event, params: {
    token?: string;
    jobId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "job:read");
    
    const record = await jcnJobExecutor.getRecord(params.jobId);
    
    if (!record) {
      throw new Error(`Job not found: ${params.jobId}`);
    }
    
    return record;
  });
  
  ipcMain.handle(CHANNELS.JOB_LIST, async (_event, params: {
    token?: string;
    state?: JobState;
    limit?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "job:read");
    
    return jcnJobExecutor.listJobs({
      state: params.state,
      limit: params.limit,
    });
  });
  
  ipcMain.handle(CHANNELS.JOB_CANCEL, async (_event, params: {
    token?: string;
    jobId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "job:cancel");
    
    await jcnJobExecutor.cancelJob(params.jobId);
    return { success: true };
  });
  
  // =========================================================================
  // BUNDLE HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.BUNDLE_BUILD, async (_event, params: {
    token?: string;
    sourcePath: string;
    bundleType: BundleType;
    name: string;
    version: string;
    description?: string;
    creator?: WalletAddress;
    license?: string;
    outputDir?: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "publish:create");
    
    return jcnBundleBuilder.buildBundle({
      sourcePath: params.sourcePath,
      bundleType: params.bundleType,
      name: params.name,
      version: params.version,
      description: params.description,
      creator: params.creator || auth.wallet,
      license: params.license || "MIT",
      outputDir: params.outputDir,
    });
  });
  
  ipcMain.handle(CHANNELS.BUNDLE_VERIFY, async (_event, params: {
    token?: string;
    bundlePath: string;
    manifest: Record<string, unknown>;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "bundle:verify");
    
    return jcnBundleBuilder.verifyBundle(params.bundlePath, params.manifest as never);
  });
  
  ipcMain.handle(CHANNELS.BUNDLE_GET, async (_event, params: {
    token?: string;
    bundleCid: Cid;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "bundle:read");
    
    const [record] = await db.select()
      .from(jcnBundles)
      .where(eq(jcnBundles.bundleCid, params.bundleCid))
      .limit(1);
    
    return record || null;
  });
  
  ipcMain.handle(CHANNELS.BUNDLE_LIST, async (_event, params: {
    token?: string;
    bundleType?: BundleType;
    creator?: WalletAddress;
    limit?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "bundle:read");
    
    let query = db.select().from(jcnBundles);
    
    if (params.bundleType) {
      query = query.where(eq(jcnBundles.bundleType, params.bundleType)) as typeof query;
    }
    
    if (params.creator) {
      query = query.where(eq(jcnBundles.creator, params.creator)) as typeof query;
    }
    
    return query.limit(params.limit || 100);
  });
  
  // =========================================================================
  // STORAGE HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.STORAGE_PIN, async (_event, params: {
    token?: string;
    data: string | Buffer;
    providers?: StorageProvider[];
    options?: { name?: string; verify?: boolean };
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    const dataBuffer = Buffer.isBuffer(params.data) 
      ? params.data 
      : Buffer.from(params.data);
    
    return jcnStorageAdapter.pin(dataBuffer, params.providers, params.options);
  });
  
  ipcMain.handle(CHANNELS.STORAGE_FETCH, async (_event, params: {
    token?: string;
    cid: Cid;
    providers?: StorageProvider[];
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnStorageAdapter.fetch(params.cid, params.providers);
  });
  
  ipcMain.handle(CHANNELS.STORAGE_VERIFY, async (_event, params: {
    token?: string;
    cid: Cid;
    providers?: StorageProvider[];
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnStorageAdapter.verifyPin(params.cid, params.providers);
  });
  
  // =========================================================================
  // LICENSE HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.LICENSE_REGISTER, async (_event, params: {
    token?: string;
    licenseId: LicenseId;
    bundleCid: Cid;
    licenseType: "perpetual" | "subscription" | "usage_based";
    holderWallet: WalletAddress;
    validUntil?: number;
    usageLimit?: number;
    onChain?: boolean;
    contractAddress?: WalletAddress;
    tokenId?: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "license:create");
    
    await jcnJobExecutor.registerLicense({
      licenseId: params.licenseId,
      bundleCid: params.bundleCid,
      licenseType: params.licenseType,
      holderWallet: params.holderWallet,
      grantedAt: Date.now(),
      validUntil: params.validUntil,
      usageLimit: params.usageLimit,
      revoked: false,
      onChain: params.onChain ?? false,
      contractAddress: params.contractAddress,
      tokenId: params.tokenId,
    });
    
    return { success: true };
  });
  
  ipcMain.handle(CHANNELS.LICENSE_LIST, async (_event, params: {
    token?: string;
    holderWallet?: WalletAddress;
    bundleCid?: Cid;
    limit?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "license:read");
    
    let query = db.select().from(jcnLicenses);
    
    if (params.holderWallet) {
      query = query.where(eq(jcnLicenses.holderWallet, params.holderWallet)) as typeof query;
    }
    
    if (params.bundleCid) {
      query = query.where(eq(jcnLicenses.bundleCid, params.bundleCid)) as typeof query;
    }
    
    return query.limit(params.limit || 100);
  });
  
  ipcMain.handle(CHANNELS.LICENSE_REVOKE, async (_event, params: {
    token?: string;
    licenseId: LicenseId;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "license:revoke");
    
    await db.update(jcnLicenses)
      .set({ revoked: true, revokedAt: new Date() })
      .where(eq(jcnLicenses.licenseId, params.licenseId));
    
    return { success: true };
  });
  
  // =========================================================================
  // KEY HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.KEY_GENERATE, async (_event, params: {
    token?: string;
    type: "signing" | "encryption" | "node_identity";
    algorithm: "secp256k1" | "ed25519" | "rsa-2048" | "aes-256-gcm";
    name?: string;
    expiresInDays?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnKeyManager.generateKey({
      type: params.type,
      algorithm: params.algorithm,
      name: params.name,
      expiresInDays: params.expiresInDays,
      storeInKeyring: true,
    });
  });
  
  ipcMain.handle(CHANNELS.KEY_LIST, async (_event, params: {
    token?: string;
    type?: "signing" | "encryption" | "node_identity";
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnKeyManager.listKeys(params.type);
  });
  
  ipcMain.handle(CHANNELS.KEY_DELETE, async (_event, params: {
    token?: string;
    keyId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnKeyManager.deleteKey(params.keyId);
  });
  
  ipcMain.handle(CHANNELS.KEY_SIGN, async (_event, params: {
    token?: string;
    keyId: string;
    message: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    const signature = await jcnKeyManager.sign(params.keyId, params.message);
    return { signature };
  });
  
  ipcMain.handle(CHANNELS.KEY_VERIFY, async (_event, params: {
    token?: string;
    keyId: string;
    message: string;
    signature: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    const valid = await jcnKeyManager.verify(params.keyId, params.message, params.signature);
    return { valid };
  });
  
  ipcMain.handle(CHANNELS.KEY_ROTATE, async (_event, params: {
    token?: string;
    keyId: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnKeyManager.rotateKey(params.keyId);
  });
  
  // =========================================================================
  // ADMIN HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.ADMIN_AUDIT_LOG, async (_event, params: {
    token?: string;
    targetType?: "publish" | "job" | "bundle" | "license" | "key" | "config";
    targetId?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "audit:read");
    
    let query = db.select().from(jcnAuditLog);
    
    if (params.targetType) {
      query = query.where(eq(jcnAuditLog.targetType, params.targetType)) as typeof query;
    }
    
    if (params.targetId) {
      query = query.where(eq(jcnAuditLog.targetId, params.targetId)) as typeof query;
    }
    
    if (params.startTime) {
      query = query.where(gte(jcnAuditLog.timestamp, new Date(params.startTime))) as typeof query;
    }
    
    if (params.endTime) {
      query = query.where(lte(jcnAuditLog.timestamp, new Date(params.endTime))) as typeof query;
    }
    
    return query.orderBy(desc(jcnAuditLog.timestamp)).limit(params.limit || 100);
  });
  
  ipcMain.handle(CHANNELS.ADMIN_STATS, async (_event, params: {
    token?: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requirePermission(auth, "audit:read");
    
    const [publishCounts] = await db.select({
      total: db.fn.count(),
    }).from(jcnPublishRecords);
    
    const [jobCounts] = await db.select({
      total: db.fn.count(),
    }).from(jcnJobRecords);
    
    const [bundleCounts] = await db.select({
      total: db.fn.count(),
    }).from(jcnBundles);
    
    const [licenseCounts] = await db.select({
      total: db.fn.count(),
    }).from(jcnLicenses);
    
    return {
      publishes: { total: publishCounts?.total || 0 },
      jobs: { total: jobCounts?.total || 0 },
      bundles: { total: bundleCounts?.total || 0 },
      licenses: { total: licenseCounts?.total || 0 },
    };
  });
  
  ipcMain.handle(CHANNELS.ADMIN_RECOVER, async (_event, params: {
    token?: string;
    type: "publish" | "job";
    id: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireRole(auth, "store_owner");
    
    if (params.type === "publish") {
      return jcnPublishStateMachine.retry(params.id);
    }
    
    throw new Error("Job recovery not implemented");
  });
  
  // =========================================================================
  // CHAIN HANDLERS
  // =========================================================================
  
  ipcMain.handle(CHANNELS.CHAIN_POLL_PENDING, async (_event, params: {
    token?: string;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnChainAdapter.pollPendingTransactions();
  });
  
  ipcMain.handle(CHANNELS.CHAIN_CHECK_REORGS, async (_event, params: {
    token?: string;
    blockNumber: number;
  }) => {
    const auth = await extractAuth({ token: params.token });
    jcnAuthGateway.requireAuth(auth);
    
    return jcnChainAdapter.checkForReorgs(params.blockNumber);
  });
  
  logger.info("JCN IPC handlers registered");
}

// Export channel names for use in preload/renderer
export { CHANNELS as JCN_CHANNELS };
