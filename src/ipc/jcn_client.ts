/**
 * JCN IPC Client
 * Renderer-side client for JCN operations via IPC.
 */

import type {
  PublishState,
  JobState,
  BundleType,
  JobTicket,
  InferenceReceipt,
  AuthContext,
  JcnRole,
  StorageProvider,
  KeyMetadata,
  KeyType,
  KeyAlgorithm,
  RequestId,
  Cid,
  WalletAddress,
  StoreId,
  LicenseId,
} from "@/types/jcn_types";

// =============================================================================
// CHANNEL NAMES (must match handlers)
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
// RESPONSE TYPES
// =============================================================================

export interface PublishResult {
  success: boolean;
  publishId: string;
  state: PublishState;
  bundleCid?: Cid;
  manifestCid?: Cid;
  merkleRoot?: string;
  tokenId?: string;
  collectionContract?: WalletAddress;
  marketplaceAssetId?: string;
  error?: string;
}

export interface JobResult {
  success: boolean;
  jobId: string;
  state: JobState;
  receipt?: InferenceReceipt;
  output?: unknown;
  error?: string;
  metrics?: {
    executionTimeMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    memoryUsedMb: number;
    cpuTimeMs: number;
  };
}

export interface PinResult {
  provider: StorageProvider;
  success: boolean;
  cid?: Cid;
  error?: string;
}

export interface FetchResult {
  success: boolean;
  data?: Uint8Array;
  error?: string;
  provider?: StorageProvider;
}

export interface JcnStats {
  publishes: { total: number };
  jobs: { total: number };
  bundles: { total: number };
  licenses: { total: number };
}

// =============================================================================
// JCN CLIENT CLASS
// =============================================================================

