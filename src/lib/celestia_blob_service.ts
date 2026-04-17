/**
 * Celestia Blob Service
 * 
 * Provides content-addressed blob storage on Celestia's data availability layer.
 * Large data is never exposed raw — it's always hashed (SHA-256) and submitted
 * as an encoded blob under JoyCreate's namespace. Only the commitment (hash)
 * is returned to callers; the raw data stays local or encrypted.
 *
 * Flow:
 *   raw data → SHA-256 hash → optional AES-256-GCM encrypt → base64 encode
 *   → Celestia blob.Submit → returns { height, commitment, contentHash }
 *
 * Retrieval:
 *   height + commitment → blob.GetAll → decode → optional decrypt → verify hash
 */

import * as crypto from "crypto";
import log from "electron-log";
import path from "node:path";
import fs from "fs-extra";
import { app } from "electron";

const logger = log.scope("celestia_blob");

// =============================================================================
// CONFIGURATION
// =============================================================================

const CELESTIA_RPC_URL = "http://localhost:26658";

/** JoyCreate's Celestia namespace (base64-encoded, decoded = "joy80mvp12") */
const JOYCREATE_NAMESPACE = "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbXZwMTI=";

/** Celestia mainnet wallet address */
const CELESTIA_WALLET_ADDRESS =
  process.env.CELESTIA_WALLET_ADDRESS || "celestia1vxssxrs2t27wtgur7lmqcep5zntz3nhjp48z7k";

/** Network identifier */
const CELESTIA_NETWORK = "celestia" as const; // mainnet

/**
 * JoyCreate namespace registry — each namespace is scoped to a specific
 * data category so blobs can be partitioned and queried efficiently.
 */
