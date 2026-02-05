/**
 * Celestia Blob IPC Client
 *
 * Renderer-side client for the Celestia blob data-availability layer.
 * All data is exposed as hashed blobs — never raw.
 */

import type { IpcRenderer } from "electron";

// =============================================================================
// TYPES (mirror the handler / service types)
// =============================================================================

export interface BlobSubmission {
  contentHash: string;
  height: number;
  commitment: string;
  namespace: string;
  originalSize: number;
  encrypted: boolean;
  submittedAt: string;
  label?: string;
  dataType?: string;
  ipldCid?: string;
  /** Only present when the blob was encrypted during this submission */
  encryptionKeyHex?: string;
}

export interface BlobRetrievalResult {
  data: string; // base64
  contentHash: string;
  verified: boolean;
  height: number;
}

export interface CelestiaStatus {
  available: boolean;
  height?: number;
  syncing?: boolean;
  balance?: { amount: string; denom: string };
  walletAddress?: string;
  network?: string;
  error?: string;
}

export interface CelestiaConfig {
  rpcUrl: string;
  namespace: string;
  gasPrice: number;
  authToken?: string;
  walletAddress: string;
  network: string;
}

export interface BlobStats {
  totalBlobs: number;
  totalBytes: number;
  encryptedCount: number;
  dataTypes: Record<string, number>;
  earliestSubmission?: string;
  latestSubmission?: string;
}

// =============================================================================
// CLIENT
// =============================================================================

class CelestiaBlobClient {
  private static instance: CelestiaBlobClient;
  private ipc: IpcRenderer;

  private constructor() {
    this.ipc = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): CelestiaBlobClient {
    if (!CelestiaBlobClient.instance) {
      CelestiaBlobClient.instance = new CelestiaBlobClient();
    }
    return CelestiaBlobClient.instance;
  }

  // ---------------------------------------------------------------------------
  // SUBMIT
  // ---------------------------------------------------------------------------

  /** Submit raw data (base64-encoded) as a hashed blob */
  async submitBlob(params: {
    data: string; // base64
    label?: string;
    dataType?: string;
    encrypt?: boolean;
    gasPrice?: number;
  }): Promise<BlobSubmission> {
    return this.ipc.invoke("celestia:blob:submit", params);
  }

  /** Submit a JSON object as a hashed blob */
  async submitJSON(params: {
    json: unknown;
    label?: string;
    dataType?: string;
    encrypt?: boolean;
  }): Promise<BlobSubmission> {
    return this.ipc.invoke("celestia:blob:submit-json", params);
  }

  /** Submit a file from disk as a hashed blob */
  async submitFile(params: {
    filePath: string;
    label?: string;
    dataType?: string;
    encrypt?: boolean;
  }): Promise<BlobSubmission> {
    return this.ipc.invoke("celestia:blob:submit-file", params);
  }

  // ---------------------------------------------------------------------------
  // RETRIEVE
  // ---------------------------------------------------------------------------

  /** Retrieve a blob by its content hash */
  async getBlob(params: {
    contentHash: string;
    decryptionKeyHex?: string;
  }): Promise<BlobRetrievalResult | null> {
    return this.ipc.invoke("celestia:blob:get", params);
  }

  /** Retrieve all JoyCreate blobs at a specific block height */
  async getBlobsAtHeight(params: {
    height: number;
    decryptionKeyHex?: string;
  }): Promise<BlobRetrievalResult[]> {
    return this.ipc.invoke("celestia:blob:get-at-height", params);
  }

  // ---------------------------------------------------------------------------
  // INDEX / QUERY
  // ---------------------------------------------------------------------------

  /** List blob submissions from the local index */
  async listBlobs(filter?: {
    dataType?: string;
    label?: string;
    since?: string;
    limit?: number;
  }): Promise<BlobSubmission[]> {
    return this.ipc.invoke("celestia:blob:list", filter);
  }

  /** Get aggregate blob stats */
  async getStats(): Promise<BlobStats> {
    return this.ipc.invoke("celestia:blob:stats");
  }

  /** Hash data locally without submitting */
  async hashData(data: string /* base64 */): Promise<{
    contentHash: string;
    size: number;
    timestamp: string;
  }> {
    return this.ipc.invoke("celestia:blob:hash", { data });
  }

  /** Verify a blob's integrity from Celestia */
  async verifyBlob(contentHash: string): Promise<{
    verified: boolean;
    submission: BlobSubmission | null;
    error?: string;
  }> {
    return this.ipc.invoke("celestia:blob:verify", { contentHash });
  }

  // ---------------------------------------------------------------------------
  // STATUS / CONFIG
  // ---------------------------------------------------------------------------

  /** Get Celestia node status */
  async getStatus(): Promise<CelestiaStatus> {
    return this.ipc.invoke("celestia:status");
  }

  /** Get current config */
  async getConfig(): Promise<CelestiaConfig> {
    return this.ipc.invoke("celestia:config:get");
  }

  /** Update config */
  async updateConfig(updates: Partial<CelestiaConfig>): Promise<CelestiaConfig> {
    return this.ipc.invoke("celestia:config:update", updates);
  }
}

export const celestiaBlobClient = CelestiaBlobClient.getInstance();
export default CelestiaBlobClient;
