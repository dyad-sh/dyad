/**
 * JCN Publish State Machine
 * Crash-safe, idempotent publish workflow for assets.
 * 
 * States: INIT → BUNDLE_BUILT → PINNED → VERIFIED → MINTED → INDEXED → COMPLETE
 * 
 * Features:
 * - Idempotent operations via requestId
 * - Atomic state transitions with DB commits
 * - Crash recovery from any state
 * - Full audit trail
 */

import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import { jcnPublishRecords, jcnBundles, jcnAuditLog } from "@/db/schema";
import { eq } from "drizzle-orm";

import { jcnBundleBuilder } from "./jcn_bundle_builder";
import { jcnStorageAdapter } from "./jcn_storage_adapter";
import { jcnChainAdapter } from "./jcn_chain_adapter";

import type {
  PublishState,
  PublishStateRecord,
  BundleManifest,
  BundleType,
  RequestId,
  TraceId,
  StoreId,
  WalletAddress,
  Cid,
  MerkleRoot,
  Sha256Hash,
  StorageProvider,
} from "@/types/jcn_types";

const logger = log.scope("jcn_publish_state_machine");

// =============================================================================
// STATE TRANSITION VALIDATION
// =============================================================================

const VALID_TRANSITIONS: Record<PublishState, PublishState[]> = {
  INIT: ["BUNDLE_BUILT", "FAILED"],
  BUNDLE_BUILT: ["PINNED", "RETRYABLE", "FAILED"],
  PINNED: ["VERIFIED", "FAILED"],
  VERIFIED: ["MINTED", "RETRYABLE", "COMPLETE"], // COMPLETE if mintOnChain=false
  MINTED: ["INDEXED", "RETRYABLE", "COMPLETE"], // COMPLETE if indexInMarketplace=false
  INDEXED: ["COMPLETE", "RETRYABLE", "FAILED"],
  COMPLETE: [], // Terminal state
  FAILED: [], // Terminal state
  RETRYABLE: ["INIT", "BUNDLE_BUILT", "PINNED", "VERIFIED", "MINTED", "INDEXED", "FAILED"],
};