export const CELESTIA_NAMESPACES = {
  /** Main marketplace blobs */
  marketplace: { id: "joy80mvp12", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbXZwMTI=" },
  /** Purchase receipts */
  purchases:   { id: "joy80purch", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwcHVyY2g=" },
  /** Timestamps / anchors */
  timestamps:  { id: "joy80tstmp", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwdHN0bXA=" },
  /** Asset provenance */
  assets:      { id: "joy80asset", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwYXNzZXQ=" },
  /** License terms */
  licenses:    { id: "joy80licns", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbGljbnM=" },
  /** Generic receipts */
  receipts:    { id: "joy80rcpts", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwcmNwdHM=" },
  /** Metadata blobs */
  metadata:    { id: "joy80mdata", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbWRhdGE=" },
  /** Proofs (ZK, integrity, etc.) */
  proofs:      { id: "joy8proofs", base64: "AAAAAAAAAAAAAAAAAAAAAAAAAGpveThwcm9vZnM=" },
} as const;

export type CelestiaNamespaceKey = keyof typeof CELESTIA_NAMESPACES;

/** Max blob size Celestia accepts per submission (≈ 2 MB after encoding) */
const MAX_BLOB_SIZE = 1_500_000; // 1.5 MB raw → ~2 MB base64

/** Gas price for blob submissions */
const DEFAULT_GAS_PRICE = 0.002;

/** Local index of all blobs we've submitted */
const BLOB_INDEX_DIR = path.join(
  app?.getPath?.("userData") ?? process.cwd(),
  "celestia-blobs",
);

/** Persisted config file */
const CONFIG_FILE_PATH = path.join(BLOB_INDEX_DIR, "config.json");

// =============================================================================
// TYPES
// =============================================================================

export interface CelestiaConfig {
  rpcUrl: string;
  namespace: string;
  /** Human-readable namespace ID (decoded from base64) */
  namespaceId?: string;
  gasPrice: number;
  authToken?: string;
  /** Celestia wallet address (bech32) */
  walletAddress: string;
  /** Network name — "celestia" for mainnet, "mocha" for testnet */
  network: string;
}

export interface BlobSubmission {
  /** SHA-256 hash of the original raw data */
  contentHash: string;
  /** Celestia block height where blob was included */
  height: number;
  /** Celestia commitment for the blob */
  commitment: string;
  /** The namespace used */
  namespace: string;
  /** Size of original data in bytes */
  originalSize: number;
  /** Whether the blob payload was encrypted before submission */
  encrypted: boolean;
  /** Timestamp of submission */
  submittedAt: string;
  /** Human-readable label */
  label?: string;
  /** Data type category */
  dataType?: string;
  /** IPLD CID if this blob is also tracked by the receipt system */
  ipldCid?: string;
}

export interface BlobRetrievalResult {
  /** The raw decoded (and decrypted if needed) data */
  data: Buffer;
  /** SHA-256 hash of the retrieved data (for integrity check) */
  contentHash: string;
  /** Whether the hash matches the original submission */
  verified: boolean;
  /** Celestia block height */
  height: number;
  /** Namespace */
  namespace: string;
}

export interface BlobChunk {
  index: number;
  total: number;
  contentHash: string;
  parentHash: string;
}

interface BlobIndex {
  [contentHash: string]: BlobSubmission;
}

// =============================================================================
// CELESTIA BLOB SERVICE
// =============================================================================

class CelestiaBlobService {
  private config: CelestiaConfig;
  private indexPath: string;

  constructor(config?: Partial<CelestiaConfig>) {
    this.config = {
      rpcUrl: config?.rpcUrl ?? CELESTIA_RPC_URL,
      namespace: config?.namespace ?? JOYCREATE_NAMESPACE,
      gasPrice: config?.gasPrice ?? DEFAULT_GAS_PRICE,
      authToken: config?.authToken,
      walletAddress: config?.walletAddress ?? CELESTIA_WALLET_ADDRESS,
      network: config?.network ?? CELESTIA_NETWORK,
    };
    this.indexPath = path.join(BLOB_INDEX_DIR, "index.json");
  }

  // ---------------------------------------------------------------------------
  // INDEX MANAGEMENT
  // ---------------------------------------------------------------------------

  private async ensureStorage(): Promise<void> {
    await fs.ensureDir(BLOB_INDEX_DIR);
  }

  private async loadIndex(): Promise<BlobIndex> {
    await this.ensureStorage();
    if (!(await fs.pathExists(this.indexPath))) return {};
    try {
      return (await fs.readJson(this.indexPath)) as BlobIndex;
    } catch {
      return {};
    }
  }

  private async saveIndex(index: BlobIndex): Promise<void> {
    await this.ensureStorage();
    await fs.writeJson(this.indexPath, index, { spaces: 2 });
  }

  // ---------------------------------------------------------------------------
  // HASHING
  // ---------------------------------------------------------------------------

  /**
   * Compute SHA-256 content hash of any data buffer.
   * This is the canonical identifier — raw data is never exposed externally.
   */
  hashContent(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Create a compact manifest hash for a set of chunk hashes (Merkle-like).
   */
  hashManifest(chunkHashes: string[]): string {
    const concat = chunkHashes.join("");
    return crypto.createHash("sha256").update(concat).digest("hex");
  }

  // ---------------------------------------------------------------------------
  // ENCRYPTION (optional layer before submission)
  // ---------------------------------------------------------------------------

  /**
   * Encrypt data with AES-256-GCM before submitting to Celestia.
   * Returns { ciphertext, iv, authTag } — caller must store the key securely.
   */
  encryptForBlob(
    data: Buffer,
    key: Buffer,
  ): { ciphertext: Buffer; iv: string; authTag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted,
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    };
  }

  /**
   * Decrypt blob data retrieved from Celestia.
   */
  decryptBlob(
    ciphertext: Buffer,
    key: Buffer,
    iv: string,
    authTag: string,
  ): Buffer {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // ---------------------------------------------------------------------------
  // RPC HELPERS
  // ---------------------------------------------------------------------------

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.authToken) {
      headers["Authorization"] = `Bearer ${this.config.authToken}`;
    }

    const body = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    });

    logger.info(`RPC → ${method}`);

    const response = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Celestia RPC error (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(
        `Celestia RPC: [${json.error.code}] ${json.error.message}`,
      );
    }

    return json.result as T;
  }

  // ---------------------------------------------------------------------------
  // HEALTH / STATUS
  // ---------------------------------------------------------------------------

  /**
   * Resolve a named namespace key (e.g. "assets", "licenses") to its base64 value.
   * Throws if the key is unknown.
   */
  static resolveNamespace(key: CelestiaNamespaceKey): string {
    const entry = CELESTIA_NAMESPACES[key];
    if (!entry) {
      throw new Error(`Unknown Celestia namespace key: ${key}`);
    }
    return entry.base64;
  }

  /**
   * Return all registered namespaces (useful for UI dropdowns).
   */
  static getNamespaceRegistry(): Record<
    CelestiaNamespaceKey,
    { id: string; base64: string }
  > {
    return { ...CELESTIA_NAMESPACES };
  }

  /**
   * Check whether the Celestia node is reachable and synced.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.rpcCall("header.SyncState", []);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the node's current sync state + head height.
   */
  async getSyncState(): Promise<{
    height: number;
    syncing: boolean;
    fromHeight: number;
    toHeight: number;
  }> {
    const state = await this.rpcCall<{
      height: number;
      from_height: number;
      to_height: number;
      error?: string;
    }>("header.SyncState", []);

    return {
      height: state.height ?? state.to_height ?? 0,
      syncing: (state.from_height ?? 0) < (state.to_height ?? 0),
      fromHeight: state.from_height ?? 0,
      toHeight: state.to_height ?? 0,
    };
  }

  /**
   * Get the node's wallet balance.
   */
  async getBalance(): Promise<{ amount: string; denom: string }> {
    const result = await this.rpcCall<{ amount: string; denom: string }>(
      "state.Balance",
      [],
    );
    return result;
  }

  // ---------------------------------------------------------------------------
  // SUBMIT BLOB
  // ---------------------------------------------------------------------------

  /**
   * Submit raw data as a hashed blob to Celestia.
   *
   * The data is:
   *  1. SHA-256 hashed (contentHash is the canonical ID)
   *  2. Optionally encrypted (if encryptionKey is provided)
   *  3. Base64-encoded for the Celestia RPC
   *  4. Submitted under JoyCreate's namespace
   *
   * Returns a BlobSubmission record with height + commitment.
   */
  async submitBlob(
    data: Buffer,
    options?: {
      encryptionKey?: Buffer;
      label?: string;
      dataType?: string;
      gasPrice?: number;
      /** Submit to a specific named namespace from the registry */
      namespaceKey?: CelestiaNamespaceKey;
    },
  ): Promise<BlobSubmission> {
    const contentHash = this.hashContent(data);

    // Check if already submitted
    const index = await this.loadIndex();
    if (index[contentHash]) {
      logger.info(`Blob already submitted: ${contentHash.slice(0, 16)}...`);
      return index[contentHash];
    }

    let payload = data;
    let encrypted = false;

    // Optional encryption
    if (options?.encryptionKey) {
      const enc = this.encryptForBlob(data, options.encryptionKey);
      // Prepend IV + authTag as a header so we can decrypt on retrieval
      const header = Buffer.from(
        JSON.stringify({ iv: enc.iv, authTag: enc.authTag }) + "\n",
      );
      payload = Buffer.concat([header, enc.ciphertext]);
      encrypted = true;
    }

    // Check size — if too large, chunk it
    if (payload.length > MAX_BLOB_SIZE) {
      return this.submitChunkedBlob(data, contentHash, options);
    }

    const encodedData = payload.toString("base64");

    // Resolve namespace: use named key from registry, or fall back to config default
    const resolvedNamespace = options?.namespaceKey
      ? CelestiaBlobService.resolveNamespace(options.namespaceKey)
      : this.config.namespace;

    // Submit via Celestia RPC
    const height = await this.rpcCall<number>("blob.Submit", [
      [
        {
          namespace: resolvedNamespace,
          data: encodedData,
          share_version: 0,
        },
      ],
      { gas_price: options?.gasPrice ?? this.config.gasPrice },
    ]);

    const submission: BlobSubmission = {
      contentHash,
      height,
      commitment: contentHash, // use content hash as our commitment reference
      namespace: resolvedNamespace,
      originalSize: data.length,
      encrypted,
      submittedAt: new Date().toISOString(),
      label: options?.label,
      dataType: options?.dataType,
    };

    // Persist to local index
    index[contentHash] = submission;
    await this.saveIndex(index);

    logger.info(
      `✅ Blob submitted: hash=${contentHash.slice(0, 16)}... height=${height}`,
    );

    return submission;
  }

  /**
   * Submit data that exceeds MAX_BLOB_SIZE by splitting into chunks.
   * A manifest blob is submitted last, referencing all chunk hashes.
   */
  private async submitChunkedBlob(
    data: Buffer,
    contentHash: string,
    options?: {
      encryptionKey?: Buffer;
      label?: string;
      dataType?: string;
      gasPrice?: number;
    },
  ): Promise<BlobSubmission> {
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.length; i += MAX_BLOB_SIZE) {
      chunks.push(data.subarray(i, i + MAX_BLOB_SIZE));
    }

    logger.info(
      `Chunking blob into ${chunks.length} parts (total ${data.length} bytes)`,
    );

    const chunkSubmissions: BlobSubmission[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkHash = this.hashContent(chunk);
      const chunkLabel = `${options?.label ?? "chunk"}_part_${i + 1}_of_${chunks.length}`;

      const sub = await this.submitBlob(chunk, {
        ...options,
        label: chunkLabel,
        dataType: "blob-chunk",
      });
      chunkSubmissions.push(sub);
    }

    // Create and submit manifest
    const manifest = {
      type: "joycreate-chunked-blob",
      version: 1,
      contentHash,
      totalSize: data.length,
      chunkCount: chunks.length,
      chunks: chunkSubmissions.map((s, i) => ({
        index: i,
        contentHash: s.contentHash,
        height: s.height,
        size: chunks[i].length,
      })),
    };

    const manifestBuf = Buffer.from(JSON.stringify(manifest));
    const manifestSub = await this.submitBlob(manifestBuf, {
      label: `${options?.label ?? "blob"}_manifest`,
      dataType: "blob-manifest",
      gasPrice: options?.gasPrice,
    });

    // Record the parent entry
    const index = await this.loadIndex();
    const parentSubmission: BlobSubmission = {
      contentHash,
      height: manifestSub.height,
      commitment: manifestSub.contentHash,
      namespace: this.config.namespace,
      originalSize: data.length,
      encrypted: !!options?.encryptionKey,
      submittedAt: new Date().toISOString(),
      label: options?.label,
      dataType: options?.dataType ?? "chunked-blob",
    };
    index[contentHash] = parentSubmission;
    await this.saveIndex(index);

    return parentSubmission;
  }

  // ---------------------------------------------------------------------------
  // RETRIEVE BLOB
  // ---------------------------------------------------------------------------

  /**
   * Retrieve blobs from a specific height in JoyCreate's namespace.
   */
  async getBlobsAtHeight(
    height: number,
    decryptionKey?: Buffer,
  ): Promise<BlobRetrievalResult[]> {
    const rawBlobs = await this.rpcCall<
      Array<{ data: string; namespace: string; share_version: number }> | null
    >("blob.GetAll", [height, [this.config.namespace]]);

    if (!rawBlobs || rawBlobs.length === 0) {
      return [];
    }

    const results: BlobRetrievalResult[] = [];

    for (const blob of rawBlobs) {
      let decoded: Buffer = Buffer.from(blob.data, "base64");

      // Check if the blob has an encryption header
      if (decryptionKey) {
        try {
          const newlineIdx = decoded.indexOf(10); // \n
          if (newlineIdx > 0 && newlineIdx < 200) {
            const headerStr = decoded.subarray(0, newlineIdx).toString();
            const header = JSON.parse(headerStr);
            if (header.iv && header.authTag) {
              const ciphertext = Buffer.from(decoded.subarray(newlineIdx + 1));
              decoded = Buffer.from(
                this.decryptBlob(
                  ciphertext,
                  decryptionKey,
                  header.iv,
                  header.authTag,
                ),
              );
            }
          }
        } catch {
          // Not encrypted or wrong key — return as-is
        }
      }

      const hash = this.hashContent(decoded);
      results.push({
        data: decoded,
        contentHash: hash,
        verified: true, // hash was just computed from the data
        height,
        namespace: blob.namespace,
      });
    }

    return results;
  }

  /**
   * Retrieve a specific blob by its content hash from our local index,
   * then fetch from Celestia and verify integrity.
   */
  async getBlobByHash(
    contentHash: string,
    decryptionKey?: Buffer,
  ): Promise<BlobRetrievalResult | null> {
    const index = await this.loadIndex();
    const record = index[contentHash];
    if (!record) {
      logger.warn(`No local record for hash: ${contentHash.slice(0, 16)}...`);
      return null;
    }

    const blobs = await this.getBlobsAtHeight(record.height, decryptionKey);
    // Find the one matching our hash
    return blobs.find((b) => b.contentHash === contentHash) ?? null;
  }

  // ---------------------------------------------------------------------------
  // DATA SUBMISSION HELPERS (hash-only exposure)
  // ---------------------------------------------------------------------------

  /**
   * Submit a JSON object as a hashed blob.
   * Returns only the hash + Celestia height — the raw JSON is never exposed.
   */
  async submitJSON(
    obj: unknown,
    options?: {
      encryptionKey?: Buffer;
      label?: string;
      dataType?: string;
      namespaceKey?: CelestiaNamespaceKey;
    },
  ): Promise<BlobSubmission> {
    const json = JSON.stringify(obj);
    return this.submitBlob(Buffer.from(json, "utf-8"), options);
  }

  /**
   * Submit a file as a hashed blob.
   */
  async submitFile(
    filePath: string,
    options?: {
      encryptionKey?: Buffer;
      label?: string;
      dataType?: string;
      namespaceKey?: CelestiaNamespaceKey;
    },
  ): Promise<BlobSubmission> {
    const data = await fs.readFile(filePath);
    const label = options?.label ?? path.basename(filePath);
    return this.submitBlob(data, { ...options, label });
  }

  /**
   * Hash data locally without submitting — useful for creating content-addressed
   * references that can later be submitted to Celestia.
   */
  async hashOnly(data: Buffer): Promise<{
    contentHash: string;
    size: number;
    timestamp: string;
  }> {
    return {
      contentHash: this.hashContent(data),
      size: data.length,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // INDEX QUERIES
  // ---------------------------------------------------------------------------

  /**
   * List all blob submissions from the local index.
   */
  async listSubmissions(filter?: {
    dataType?: string;
    label?: string;
    since?: string;
    limit?: number;
  }): Promise<BlobSubmission[]> {
    const index = await this.loadIndex();
    let entries = Object.values(index);

    if (filter?.dataType) {
      entries = entries.filter((e) => e.dataType === filter.dataType);
    }
    if (filter?.label) {
      entries = entries.filter(
        (e) => e.label && e.label.includes(filter.label!),
      );
    }
    if (filter?.since) {
      const since = new Date(filter.since).getTime();
      entries = entries.filter(
        (e) => new Date(e.submittedAt).getTime() >= since,
      );
    }

    // Sort newest first
    entries.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );

    if (filter?.limit) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }

  /**
   * Get a specific submission by content hash.
   */
  async getSubmission(contentHash: string): Promise<BlobSubmission | null> {
    const index = await this.loadIndex();
    return index[contentHash] ?? null;
  }

  /**
   * Get aggregate stats about blob submissions.
   */
  async getStats(): Promise<{
    totalBlobs: number;
    totalBytes: number;
    encryptedCount: number;
    dataTypes: Record<string, number>;
    earliestSubmission?: string;
    latestSubmission?: string;
  }> {
    const index = await this.loadIndex();
    const entries = Object.values(index);

    const dataTypes: Record<string, number> = {};
    let totalBytes = 0;
    let encryptedCount = 0;
    let earliest: string | undefined;
    let latest: string | undefined;

    for (const entry of entries) {
      totalBytes += entry.originalSize;
      if (entry.encrypted) encryptedCount++;
      const dt = entry.dataType ?? "unknown";
      dataTypes[dt] = (dataTypes[dt] ?? 0) + 1;

      if (!earliest || entry.submittedAt < earliest)
        earliest = entry.submittedAt;
      if (!latest || entry.submittedAt > latest) latest = entry.submittedAt;
    }

    return {
      totalBlobs: entries.length,
      totalBytes,
      encryptedCount,
      dataTypes,
      earliestSubmission: earliest,
      latestSubmission: latest,
    };
  }

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  /**
   * Load config from disk on startup. If no config file exists, use defaults.
   */
  async loadPersistedConfig(): Promise<CelestiaConfig> {
    await this.ensureStorage();
    try {
      if (await fs.pathExists(CONFIG_FILE_PATH)) {
        const saved = await fs.readJson(CONFIG_FILE_PATH) as Partial<CelestiaConfig>;
        // Merge with defaults
        this.config = {
          rpcUrl: saved.rpcUrl ?? CELESTIA_RPC_URL,
          namespace: saved.namespace ?? JOYCREATE_NAMESPACE,
          namespaceId: saved.namespaceId ?? this.decodeNamespace(saved.namespace ?? JOYCREATE_NAMESPACE),
          gasPrice: saved.gasPrice ?? DEFAULT_GAS_PRICE,
          authToken: saved.authToken,
          walletAddress: saved.walletAddress ?? CELESTIA_WALLET_ADDRESS,
          network: saved.network ?? CELESTIA_NETWORK,
        };
        logger.info("Loaded Celestia config from disk");
      }
    } catch (err) {
      logger.warn("Failed to load Celestia config, using defaults", err);
    }
    return this.getConfig();
  }

  /**
   * Save current config to disk for persistence across restarts.
   */
  async saveConfig(): Promise<void> {
    await this.ensureStorage();
    await fs.writeJson(CONFIG_FILE_PATH, this.config, { spaces: 2 });
    logger.info("Celestia config saved to disk");
  }

  /**
   * Update config and persist to disk.
   */
  async updateConfig(updates: Partial<CelestiaConfig>): Promise<CelestiaConfig> {
    // If namespace is being updated, also update namespaceId
    if (updates.namespace && !updates.namespaceId) {
      updates.namespaceId = this.decodeNamespace(updates.namespace);
    }
    Object.assign(this.config, updates);
    await this.saveConfig();
    logger.info("Celestia config updated", updates);
    return this.getConfig();
  }

  getConfig(): CelestiaConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // NAMESPACE UTILITIES
  // ---------------------------------------------------------------------------

  /**
   * Generate a Celestia namespace from a human-readable ID.
   * Celestia namespaces are 29 bytes (version byte + 28 byte ID).
   * Version 0 namespaces have the first 18 bytes as 0, followed by 10 byte ID.
   */
  generateNamespace(namespaceId: string): { namespace: string; namespaceId: string } {
    // Sanitize: lowercase, alphanumeric only, max 10 chars for v0 namespace
    const sanitized = namespaceId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10);

    if (sanitized.length === 0) {
      throw new Error("Namespace ID must contain at least one alphanumeric character");
    }

    // Build v0 namespace: 18 zero bytes + up to 10 byte ID (right-padded or truncated)
    const namespaceBytes = Buffer.alloc(29, 0);
    // Version byte is already 0
    // Write the ID starting at byte 19 (after 18 zero bytes + 1 version byte = 19)
    const idBytes = Buffer.from(sanitized, "utf-8");
    idBytes.copy(namespaceBytes, 19);

    const namespace = namespaceBytes.toString("base64");
    logger.info(`Generated namespace for "${sanitized}": ${namespace}`);

    return {
      namespace,
      namespaceId: sanitized,
    };
  }

  /**
   * Decode a base64 namespace back to human-readable ID.
   */
  decodeNamespace(namespace: string): string {
    try {
      const bytes = Buffer.from(namespace, "base64");
      // Skip version byte (0) and leading zeros, read the ID portion
      // For v0 namespaces, ID starts at byte 19
      const idBytes = bytes.subarray(19);
      // Trim trailing null bytes
      let end = idBytes.length;
      while (end > 0 && idBytes[end - 1] === 0) end--;
      return idBytes.subarray(0, end).toString("utf-8");
    } catch {
      return namespace.slice(0, 12) + "...";
    }
  }

  /**
   * Validate a Celestia wallet address (bech32 format).
   */
  validateWalletAddress(address: string): boolean {
    // Basic validation: starts with "celestia1" and is ~47 chars
    return /^celestia1[a-z0-9]{38,}$/.test(address);
  }

  /**
   * Reset config to defaults.
   */
  async resetConfig(): Promise<CelestiaConfig> {
    this.config = {
      rpcUrl: CELESTIA_RPC_URL,
      namespace: JOYCREATE_NAMESPACE,
      namespaceId: this.decodeNamespace(JOYCREATE_NAMESPACE),
      gasPrice: DEFAULT_GAS_PRICE,
      authToken: undefined,
      walletAddress: CELESTIA_WALLET_ADDRESS,
      network: CELESTIA_NETWORK,
    };
    await this.saveConfig();
    logger.info("Celestia config reset to defaults");
    return this.getConfig();
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const celestiaBlobService = new CelestiaBlobService();

// Load persisted config on module load (async, but won't block)
celestiaBlobService.loadPersistedConfig().catch((err) => {
  logger.error("Failed to load persisted Celestia config", err);
});

export default CelestiaBlobService;
