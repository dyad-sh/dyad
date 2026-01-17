/**
 * Receipt Pinning Service
 * Handles pinning IPLD receipts to 4everland and other IPFS services
 */

import * as fs from "fs-extra";
import * as path from "path";
import { app } from "electron";
import log from "electron-log";
import { PINNING_CONFIG } from "@/config/joymarketplace";
import type { IpldInferenceReceipt, IpldReceiptRecord } from "@/types/ipld_receipt";

const logger = log.scope("receipt_pinning");

// =============================================================================
// TYPES
// =============================================================================

export interface PinResult {
  success: boolean;
  cid: string;
  provider: "4everland" | "pinata" | "helia";
  pinId?: string;
  gateway?: string;
  error?: string;
}

export interface PinStatus {
  cid: string;
  pinned: boolean;
  providers: {
    name: string;
    pinned: boolean;
    pinId?: string;
  }[];
}

export interface PinningCredentials {
  foureverland?: {
    apiKey: string;
    projectId: string;
  };
  pinata?: {
    apiKey: string;
    secretKey: string;
  };
}

// =============================================================================
// RECEIPT PINNING SERVICE
// =============================================================================

export class ReceiptPinningService {
  private credentials: PinningCredentials = {};
  private pinnedCids: Map<string, PinStatus> = new Map();

  constructor() {
    this.loadCredentials();
  }