class JcnClient {
  private token?: string;
  private ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<any> };
  
  constructor() {
    // Access IPC renderer through window.electron
    this.ipcRenderer = (window as any).electron?.ipcRenderer ?? { invoke: async () => { throw new Error("IPC not available"); } };
  }
  
  /**
   * Set the auth token for subsequent requests
   */
  setToken(token: string): void {
    this.token = token;
  }
  
  /**
   * Clear the auth token
   */
  clearToken(): void {
    this.token = undefined;
  }
  
  /**
   * Get current token
   */
  getToken(): string | undefined {
    return this.token;
  }
  
  // ===========================================================================
  // AUTH METHODS
  // ===========================================================================
  
  /**
   * Create an auth token via wallet signature
   */
  async createToken(params: {
    wallet: WalletAddress;
    signature: string;
    message: string;
    nonce: string;
    timestamp: number;
    requestedRoles?: JcnRole[];
  }): Promise<{ token: string; auth: AuthContext }> {
    const result = await this.ipcRenderer.invoke(CHANNELS.AUTH_CREATE_TOKEN, params);
    this.token = result.token;
    return result;
  }
  
  /**
   * Verify a token
   */
  async verifyToken(token?: string): Promise<AuthContext | null> {
    return this.ipcRenderer.invoke(CHANNELS.AUTH_VERIFY_TOKEN, {
      token: token || this.token,
    });
  }
  
  /**
   * Sign a message with a key
   */
  async signMessage(message: string, keyId?: string): Promise<string> {
    const result = await this.ipcRenderer.invoke(CHANNELS.AUTH_SIGN_MESSAGE, {
      token: this.token,
      message,
      keyId,
    });
    return result.signature;
  }
  
  // ===========================================================================
  // PUBLISH METHODS
  // ===========================================================================
  
  /**
   * Publish an asset
   */
  async publishAsset(params: {
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
  }): Promise<PublishResult> {
    return this.ipcRenderer.invoke(CHANNELS.PUBLISH_ASSET, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Get publish status
   */
  async getPublishStatus(publishId: string): Promise<unknown> {
    return this.ipcRenderer.invoke(CHANNELS.PUBLISH_GET_STATUS, {
      token: this.token,
      publishId,
    });
  }
  
  /**
   * List publishes
   */
  async listPublishes(params?: {
    state?: PublishState;
    storeId?: StoreId;
    limit?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke(CHANNELS.PUBLISH_LIST, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Retry a failed publish
   */
  async retryPublish(publishId: string): Promise<PublishResult> {
    return this.ipcRenderer.invoke(CHANNELS.PUBLISH_RETRY, {
      token: this.token,
      publishId,
    });
  }
  
  // ===========================================================================
  // JOB METHODS
  // ===========================================================================
  
  /**
   * Submit a job
   */
  async submitJob(params: {
    ticket: JobTicket;
    sandboxOverrides?: {
      maxMemoryMb?: number;
      maxCpuPercent?: number;
      maxExecutionMs?: number;
      allowNetwork?: boolean;
    };
    priority?: number;
    requestId?: RequestId;
  }): Promise<JobResult> {
    return this.ipcRenderer.invoke(CHANNELS.JOB_SUBMIT, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<unknown> {
    return this.ipcRenderer.invoke(CHANNELS.JOB_GET_STATUS, {
      token: this.token,
      jobId,
    });
  }
  
  /**
   * List jobs
   */
  async listJobs(params?: {
    state?: JobState;
    limit?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke(CHANNELS.JOB_LIST, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke(CHANNELS.JOB_CANCEL, {
      token: this.token,
      jobId,
    });
  }
  
  // ===========================================================================
  // BUNDLE METHODS
  // ===========================================================================
  
  /**
   * Build a bundle
   */
  async buildBundle(params: {
    sourcePath: string;
    bundleType: BundleType;
    name: string;
    version: string;
    description?: string;
    creator?: WalletAddress;
    license?: string;
    outputDir?: string;
  }): Promise<{
    bundlePath: string;
    manifestPath: string;
    manifest: unknown;
    bundleHash: string;
    merkleRoot: string;
    manifestHash: string;
    totalSize: number;
  }> {
    return this.ipcRenderer.invoke(CHANNELS.BUNDLE_BUILD, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Verify a bundle
   */
  async verifyBundle(
    bundlePath: string,
    manifest: unknown
  ): Promise<{
    valid: boolean;
    manifestHashValid: boolean;
    merkleRootValid: boolean;
    signatureValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    return this.ipcRenderer.invoke(CHANNELS.BUNDLE_VERIFY, {
      token: this.token,
      bundlePath,
      manifest,
    });
  }
  
  /**
   * Get bundle info
   */
  async getBundle(bundleCid: Cid): Promise<unknown | null> {
    return this.ipcRenderer.invoke(CHANNELS.BUNDLE_GET, {
      token: this.token,
      bundleCid,
    });
  }
  
  /**
   * List bundles
   */
  async listBundles(params?: {
    bundleType?: BundleType;
    creator?: WalletAddress;
    limit?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke(CHANNELS.BUNDLE_LIST, {
      token: this.token,
      ...params,
    });
  }
  
  // ===========================================================================
  // STORAGE METHODS
  // ===========================================================================
  
  /**
   * Pin data to IPFS
   */
  async pinData(
    data: string | Uint8Array,
    providers?: StorageProvider[],
    options?: { name?: string; verify?: boolean }
  ): Promise<PinResult[]> {
    return this.ipcRenderer.invoke(CHANNELS.STORAGE_PIN, {
      token: this.token,
      data,
      providers,
      options,
    });
  }
  
  /**
   * Fetch data from IPFS
   */
  async fetchData(
    cid: Cid,
    providers?: StorageProvider[]
  ): Promise<FetchResult> {
    return this.ipcRenderer.invoke(CHANNELS.STORAGE_FETCH, {
      token: this.token,
      cid,
      providers,
    });
  }
  
  /**
   * Verify a pin
   */
  async verifyPin(
    cid: Cid,
    providers?: StorageProvider[]
  ): Promise<{ provider: StorageProvider; pinned: boolean }[]> {
    return this.ipcRenderer.invoke(CHANNELS.STORAGE_VERIFY, {
      token: this.token,
      cid,
      providers,
    });
  }
  
  // ===========================================================================
  // LICENSE METHODS
  // ===========================================================================
  
  /**
   * Register a license
   */
  async registerLicense(params: {
    licenseId: LicenseId;
    bundleCid: Cid;
    licenseType: "perpetual" | "subscription" | "usage_based";
    holderWallet: WalletAddress;
    validUntil?: number;
    usageLimit?: number;
    onChain?: boolean;
    contractAddress?: WalletAddress;
    tokenId?: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke(CHANNELS.LICENSE_REGISTER, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * List licenses
   */
  async listLicenses(params?: {
    holderWallet?: WalletAddress;
    bundleCid?: Cid;
    limit?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke(CHANNELS.LICENSE_LIST, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Revoke a license
   */
  async revokeLicense(licenseId: LicenseId): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke(CHANNELS.LICENSE_REVOKE, {
      token: this.token,
      licenseId,
    });
  }
  
  // ===========================================================================
  // KEY METHODS
  // ===========================================================================
  
  /**
   * Generate a new key
   */
  async generateKey(params: {
    type: KeyType;
    algorithm: KeyAlgorithm;
    name?: string;
    expiresInDays?: number;
  }): Promise<KeyMetadata> {
    return this.ipcRenderer.invoke(CHANNELS.KEY_GENERATE, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * List keys
   */
  async listKeys(type?: KeyType): Promise<KeyMetadata[]> {
    return this.ipcRenderer.invoke(CHANNELS.KEY_LIST, {
      token: this.token,
      type,
    });
  }
  
  /**
   * Delete a key
   */
  async deleteKey(keyId: string): Promise<boolean> {
    return this.ipcRenderer.invoke(CHANNELS.KEY_DELETE, {
      token: this.token,
      keyId,
    });
  }
  
  /**
   * Sign with a key
   */
  async signWithKey(keyId: string, message: string): Promise<string> {
    const result = await this.ipcRenderer.invoke(CHANNELS.KEY_SIGN, {
      token: this.token,
      keyId,
      message,
    });
    return result.signature;
  }
  
  /**
   * Verify a signature
   */
  async verifySignature(
    keyId: string,
    message: string,
    signature: string
  ): Promise<boolean> {
    const result = await this.ipcRenderer.invoke(CHANNELS.KEY_VERIFY, {
      token: this.token,
      keyId,
      message,
      signature,
    });
    return result.valid;
  }
  
  /**
   * Rotate a key
   */
  async rotateKey(keyId: string): Promise<KeyMetadata> {
    return this.ipcRenderer.invoke(CHANNELS.KEY_ROTATE, {
      token: this.token,
      keyId,
    });
  }
  
  // ===========================================================================
  // ADMIN METHODS
  // ===========================================================================
  
  /**
   * Get audit log
   */
  async getAuditLog(params?: {
    targetType?: "publish" | "job" | "bundle" | "license" | "key" | "config";
    targetId?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke(CHANNELS.ADMIN_AUDIT_LOG, {
      token: this.token,
      ...params,
    });
  }
  
  /**
   * Get stats
   */
  async getStats(): Promise<JcnStats> {
    return this.ipcRenderer.invoke(CHANNELS.ADMIN_STATS, {
      token: this.token,
    });
  }
  
  /**
   * Recover a failed operation
   */
  async recover(
    type: "publish" | "job",
    id: string
  ): Promise<PublishResult | JobResult> {
    return this.ipcRenderer.invoke(CHANNELS.ADMIN_RECOVER, {
      token: this.token,
      type,
      id,
    });
  }
  
  // ===========================================================================
  // CHAIN METHODS
  // ===========================================================================
  
  /**
   * Poll pending transactions
   */
  async pollPendingTransactions(): Promise<{
    checked: number;
    confirmed: number;
    failed: number;
  }> {
    return this.ipcRenderer.invoke(CHANNELS.CHAIN_POLL_PENDING, {
      token: this.token,
    });
  }
  
  /**
   * Check for reorgs
   */
  async checkForReorgs(blockNumber: number): Promise<{
    reorgDetected: boolean;
    affectedTransactions: string[];
  }> {
    return this.ipcRenderer.invoke(CHANNELS.CHAIN_CHECK_REORGS, {
      token: this.token,
      blockNumber,
    });
  }
}

// Export singleton instance
export const jcnClient = new JcnClient();

// Also export the class for testing
export { JcnClient };
