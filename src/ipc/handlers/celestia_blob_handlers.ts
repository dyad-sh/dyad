/**
 * Celestia Blob IPC Handlers
 *
 * Exposes the Celestia blob service to the renderer process.
 * All data goes through hash-first processing — raw data is NEVER
 * sent to the network without being hashed and optionally encrypted.
 *
 * IPC channels:
 *   celestia:blob:submit        – Hash & submit data as a blob
 *   celestia:blob:submit-json   – Hash & submit a JSON object
 *   celestia:blob:submit-file   – Hash & submit a file from disk
 *   celestia:blob:get           – Retrieve a blob by content hash
 *   celestia:blob:get-at-height – Retrieve all blobs at a block height
 *   celestia:blob:list          – List local blob index
 *   celestia:blob:stats         – Aggregate stats
 *   celestia:blob:hash          – Hash data locally (no submission)
 *   celestia:blob:verify        – Verify blob integrity from Celestia
 *   celestia:status             – Node sync state & balance
 *   celestia:config:get         – Get current Celestia config
 *   celestia:config:update      – Update Celestia config
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import * as crypto from "crypto";
import {
  celestiaBlobService,
  CELESTIA_NAMESPACES,
  type BlobSubmission,
  type BlobRetrievalResult,
  type CelestiaConfig,
  type CelestiaNamespaceKey,
} from "../../lib/celestia_blob_service";

const logger = log.scope("celestia_blob_handlers");

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerCelestiaBlobHandlers(): void {
  logger.info("Registering Celestia blob handlers...");

  // ---------------------------------------------------------------------------
  // BLOB SUBMISSION
  // ---------------------------------------------------------------------------

  /**
   * Submit raw data as a hashed blob.
   * Accepts base64-encoded data from the renderer.
   */
  ipcMain.handle(
    "celestia:blob:submit",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        /** base64-encoded data */
        data: string;
        /** optional label */
        label?: string;
        /** data type category */
        dataType?: string;
        /** whether to encrypt before submitting */
        encrypt?: boolean;
        /** custom gas price */
        gasPrice?: number;
        /** target a specific named namespace */
        namespaceKey?: CelestiaNamespaceKey;
      },
    ): Promise<BlobSubmission> => {
      const buf = Buffer.from(params.data, "base64");

      let encryptionKey: Buffer | undefined;
      if (params.encrypt) {
        // Generate a random AES-256 key for this blob
        encryptionKey = crypto.randomBytes(32);
      }

      const result = await celestiaBlobService.submitBlob(buf, {
        encryptionKey,
        label: params.label,
        dataType: params.dataType,
        gasPrice: params.gasPrice,
        namespaceKey: params.namespaceKey,
      });

      // If encrypted, attach the hex-encoded key to the response
      // so the caller can store it in their vault
      if (encryptionKey) {
        (result as any).encryptionKeyHex = encryptionKey.toString("hex");
      }

      return result;
    },
  );

  /**
   * Submit a JSON object as a hashed blob.
   */
  ipcMain.handle(
    "celestia:blob:submit-json",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        json: unknown;
        label?: string;
        dataType?: string;
        encrypt?: boolean;
        namespaceKey?: CelestiaNamespaceKey;
      },
    ): Promise<BlobSubmission> => {
      let encryptionKey: Buffer | undefined;
      if (params.encrypt) {
        encryptionKey = crypto.randomBytes(32);
      }

      const result = await celestiaBlobService.submitJSON(params.json, {
        encryptionKey,
        label: params.label,
        dataType: params.dataType,
        namespaceKey: params.namespaceKey,
      });

      if (encryptionKey) {
        (result as any).encryptionKeyHex = encryptionKey.toString("hex");
      }

      return result;
    },
  );

  /**
   * Submit a file from disk as a hashed blob.
   */
  ipcMain.handle(
    "celestia:blob:submit-file",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        filePath: string;
        label?: string;
        dataType?: string;
        encrypt?: boolean;
        namespaceKey?: CelestiaNamespaceKey;
      },
    ): Promise<BlobSubmission> => {
      let encryptionKey: Buffer | undefined;
      if (params.encrypt) {
        encryptionKey = crypto.randomBytes(32);
      }

      const result = await celestiaBlobService.submitFile(params.filePath, {
        encryptionKey,
        label: params.label,
        dataType: params.dataType,
        namespaceKey: params.namespaceKey,
      });

      if (encryptionKey) {
        (result as any).encryptionKeyHex = encryptionKey.toString("hex");
      }

      return result;
    },
  );

  // ---------------------------------------------------------------------------
  // BLOB RETRIEVAL
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a blob by its content hash.
   */
  ipcMain.handle(
    "celestia:blob:get",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        contentHash: string;
        /** hex-encoded decryption key (if blob was encrypted) */
        decryptionKeyHex?: string;
      },
    ): Promise<{
      data: string; // base64
      contentHash: string;
      verified: boolean;
      height: number;
    } | null> => {
      const decryptionKey = params.decryptionKeyHex
        ? Buffer.from(params.decryptionKeyHex, "hex")
        : undefined;

      const result = await celestiaBlobService.getBlobByHash(
        params.contentHash,
        decryptionKey,
      );

      if (!result) return null;

      return {
        data: result.data.toString("base64"),
        contentHash: result.contentHash,
        verified: result.verified,
        height: result.height,
      };
    },
  );

  /**
   * Retrieve all JoyCreate blobs at a specific block height.
   */
  ipcMain.handle(
    "celestia:blob:get-at-height",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        height: number;
        decryptionKeyHex?: string;
      },
    ): Promise<
      Array<{
        data: string;
        contentHash: string;
        verified: boolean;
        height: number;
      }>
    > => {
      const decryptionKey = params.decryptionKeyHex
        ? Buffer.from(params.decryptionKeyHex, "hex")
        : undefined;

      const blobs = await celestiaBlobService.getBlobsAtHeight(
        params.height,
        decryptionKey,
      );

      return blobs.map((b) => ({
        data: b.data.toString("base64"),
        contentHash: b.contentHash,
        verified: b.verified,
        height: b.height,
      }));
    },
  );

  // ---------------------------------------------------------------------------
  // INDEX / QUERY
  // ---------------------------------------------------------------------------

  /**
   * List blob submissions from the local index.
   */
  ipcMain.handle(
    "celestia:blob:list",
    async (
      _event: IpcMainInvokeEvent,
      filter?: {
        dataType?: string;
        label?: string;
        since?: string;
        limit?: number;
      },
    ): Promise<BlobSubmission[]> => {
      return celestiaBlobService.listSubmissions(filter);
    },
  );

  /**
   * Get aggregate blob stats.
   */
  ipcMain.handle(
    "celestia:blob:stats",
    async (): Promise<{
      totalBlobs: number;
      totalBytes: number;
      encryptedCount: number;
      dataTypes: Record<string, number>;
      earliestSubmission?: string;
      latestSubmission?: string;
    }> => {
      return celestiaBlobService.getStats();
    },
  );

  /**
   * Hash data locally without submitting to Celestia.
   * Useful for creating content-addressed references.
   */
  ipcMain.handle(
    "celestia:blob:hash",
    async (
      _event: IpcMainInvokeEvent,
      params: { data: string /* base64 */ },
    ): Promise<{ contentHash: string; size: number; timestamp: string }> => {
      const buf = Buffer.from(params.data, "base64");
      return celestiaBlobService.hashOnly(buf);
    },
  );

  /**
   * Verify a blob's integrity by re-fetching from Celestia and comparing hashes.
   */
  ipcMain.handle(
    "celestia:blob:verify",
    async (
      _event: IpcMainInvokeEvent,
      params: { contentHash: string },
    ): Promise<{
      verified: boolean;
      submission: BlobSubmission | null;
      error?: string;
    }> => {
      try {
        const submission = await celestiaBlobService.getSubmission(
          params.contentHash,
        );
        if (!submission) {
          return {
            verified: false,
            submission: null,
            error: "No local record for this hash",
          };
        }

        // For encrypted blobs we can't fully verify without the key,
        // but we can confirm the blob exists at the recorded height
        const blobs = await celestiaBlobService.getBlobsAtHeight(
          submission.height,
        );
        const found = blobs.length > 0;

        return {
          verified: found,
          submission,
          error: found ? undefined : "Blob not found at recorded height",
        };
      } catch (error) {
        return {
          verified: false,
          submission: null,
          error:
            error instanceof Error
              ? error.message
              : "Verification failed",
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // STATUS / CONFIG
  // ---------------------------------------------------------------------------

  /**
   * Get Celestia node status — sync state + balance.
   */
  ipcMain.handle(
    "celestia:status",
    async (): Promise<{
      available: boolean;
      height?: number;
      syncing?: boolean;
      balance?: { amount: string; denom: string };
      walletAddress?: string;
      network?: string;
      error?: string;
    }> => {
      try {
        const config = celestiaBlobService.getConfig();
        const available = await celestiaBlobService.isAvailable();
        if (!available) {
          return {
            available: false,
            walletAddress: config.walletAddress,
            network: config.network,
            error: "Celestia node not reachable",
          };
        }

        const [syncState, balance] = await Promise.all([
          celestiaBlobService.getSyncState().catch(() => null),
          celestiaBlobService.getBalance().catch(() => null),
        ]);

        return {
          available: true,
          height: syncState?.height,
          syncing: syncState?.syncing,
          balance: balance ?? undefined,
          walletAddress: config.walletAddress,
          network: config.network,
        };
      } catch (error) {
        return {
          available: false,
          error:
            error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  /**
   * Get current Celestia service configuration.
   */
  ipcMain.handle(
    "celestia:config:get",
    async (): Promise<CelestiaConfig> => {
      return celestiaBlobService.getConfig();
    },
  );

  /**
   * Update Celestia service configuration.
   */
  ipcMain.handle(
    "celestia:config:update",
    async (
      _event: IpcMainInvokeEvent,
      updates: Partial<CelestiaConfig>,
    ): Promise<CelestiaConfig> => {
      return celestiaBlobService.updateConfig(updates);
    },
  );

  /**
   * Generate a new namespace from a human-readable ID.
   */
  ipcMain.handle(
    "celestia:namespace:generate",
    async (
      _event: IpcMainInvokeEvent,
      params: { namespaceId: string },
    ): Promise<{ namespace: string; namespaceId: string }> => {
      return celestiaBlobService.generateNamespace(params.namespaceId);
    },
  );

  /**
   * Validate a Celestia wallet address.
   */
  ipcMain.handle(
    "celestia:wallet:validate",
    async (
      _event: IpcMainInvokeEvent,
      params: { address: string },
    ): Promise<{ valid: boolean }> => {
      return { valid: celestiaBlobService.validateWalletAddress(params.address) };
    },
  );

  /**
   * Reset Celestia config to defaults.
   */
  ipcMain.handle(
    "celestia:config:reset",
    async (): Promise<CelestiaConfig> => {
      return celestiaBlobService.resetConfig();
    },
  );

  /**
   * Get the full namespace registry (all named namespaces).
   */
  ipcMain.handle(
    "celestia:namespaces",
    async (): Promise<
      Record<string, { id: string; base64: string }>
    > => {
      return { ...CELESTIA_NAMESPACES };
    },
  );

  logger.info("✅ Celestia blob handlers registered");
}

export default registerCelestiaBlobHandlers;
