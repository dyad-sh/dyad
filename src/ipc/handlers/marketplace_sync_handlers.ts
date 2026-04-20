/**
 * JoyMarketplace Sync IPC Handlers
 * Connects local JoyCreate app to joymarketplace.io
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { marketplaceSyncService, type AssetListing, type StoreInfo } from "@/lib/marketplace_sync_service";
import { receiptPinningService, type PinningCredentials } from "@/lib/receipt_pinning_service";
import { CONTRACT_ADDRESSES, JOYMARKETPLACE_API, PAYOUT_CONFIG, POLYGON_MAINNET } from "@/config/joymarketplace";
import type { IpldInferenceReceipt, IpldReceiptRecord } from "@/types/ipld_receipt";

const logger = log.scope("marketplace_sync_handlers");

// =============================================================================
// CREDENTIAL STORAGE
// =============================================================================

interface MarketplaceConfig {
  apiKey?: string;
  publisherId?: string;
  pinningCredentials?: PinningCredentials;
  defaultStore?: StoreInfo;
}

let marketplaceConfig: MarketplaceConfig = {};

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "joymarketplace-config.json");
}

async function loadConfig(): Promise<MarketplaceConfig> {
  try {
    const configPath = getConfigPath();
    if (await fs.pathExists(configPath)) {
      marketplaceConfig = await fs.readJson(configPath);
    }
  } catch (error) {
    logger.warn("Failed to load marketplace config:", error);
  }
  return marketplaceConfig;
}

async function saveConfig(config: Partial<MarketplaceConfig>): Promise<void> {
  marketplaceConfig = { ...marketplaceConfig, ...config };
  await fs.writeJson(getConfigPath(), marketplaceConfig, { spaces: 2 });
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

export function registerMarketplaceSyncHandlers() {
  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  /**
   * Get marketplace configuration including contract addresses
   */
  ipcMain.handle("marketplace-sync:get-config", async () => {
    await loadConfig();
    return {
      contracts: CONTRACT_ADDRESSES,
      api: {
        baseUrl: JOYMARKETPLACE_API.baseUrl,
        webUrl: JOYMARKETPLACE_API.webUrl,
      },
      network: POLYGON_MAINNET,
      payout: {
        usdcContract: PAYOUT_CONFIG.usdcContract,
        minimumPayout: PAYOUT_CONFIG.minimumPayout,
        platformFee: PAYOUT_CONFIG.platformFee,
      },
      connected: !!marketplaceConfig.apiKey,
      publisherId: marketplaceConfig.publisherId,
    };
  });

  /**
   * Connect to JoyMarketplace with API key
   */
  ipcMain.handle("marketplace-sync:connect", async (_, apiKey: string) => {
    try {
      // Verify the API key with joy-create-verify edge function
      const url = `${JOYMARKETPLACE_API.baseUrl}${JOYMARKETPLACE_API.endpoints.verify}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "x-joy-api-key": apiKey,
          "apikey": JOYMARKETPLACE_API.supabaseAnonKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Verification failed (${response.status}): ${body}`);
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error("API key verification returned ok=false");
      }
      
      // Save credentials
      await saveConfig({
        apiKey,
        publisherId: data.user_id,
      });

      // Initialize sync service
      await marketplaceSyncService.initialize(apiKey);

      logger.info(`Connected to JoyMarketplace (user=${data.user_id})`);
      
      return {
        success: true,
        publisherId: data.user_id,
        scopes: data.scopes,
        network: data.network,
      };
    } catch (error) {
      logger.error("Failed to connect to marketplace:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  /**
   * Disconnect from JoyMarketplace
   */
  ipcMain.handle("marketplace-sync:disconnect", async () => {
    await saveConfig({
      apiKey: undefined,
      publisherId: undefined,
    });
    return { success: true };
  });

  // ===========================================================================
  // STORE / DOMAIN
  // ===========================================================================

  /**
   * Get store info from a .joy domain
   */
  ipcMain.handle("marketplace-sync:get-store-from-domain", async (_, domainName: string) => {
    return marketplaceSyncService.getStoreFromDomain(domainName);
  });

  /**
   * Verify domain ownership
   */
  ipcMain.handle("marketplace-sync:verify-domain", async (_, domainName: string, walletAddress: string) => {
    return marketplaceSyncService.verifyDomainOwnership(domainName, walletAddress);
  });

  /**
   * Set default store for listings
   */
  ipcMain.handle("marketplace-sync:set-default-store", async (_, store: StoreInfo) => {
    await saveConfig({ defaultStore: store });
    return { success: true };
  });

  /**
   * Get default store
   */
  ipcMain.handle("marketplace-sync:get-default-store", async () => {
    await loadConfig();
    return marketplaceConfig.defaultStore || null;
  });

  // ===========================================================================
  // LISTING SYNC
  // ===========================================================================

  /**
   * Sync a single listing to the marketplace
   */
  ipcMain.handle("marketplace-sync:sync-listing", async (_, listing: AssetListing) => {
    await loadConfig();
    
    if (!marketplaceConfig.apiKey) {
      return {
        success: false,
        error: "Not connected to marketplace. Please connect first.",
      };
    }

    // Initialize service if needed
    if (marketplaceConfig.apiKey) {
      await marketplaceSyncService.initialize(marketplaceConfig.apiKey);
    }

    return marketplaceSyncService.syncListing(listing);
  });

  /**
   * Batch sync multiple listings
   */
  ipcMain.handle("marketplace-sync:batch-sync", async (_, listings: AssetListing[]) => {
    await loadConfig();
    
    if (!marketplaceConfig.apiKey) {
      return listings.map(() => ({
        success: false,
        error: "Not connected to marketplace",
      }));
    }

    if (marketplaceConfig.apiKey) {
      await marketplaceSyncService.initialize(marketplaceConfig.apiKey);
    }

    return marketplaceSyncService.batchSyncListings(listings);
  });

  // ===========================================================================
  // RECEIPT HANDLING
  // ===========================================================================

  /**
   * Ingest a receipt to the marketplace
   */
  ipcMain.handle("marketplace-sync:ingest-receipt", async (_, receipt: IpldInferenceReceipt, cid: string) => {
    await loadConfig();
    
    if (!marketplaceConfig.apiKey || !marketplaceConfig.publisherId) {
      return {
        success: false,
        error: "Not connected to marketplace",
      };
    }

    await marketplaceSyncService.initialize(marketplaceConfig.apiKey);

    return marketplaceSyncService.ingestReceipt(receipt, cid);
  });

  /**
   * Verify a receipt exists on the marketplace
   */
  ipcMain.handle("marketplace-sync:verify-receipt", async (_, cid: string) => {
    await loadConfig();
    
    if (!marketplaceConfig.apiKey || !marketplaceConfig.publisherId) {
      return { verified: false };
    }

    await marketplaceSyncService.initialize(marketplaceConfig.apiKey);

    return marketplaceSyncService.verifyReceipt(cid);
  });

  // ===========================================================================
  // PINNING
  // ===========================================================================

  /**
   * Configure pinning credentials
   */
  ipcMain.handle("marketplace-sync:configure-pinning", async (_, credentials: PinningCredentials) => {
    await receiptPinningService.saveCredentials(credentials);
    await saveConfig({ pinningCredentials: credentials });
    return { success: true };
  });

  /**
   * Pin a receipt to IPFS services
   */
  ipcMain.handle("marketplace-sync:pin-receipt", async (_, receiptRecord: IpldReceiptRecord) => {
    return receiptPinningService.pinReceipt(receiptRecord);
  });

  /**
   * Pin multiple receipts
   */
  ipcMain.handle("marketplace-sync:pin-receipts-batch", async (_, receipts: IpldReceiptRecord[]) => {
    const results = await receiptPinningService.pinReceiptBatch(receipts);
    // Convert Map to object for IPC
    const resultObj: Record<string, any[]> = {};
    results.forEach((value, key) => {
      resultObj[key] = value;
    });
    return resultObj;
  });

  /**
   * Get pin status for a CID
   */
  ipcMain.handle("marketplace-sync:get-pin-status", async (_, cid: string) => {
    return receiptPinningService.getPinStatus(cid);
  });

  /**
   * Unpin a receipt
   */
  ipcMain.handle("marketplace-sync:unpin-receipt", async (_, cid: string) => {
    await receiptPinningService.unpinReceipt(cid);
    return { success: true };
  });

  /**
   * Get gateway URL for a CID
   */
  ipcMain.handle("marketplace-sync:get-gateway-url", async (_, cid: string, provider?: "4everland" | "pinata") => {
    return receiptPinningService.getGatewayUrl(cid, provider);
  });

  // ===========================================================================
  // PAYOUT
  // ===========================================================================

  /**
   * Verify a USDC payout transaction
   */
  ipcMain.handle("marketplace-sync:verify-payout", async (_, transactionHash: string) => {
    return marketplaceSyncService.verifyPayout(transactionHash);
  });

  /**
   * Get USDC balance for a wallet
   */
  ipcMain.handle("marketplace-sync:get-usdc-balance", async (_, walletAddress: string) => {
    return marketplaceSyncService.getUSDCBalance(walletAddress);
  });

  // ===========================================================================
  // NFT
  // ===========================================================================

  /**
   * Get NFT metadata
   */
  ipcMain.handle("marketplace-sync:get-nft-metadata", async (_, tokenId: number) => {
    return marketplaceSyncService.getNFTMetadata(tokenId);
  });

  /**
   * Get owned NFTs for a wallet
   */
  ipcMain.handle("marketplace-sync:get-owned-nfts", async (_, walletAddress: string) => {
    return marketplaceSyncService.getOwnedNFTs(walletAddress);
  });

  // ===========================================================================
  // GOLDSKY SUBGRAPH QUERIES
  // ===========================================================================

  /**
   * Query the Joy Marketplace subgraph for listings and activity
   */
  ipcMain.handle(
    "marketplace-sync:query-marketplace-subgraph",
    async (_, query: string, variables?: Record<string, unknown>) => {
      const { querySubgraph } = await import("@/config/thirdweb");
      return querySubgraph("marketplace", query, variables);
    },
  );

  /**
   * Query the Joy Stores subgraph for store metadata
   */
  ipcMain.handle(
    "marketplace-sync:query-stores-subgraph",
    async (_, query: string, variables?: Record<string, unknown>) => {
      const { querySubgraph } = await import("@/config/thirdweb");
      return querySubgraph("stores", query, variables);
    },
  );

  /**
   * Query the Joy Drop subgraph for edition drops and claims
   */
  ipcMain.handle(
    "marketplace-sync:query-drop-subgraph",
    async (_, query: string, variables?: Record<string, unknown>) => {
      const { querySubgraph } = await import("@/config/thirdweb");
      return querySubgraph("drop", query, variables);
    },
  );

  /**
   * Get all active marketplace listings from subgraph
   */
  ipcMain.handle("marketplace-sync:get-active-listings", async () => {
    const { querySubgraph } = await import("@/config/thirdweb");
    return querySubgraph("marketplace", `{
      listings(where: { status: "active" }, orderBy: createdAt, orderDirection: desc, first: 100) {
        id
        tokenId
        seller
        price
        currency
        status
        createdAt
        metadata {
          name
          description
          image
          category
        }
      }
    }`);
  });

  /**
   * Get store details from subgraph by owner address
   */
  ipcMain.handle("marketplace-sync:get-store-by-owner", async (_, ownerAddress: string) => {
    if (!ownerAddress) throw new Error("ownerAddress is required");
    const { querySubgraph } = await import("@/config/thirdweb");
    return querySubgraph("stores", `{
      stores(where: { owner: "${ownerAddress.toLowerCase()}" }) {
        id
        name
        owner
        description
        logo
        banner
        totalAssets
        totalSales
        createdAt
      }
    }`);
  });

  /**
   * Get drop claims and mints from subgraph
   */
  ipcMain.handle("marketplace-sync:get-drops", async () => {
    const { querySubgraph } = await import("@/config/thirdweb");
    return querySubgraph("drop", `{
      drops(orderBy: createdAt, orderDirection: desc, first: 50) {
        id
        tokenId
        creator
        maxSupply
        claimed
        price
        active
        metadata {
          name
          description
          image
        }
        createdAt
      }
    }`);
  });

  logger.info("JoyMarketplace sync handlers registered");
}

export default registerMarketplaceSyncHandlers;