function isValidTransition(from: PublishState, to: PublishState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================================================
// PUBLISH REQUEST
// =============================================================================

export interface PublishRequest {
  /** Idempotency key */
  requestId: RequestId;
  /** Store ID */
  storeId: StoreId;
  /** Publisher wallet */
  publisherWallet: WalletAddress;
  /** Bundle type */
  bundleType: BundleType;
  /** Source */
  source: {
    type: "local_path" | "cid";
    value: string;
  };
  /** Metadata */
  metadata: {
    name: string;
    description?: string;
    version: string;
    license: string;
    licenseUrl?: string;
    tags?: string[];
  };
  /** Entry point (for agents) */
  entryPoint?: string;
  /** Pricing */
  pricing?: {
    model: "free" | "one_time" | "subscription";
    amount?: number;
    currency?: string;
  };
  /** Mint on chain */
  mintOnChain: boolean;
  /** Index in marketplace */
  indexInMarketplace: boolean;
  /** Storage providers to use */
  storageProviders?: StorageProvider[];
}

export interface PublishResult {
  success: boolean;
  publishId: string;
  state: PublishState;
  bundleCid?: Cid;
  manifestCid?: Cid;
  merkleRoot?: MerkleRoot;
  tokenId?: string;
  collectionContract?: WalletAddress;
  marketplaceAssetId?: string;
  error?: string;
}

// =============================================================================
// PUBLISH STATE MACHINE
// =============================================================================

export class JcnPublishStateMachine {
  /**
   * Start or resume a publish operation
   * This is the main entry point - fully idempotent
   */
  async publish(request: PublishRequest): Promise<PublishResult> {
    const traceId = crypto.randomUUID() as TraceId;
    
    logger.info("Publish request received", {
      requestId: request.requestId,
      traceId,
      storeId: request.storeId,
      name: request.metadata.name,
    });
    
    // Check for existing publish with this requestId (idempotency)
    let record = await this.getRecordByRequestId(request.requestId);
    
    if (record) {
      logger.info("Found existing publish record", {
        requestId: request.requestId,
        state: record.state,
      });
      
      // If already complete or failed, return current state
      if (record.state === "COMPLETE") {
        return this.buildResult(record, true);
      }
      if (record.state === "FAILED") {
        return this.buildResult(record, false);
      }
      
      // Resume from current state
      return this.resumePublish(record);
    }
    
    // Create new publish record
    record = await this.createRecord(request, traceId);
    
    // Start the publish workflow
    return this.resumePublish(record);
  }
  
  /**
   * Resume publish from current state
   */
  private async resumePublish(record: PublishStateRecord): Promise<PublishResult> {
    logger.info("Resuming publish", { id: record.id, state: record.state });
    
    try {
      while (true) {
        switch (record.state) {
          case "INIT":
            record = await this.buildBundle(record);
            break;
            
          case "BUNDLE_BUILT":
            record = await this.pinBundle(record);
            break;
            
          case "PINNED":
            record = await this.verifyBundle(record);
            break;
            
          case "VERIFIED":
            if (this.shouldMint(record)) {
              record = await this.mintAsset(record);
            } else {
              record = await this.transitionState(record, "COMPLETE", "skip_mint");
            }
            break;
            
          case "MINTED":
            if (this.shouldIndex(record)) {
              record = await this.indexAsset(record);
            } else {
              record = await this.transitionState(record, "COMPLETE", "skip_index");
            }
            break;
            
          case "INDEXED":
            record = await this.transitionState(record, "COMPLETE", "publish_complete");
            break;
            
          case "COMPLETE":
            return this.buildResult(record, true);
            
          case "FAILED":
            return this.buildResult(record, false);
            
          case "RETRYABLE":
            // Retry from last checkpoint
            record = await this.retryFromCheckpoint(record);
            break;
            
          default:
            throw new Error(`Unknown state: ${record.state}`);
        }
      }
    } catch (error) {
      logger.error("Publish error", { id: record.id, error });
      
      // Mark as failed or retryable
      const isRetryable = this.isRetryableError(error);
      record = await this.transitionState(
        record,
        isRetryable ? "RETRYABLE" : "FAILED",
        "error",
        {
          errorCode: (error as Error).name || "UNKNOWN",
          errorMessage: (error as Error).message,
          errorRetryable: isRetryable,
          retryCount: (record.error?.retryCount || 0) + (isRetryable ? 1 : 0),
        }
      );
      
      return this.buildResult(record, false);
    }
  }
  
  /**
   * Step 1: Build bundle
   */
  private async buildBundle(record: PublishStateRecord): Promise<PublishStateRecord> {
    logger.info("Building bundle", { id: record.id });
    
    const metadata = record.metadataJson;
    if (!metadata) {
      throw new Error("Missing metadata");
    }
    
    // If source is already a CID, skip building
    if (record.sourceType === "cid" && record.sourcePath) {
      // Fetch and use existing bundle
      return this.transitionState(record, "BUNDLE_BUILT", "bundle_from_cid", {
        bundleCid: record.sourcePath as Cid,
        checkpoint: { lastCompletedStep: "bundle_built", data: { cid: record.sourcePath } },
      });
    }
    
    // Build bundle from local path
    if (!record.sourcePath) {
      throw new Error("Source path required for local_path source type");
    }
    
    const tempDir = require("os").tmpdir();
    const outputDir = require("path").join(tempDir, `jcn-bundle-${record.id}`);
    
    const result = await jcnBundleBuilder.buildBundle({
      sourcePath: record.sourcePath,
      bundleType: record.bundleType,
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      creator: record.publisherWallet,
      storeId: record.storeId,
      license: metadata.license,
      licenseUrl: metadata.licenseUrl,
      outputDir,
    });
    
    // Store bundle info
    return this.transitionState(record, "BUNDLE_BUILT", "bundle_created", {
      merkleRoot: result.merkleRoot,
      manifestHash: result.manifestHash,
      totalSize: result.totalSize,
      checkpoint: {
        lastCompletedStep: "bundle_built",
        data: {
          bundlePath: result.bundlePath,
          manifestPath: result.manifestPath,
          manifest: result.manifest,
        },
      },
    });
  }
  
  /**
   * Step 2: Pin bundle to storage
   */
  private async pinBundle(record: PublishStateRecord): Promise<PublishStateRecord> {
    logger.info("Pinning bundle", { id: record.id });
    
    const checkpoint = record.checkpointJson;
    if (!checkpoint?.data?.bundlePath) {
      throw new Error("Bundle path not found in checkpoint");
    }
    
    const providers: StorageProvider[] = ["4everland", "pinata"];
    
    // Pin the bundle
    const bundleResults = await jcnStorageAdapter.pinFile(
      checkpoint.data.bundlePath as string,
      providers,
      { name: `bundle-${record.id}.tar`, verify: true }
    );
    
    const successfulBundlePin = bundleResults.find((r) => r.success && r.cid);
    if (!successfulBundlePin?.cid) {
      throw new Error("Failed to pin bundle to any provider");
    }
    
    // Pin the manifest
    const manifestResults = await jcnStorageAdapter.pinJson(
      checkpoint.data.manifest,
      providers,
      { name: `manifest-${record.id}.json`, verify: true }
    );
    
    const successfulManifestPin = manifestResults.find((r) => r.success && r.cid);
    if (!successfulManifestPin?.cid) {
      throw new Error("Failed to pin manifest to any provider");
    }
    
    // Register bundle in local registry
    await this.registerBundle(record, checkpoint.data.manifest as BundleManifest, successfulBundlePin.cid);
    
    return this.transitionState(record, "PINNED", "pin_success", {
      bundleCid: successfulBundlePin.cid,
      manifestCid: successfulManifestPin.cid,
      checkpoint: {
        ...checkpoint,
        lastCompletedStep: "pinned",
        data: {
          ...checkpoint.data,
          bundleCid: successfulBundlePin.cid,
          manifestCid: successfulManifestPin.cid,
          pinResults: { bundle: bundleResults, manifest: manifestResults },
        },
      },
    });
  }
  
  /**
   * Step 3: Verify bundle
   */
  private async verifyBundle(record: PublishStateRecord): Promise<PublishStateRecord> {
    logger.info("Verifying bundle", { id: record.id });
    
    const checkpoint = record.checkpointJson;
    if (!checkpoint?.data?.bundlePath || !checkpoint?.data?.manifest) {
      throw new Error("Bundle data not found in checkpoint");
    }
    
    const verification = await jcnBundleBuilder.verifyBundle(
      checkpoint.data.bundlePath as string,
      checkpoint.data.manifest as BundleManifest
    );
    
    if (!verification.valid) {
      throw new Error(`Bundle verification failed: ${verification.errors.join(", ")}`);
    }
    
    logger.info("Bundle verified", {
      id: record.id,
      manifestHashValid: verification.manifestHashValid,
      merkleRootValid: verification.merkleRootValid,
      signatureValid: verification.signatureValid,
    });
    
    return this.transitionState(record, "VERIFIED", "verification_passed", {
      checkpoint: {
        ...checkpoint,
        lastCompletedStep: "verified",
        data: { ...checkpoint.data, verification },
      },
    });
  }
  
  /**
   * Step 4: Mint asset on chain
   */
  private async mintAsset(record: PublishStateRecord): Promise<PublishStateRecord> {
    logger.info("Minting asset", { id: record.id });
    
    if (!record.bundleCid || !record.merkleRoot || !record.manifestCid) {
      throw new Error("Missing bundle data for minting");
    }
    
    // Create token metadata URI
    const tokenMetadata = {
      name: record.metadataJson?.name,
      description: record.metadataJson?.description,
      image: `ipfs://${record.manifestCid}`,
      external_url: `https://joymarketplace.io/assets/${record.id}`,
      attributes: [
        { trait_type: "Bundle CID", value: record.bundleCid },
        { trait_type: "Merkle Root", value: record.merkleRoot },
        { trait_type: "Type", value: record.bundleType },
        { trait_type: "Version", value: record.metadataJson?.version },
      ],
    };
    
    // Pin metadata
    const metadataResults = await jcnStorageAdapter.pinJson(
      tokenMetadata,
      ["4everland", "pinata"],
      { name: `token-metadata-${record.id}.json` }
    );
    
    const metadataCid = metadataResults.find((r) => r.success)?.cid;
    if (!metadataCid) {
      throw new Error("Failed to pin token metadata");
    }
    
    // Submit mint transaction
    const mintResult = await jcnChainAdapter.mintAsset({
      requestId: record.requestId,
      storeId: record.storeId,
      tokenUri: `ipfs://${metadataCid}`,
      bundleCid: record.bundleCid,
      merkleRoot: record.merkleRoot,
      royaltyBps: 500, // 5% royalty
    });
    
    if (!mintResult.success) {
      throw new Error(mintResult.error || "Mint failed");
    }
    
    // If pending, wait for confirmation
    if (mintResult.pending && mintResult.txHash) {
      logger.info("Waiting for mint confirmation", { txHash: mintResult.txHash });
      
      const confirmed = await jcnChainAdapter.waitForConfirmation(mintResult.txHash);
      if (!confirmed.success) {
        throw new Error(confirmed.error || "Mint confirmation failed");
      }
      
      return this.transitionState(record, "MINTED", "mint_success", {
        mintTxHash: confirmed.txHash,
        tokenId: confirmed.tokenId,
        collectionContract: confirmed.collectionContract || mintResult.collectionContract,
        checkpoint: {
          ...record.checkpointJson,
          lastCompletedStep: "minted",
          data: {
            ...record.checkpointJson?.data,
            mintResult: confirmed,
            metadataCid,
          },
        },
      });
    }
    
    return this.transitionState(record, "MINTED", "mint_success", {
      mintTxHash: mintResult.txHash,
      tokenId: mintResult.tokenId,
      collectionContract: mintResult.collectionContract,
    });
  }
  
  /**
   * Step 5: Index in marketplace
   */
  private async indexAsset(record: PublishStateRecord): Promise<PublishStateRecord> {
    logger.info("Indexing asset", { id: record.id });
    
    // Call marketplace API to index the asset
    // This would integrate with the existing marketplace sync service
    
    // For now, create a marketplace asset ID
    const marketplaceAssetId = `${record.storeId}-${record.tokenId || crypto.randomUUID().slice(0, 8)}`;
    
    return this.transitionState(record, "INDEXED", "index_success", {
      marketplaceAssetId,
    });
  }
  
  /**
   * Retry from checkpoint
   */
  private async retryFromCheckpoint(record: PublishStateRecord): Promise<PublishStateRecord> {
    const checkpoint = record.checkpointJson;
    
    if (!checkpoint?.lastCompletedStep) {
      // Start from beginning
      return this.transitionState(record, "INIT", "retry");
    }
    
    // Map checkpoint to state
    const stateMap: Record<string, PublishState> = {
      bundle_built: "BUNDLE_BUILT",
      pinned: "PINNED",
      verified: "VERIFIED",
      minted: "MINTED",
      indexed: "INDEXED",
    };
    
    const resumeState = stateMap[checkpoint.lastCompletedStep] || "INIT";
    
    logger.info("Retrying from checkpoint", {
      id: record.id,
      checkpoint: checkpoint.lastCompletedStep,
      resumeState,
    });
    
    return this.transitionState(record, resumeState, "retry");
  }
  
  /**
   * Check if should mint on chain
   */
  private shouldMint(record: PublishStateRecord): boolean {
    const pricing = record.pricingJson;
    // Default to mint if pricing is set or explicitly requested
    return pricing?.model !== "free" || record.mintTxHash !== null;
  }
  
  /**
   * Check if should index in marketplace
   */
  private shouldIndex(record: PublishStateRecord): boolean {
    // Always index if we got this far
    return true;
  }
  
  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    
    // Network errors are retryable
    if (message.includes("network") || 
        message.includes("timeout") || 
        message.includes("ECONNREFUSED") ||
        message.includes("ETIMEDOUT")) {
      return true;
    }
    
    // Rate limit errors are retryable
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }
    
    // Gas/nonce errors are retryable
    if (message.includes("nonce") || message.includes("gas")) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Create new publish record
   */
  private async createRecord(request: PublishRequest, traceId: TraceId): Promise<PublishStateRecord> {
    const id = crypto.randomUUID();
    
    const record: typeof jcnPublishRecords.$inferInsert = {
      id,
      requestId: request.requestId,
      traceId,
      state: "INIT",
      stateHistoryJson: [{ state: "INIT", timestamp: Date.now(), event: "created" }],
      storeId: request.storeId,
      publisherWallet: request.publisherWallet,
      bundleType: request.bundleType,
      sourceType: request.source.type,
      sourcePath: request.source.value,
      metadataJson: request.metadata,
      pricingJson: request.pricing,
    };
    
    await db.insert(jcnPublishRecords).values(record);
    
    // Audit log
    await this.auditLog("publish_created", "system", "system", "publish", id, null, record, request.requestId, traceId);
    
    return this.recordToStateRecord(record);
  }
  
  /**
   * Transition to a new state
   */
  private async transitionState(
    record: PublishStateRecord,
    newState: PublishState,
    event: string,
    updates: Partial<typeof jcnPublishRecords.$inferInsert> = {}
  ): Promise<PublishStateRecord> {
    const oldState = record.state;
    
    if (!isValidTransition(oldState, newState)) {
      throw new Error(`Invalid state transition: ${oldState} → ${newState}`);
    }
    
    const now = Date.now();
    const newHistory = [
      ...record.stateHistory,
      { state: newState, timestamp: now, event },
    ];
    
    const updateData: Partial<typeof jcnPublishRecords.$inferInsert> = {
      state: newState,
      stateHistoryJson: newHistory,
      updatedAt: new Date(now),
      ...updates,
    };
    
    if (newState === "COMPLETE") {
      updateData.completedAt = new Date(now);
    }
    
    if (newState === "FAILED" || newState === "RETRYABLE") {
      updateData.errorCode = updates.errorCode || "UNKNOWN";
      updateData.errorMessage = updates.errorMessage || "Unknown error";
      updateData.errorRetryable = updates.errorRetryable ?? false;
      updateData.retryCount = updates.retryCount ?? (record.error?.retryCount || 0);
    }
    
    await db.update(jcnPublishRecords)
      .set(updateData)
      .where(eq(jcnPublishRecords.id, record.id));
    
    // Audit log
    await this.auditLog(
      `state_transition:${oldState}→${newState}`,
      "system",
      "system",
      "publish",
      record.id,
      { state: oldState },
      { state: newState, event },
      record.requestId,
      record.traceId
    );
    
    logger.info("State transition", {
      id: record.id,
      from: oldState,
      to: newState,
      event,
    });
    
    // Return updated record
    return {
      ...record,
      state: newState,
      stateHistory: newHistory,
      bundleCid: updates.bundleCid || record.bundleCid,
      manifestCid: updates.manifestCid || record.manifestCid,
      manifestHash: updates.manifestHash || record.manifestHash,
      merkleRoot: updates.merkleRoot || record.merkleRoot,
      mintTxHash: updates.mintTxHash || record.mintTxHash,
      tokenId: updates.tokenId || record.tokenId,
      collectionContract: updates.collectionContract || record.collectionContract,
      marketplaceAssetId: updates.marketplaceAssetId || record.marketplaceAssetId,
      checkpoint: updates.checkpointJson || record.checkpoint,
      error: (newState === "FAILED" || newState === "RETRYABLE") ? {
        code: updates.errorCode || "UNKNOWN",
        message: updates.errorMessage || "Unknown error",
        retryable: updates.errorRetryable ?? false,
        retryCount: updates.retryCount ?? 0,
      } : undefined,
      updatedAt: now,
      completedAt: newState === "COMPLETE" ? now : record.completedAt,
    };
  }
  
  /**
   * Register bundle in local registry
   */
  private async registerBundle(
    record: PublishStateRecord,
    manifest: BundleManifest,
    bundleCid: Cid
  ): Promise<void> {
    await db.insert(jcnBundles).values({
      id: crypto.randomUUID(),
      bundleCid,
      manifestCid: record.manifestCid || undefined,
      manifestHash: manifest.manifestHash || "",
      merkleRoot: manifest.merkleRoot,
      bundleType: manifest.type,
      name: manifest.name,
      version: manifest.bundleVersion,
      description: manifest.description,
      creator: manifest.creator,
      totalSize: manifest.totalSize,
      fileCount: manifest.files.length,
      chunkCount: manifest.chunks?.length,
      entryPoint: manifest.entryPoint,
      manifestJson: manifest,
      verified: false,
    }).onConflictDoNothing();
  }
  
  /**
   * Get record by requestId
   */
  private async getRecordByRequestId(requestId: RequestId): Promise<PublishStateRecord | null> {
    const [record] = await db.select()
      .from(jcnPublishRecords)
      .where(eq(jcnPublishRecords.requestId, requestId))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return this.recordToStateRecord(record);
  }
  
  /**
   * Convert DB record to state record
   */
  private recordToStateRecord(record: typeof jcnPublishRecords.$inferSelect): PublishStateRecord {
    return {
      id: record.id,
      requestId: record.requestId as RequestId,
      traceId: record.traceId as TraceId,
      state: record.state as PublishState,
      stateHistory: record.stateHistoryJson || [],
      storeId: record.storeId as StoreId,
      publisherWallet: record.publisherWallet as WalletAddress,
      bundleType: record.bundleType as BundleType,
      sourcePath: record.sourcePath || undefined,
      bundleCid: record.bundleCid as Cid | undefined,
      manifestCid: record.manifestCid as Cid | undefined,
      manifestHash: record.manifestHash as Sha256Hash | undefined,
      merkleRoot: record.merkleRoot as MerkleRoot | undefined,
      mintTxHash: record.mintTxHash || undefined,
      tokenId: record.tokenId || undefined,
      collectionContract: record.collectionContract as WalletAddress | undefined,
      marketplaceAssetId: record.marketplaceAssetId || undefined,
      error: record.errorCode ? {
        code: record.errorCode,
        message: record.errorMessage || "Unknown error",
        retryable: record.errorRetryable || false,
        retryCount: record.retryCount || 0,
      } : undefined,
      checkpoint: record.checkpointJson || undefined,
      metadataJson: record.metadataJson,
      pricingJson: record.pricingJson,
      createdAt: record.createdAt?.getTime() || Date.now(),
      updatedAt: record.updatedAt?.getTime() || Date.now(),
      completedAt: record.completedAt?.getTime(),
    };
  }
  
  /**
   * Build result from record
   */
  private buildResult(record: PublishStateRecord, success: boolean): PublishResult {
    return {
      success,
      publishId: record.id,
      state: record.state,
      bundleCid: record.bundleCid,
      manifestCid: record.manifestCid,
      merkleRoot: record.merkleRoot,
      tokenId: record.tokenId,
      collectionContract: record.collectionContract,
      marketplaceAssetId: record.marketplaceAssetId,
      error: record.error?.message,
    };
  }
  
  /**
   * Write audit log
   */
  private async auditLog(
    action: string,
    actorType: "user" | "system" | "admin",
    actorId: string,
    targetType: "publish" | "job" | "bundle" | "license" | "key" | "config",
    targetId: string,
    oldState: unknown,
    newState: unknown,
    requestId?: string,
    traceId?: string
  ): Promise<void> {
    await db.insert(jcnAuditLog).values({
      id: crypto.randomUUID(),
      action,
      actorType,
      actorId,
      targetType,
      targetId,
      oldStateJson: oldState,
      newStateJson: newState,
      requestId,
      traceId,
    });
  }
  
  /**
   * Get publish record by ID
   */
  async getRecord(id: string): Promise<PublishStateRecord | null> {
    const [record] = await db.select()
      .from(jcnPublishRecords)
      .where(eq(jcnPublishRecords.id, id))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return this.recordToStateRecord(record);
  }
  
  /**
   * List all publish records (for admin)
   */
  async listRecords(options?: { state?: PublishState; limit?: number }): Promise<PublishStateRecord[]> {
    let query = db.select().from(jcnPublishRecords);
    
    if (options?.state) {
      query = query.where(eq(jcnPublishRecords.state, options.state)) as typeof query;
    }
    
    const records = await query.limit(options?.limit || 100);
    return records.map((r) => this.recordToStateRecord(r));
  }
  
  /**
   * Retry a failed/retryable publish
   */
  async retry(id: string): Promise<PublishResult> {
    const record = await this.getRecord(id);
    
    if (!record) {
      throw new Error(`Publish record not found: ${id}`);
    }
    
    if (record.state !== "FAILED" && record.state !== "RETRYABLE") {
      throw new Error(`Cannot retry publish in state: ${record.state}`);
    }
    
    // Transition to retryable and resume
    const updated = await this.transitionState(record, "RETRYABLE", "manual_retry");
    return this.resumePublish(updated);
  }
}

// Export singleton instance
export const jcnPublishStateMachine = new JcnPublishStateMachine();