  /**
   * Load pinning credentials from environment or settings
   */
  private async loadCredentials(): Promise<void> {
    const settingsPath = path.join(app.getPath("userData"), "pinning-credentials.json");
    
    try {
      if (await fs.pathExists(settingsPath)) {
        this.credentials = await fs.readJson(settingsPath);
      }
    } catch (error) {
      logger.warn("Failed to load pinning credentials:", error);
    }

    // Also check environment variables
    if (process.env.FOUREVERLAND_API_KEY) {
      this.credentials.foureverland = {
        apiKey: process.env.FOUREVERLAND_API_KEY,
        projectId: process.env.FOUREVERLAND_PROJECT_ID || "",
      };
    }

    if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) {
      this.credentials.pinata = {
        apiKey: process.env.PINATA_API_KEY,
        secretKey: process.env.PINATA_SECRET_KEY,
      };
    }
  }

  /**
   * Save pinning credentials
   */
  async saveCredentials(credentials: PinningCredentials): Promise<void> {
    const settingsPath = path.join(app.getPath("userData"), "pinning-credentials.json");
    this.credentials = { ...this.credentials, ...credentials };
    await fs.writeJson(settingsPath, this.credentials, { spaces: 2 });
    logger.info("Pinning credentials saved");
  }

  // ===========================================================================
  // 4EVERLAND PINNING
  // ===========================================================================

  /**
   * Pin content to 4everland
   */
  async pinTo4everland(cid: string, name?: string): Promise<PinResult> {
    if (!this.credentials.foureverland?.apiKey) {
      return {
        success: false,
        cid,
        provider: "4everland",
        error: "4everland API key not configured",
      };
    }

    try {
      const response = await fetch(`${PINNING_CONFIG.foureverland.apiUrl}${PINNING_CONFIG.foureverland.pinningEndpoint}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.credentials.foureverland.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cid,
          name: name || `receipt-${cid.slice(0, 8)}`,
          projectId: this.credentials.foureverland.projectId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`4everland API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      logger.info(`Pinned to 4everland: ${cid}`);
      
      return {
        success: true,
        cid,
        provider: "4everland",
        pinId: data.pinId || data.id,
        gateway: `${PINNING_CONFIG.foureverland.gateway}/${cid}`,
      };
    } catch (error) {
      logger.error(`Failed to pin to 4everland:`, error);
      return {
        success: false,
        cid,
        provider: "4everland",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check pin status on 4everland
   */
  async check4everlandPin(cid: string): Promise<boolean> {
    if (!this.credentials.foureverland?.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${PINNING_CONFIG.foureverland.apiUrl}/bucket/pin/${cid}`, {
        headers: {
          "Authorization": `Bearer ${this.credentials.foureverland.apiKey}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // PINATA PINNING (BACKUP)
  // ===========================================================================

  /**
   * Pin content to Pinata
   */
  async pinToPinata(cid: string, name?: string): Promise<PinResult> {
    if (!this.credentials.pinata?.apiKey || !this.credentials.pinata?.secretKey) {
      return {
        success: false,
        cid,
        provider: "pinata",
        error: "Pinata credentials not configured",
      };
    }

    try {
      const response = await fetch(`${PINNING_CONFIG.pinata.apiUrl}/pinning/pinByHash`, {
        method: "POST",
        headers: {
          "pinata_api_key": this.credentials.pinata.apiKey,
          "pinata_secret_api_key": this.credentials.pinata.secretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hashToPin: cid,
          pinataMetadata: {
            name: name || `receipt-${cid.slice(0, 8)}`,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pinata API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      logger.info(`Pinned to Pinata: ${cid}`);
      
      return {
        success: true,
        cid,
        provider: "pinata",
        pinId: data.id,
        gateway: `${PINNING_CONFIG.pinata.gateway}/${cid}`,
      };
    } catch (error) {
      logger.error(`Failed to pin to Pinata:`, error);
      return {
        success: false,
        cid,
        provider: "pinata",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ===========================================================================
  // HELIA LOCAL PINNING
  // ===========================================================================

  /**
   * Pin content to local Helia node
   */
  async pinToHelia(cid: string): Promise<PinResult> {
    try {
      // Connect to local Helia node
      const response = await fetch(`${PINNING_CONFIG.helia.localNode}/api/v0/pin/add?arg=${cid}`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Helia API error: ${response.status} - ${error}`);
      }

      logger.info(`Pinned to Helia: ${cid}`);
      
      return {
        success: true,
        cid,
        provider: "helia",
        gateway: `http://localhost:8080/ipfs/${cid}`,
      };
    } catch (error) {
      logger.warn(`Failed to pin to Helia (local node may not be running):`, error);
      return {
        success: false,
        cid,
        provider: "helia",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ===========================================================================
  // RECEIPT PINNING
  // ===========================================================================

  /**
   * Pin a receipt to all configured providers
   */
  async pinReceipt(receipt: IpldReceiptRecord): Promise<PinResult[]> {
    const results: PinResult[] = [];
    const name = `joy-receipt-${receipt.cid.slice(0, 12)}`;

    // Primary: 4everland
    if (this.credentials.foureverland?.apiKey) {
      const result = await this.pinTo4everland(receipt.cid, name);
      results.push(result);
    }

    // Backup: Pinata
    if (this.credentials.pinata?.apiKey) {
      const result = await this.pinToPinata(receipt.cid, name);
      results.push(result);
    }

    // Local: Helia (if running)
    const heliaResult = await this.pinToHelia(receipt.cid);
    if (heliaResult.success) {
      results.push(heliaResult);
    }

    // Update pin status cache
    this.pinnedCids.set(receipt.cid, {
      cid: receipt.cid,
      pinned: results.some(r => r.success),
      providers: results.map(r => ({
        name: r.provider,
        pinned: r.success,
        pinId: r.pinId,
      })),
    });

    return results;
  }

  /**
   * Pin a batch of receipts
   */
  async pinReceiptBatch(receipts: IpldReceiptRecord[]): Promise<Map<string, PinResult[]>> {
    const results = new Map<string, PinResult[]>();
    
    // Process in parallel with concurrency limit
    const concurrency = 5;
    const batches: IpldReceiptRecord[][] = [];
    
    for (let i = 0; i < receipts.length; i += concurrency) {
      batches.push(receipts.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(receipt => this.pinReceipt(receipt))
      );
      
      batch.forEach((receipt, index) => {
        results.set(receipt.cid, batchResults[index]);
      });
    }

    return results;
  }

  /**
   * Get pin status for a CID
   */
  async getPinStatus(cid: string): Promise<PinStatus> {
    // Check cache first
    if (this.pinnedCids.has(cid)) {
      return this.pinnedCids.get(cid)!;
    }

    const providers: PinStatus["providers"] = [];

    // Check 4everland
    if (this.credentials.foureverland?.apiKey) {
      const pinned = await this.check4everlandPin(cid);
      providers.push({ name: "4everland", pinned });
    }

    const status: PinStatus = {
      cid,
      pinned: providers.some(p => p.pinned),
      providers,
    };

    this.pinnedCids.set(cid, status);
    return status;
  }

  /**
   * Unpin content from all providers
   */
  async unpinReceipt(cid: string): Promise<void> {
    // 4everland unpin
    if (this.credentials.foureverland?.apiKey) {
      try {
        await fetch(`${PINNING_CONFIG.foureverland.apiUrl}/bucket/pin/${cid}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${this.credentials.foureverland.apiKey}`,
          },
        });
      } catch (error) {
        logger.warn(`Failed to unpin from 4everland:`, error);
      }
    }

    // Pinata unpin
    if (this.credentials.pinata?.apiKey) {
      try {
        await fetch(`${PINNING_CONFIG.pinata.apiUrl}/pinning/unpin/${cid}`, {
          method: "DELETE",
          headers: {
            "pinata_api_key": this.credentials.pinata.apiKey,
            "pinata_secret_api_key": this.credentials.pinata.secretKey!,
          },
        });
      } catch (error) {
        logger.warn(`Failed to unpin from Pinata:`, error);
      }
    }

    // Helia unpin
    try {
      await fetch(`${PINNING_CONFIG.helia.localNode}/api/v0/pin/rm?arg=${cid}`, {
        method: "POST",
      });
    } catch {
      // Helia may not be running
    }

    this.pinnedCids.delete(cid);
    logger.info(`Unpinned receipt: ${cid}`);
  }

  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(cid: string, preferredProvider?: "4everland" | "pinata"): string {
    if (preferredProvider === "4everland") {
      return `${PINNING_CONFIG.foureverland.gateway}/${cid}`;
    }
    if (preferredProvider === "pinata") {
      return `${PINNING_CONFIG.pinata.gateway}/${cid}`;
    }
    // Default to 4everland
    return `${PINNING_CONFIG.foureverland.gateway}/${cid}`;
  }
}

// Export singleton instance
export const receiptPinningService = new ReceiptPinningService();
export default receiptPinningService;
