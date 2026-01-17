/**
 * JoyMarketplace Sync Client
 * Renderer-side API for syncing with joymarketplace.io
 */

import type { IpcRenderer } from "electron";
import type { IpldInferenceReceipt, IpldReceiptRecord } from "@/types/ipld_receipt";

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC not available - are you running in Electron?");
    }
  }
  return ipcRenderer;
}

// =============================================================================
// TYPES
// =============================================================================

export interface MarketplaceConfig {
  contracts: Record<string, string>;
  api: {
    baseUrl: string;
    webUrl: string;
  };
  network: {
    chainId: number;
    name: string;
    rpcUrl: string;
  };
  payout: {
    usdcContract: string;
    minimumPayout: number;
    platformFee: number;
  };
  connected: boolean;
  publisherId?: string;
}

export interface StoreInfo {
  storeName: string;
  creatorId: string;
  creatorWallet: string;
  logo?: string;
  bio?: string;
  banner?: string;
  payoutWallet: string;
}

export interface AssetListing {
  localId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  currency: "MATIC" | "USDC" | "JOY";
  thumbnailCid?: string;
  metadataCid?: string;
  contentCid?: string;
  licenseType: string;
  royaltyBps: number;
  store: StoreInfo;
}

export interface SyncResult {
  success: boolean;
  assetId?: string;
  listingId?: string;
  transactionHash?: string;
  error?: string;
}

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

export interface PayoutVerification {
  verified: boolean;
  transactionHash?: string;
  amount?: string;
  timestamp?: number;
  confirmations?: number;
  error?: string;
}

// =============================================================================
// CLIENT API
// =============================================================================

export const MarketplaceSyncClient = {
  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  /**
   * Get marketplace configuration (contracts, API endpoints, etc.)
   */
  async getConfig(): Promise<MarketplaceConfig> {
    return getIpcRenderer().invoke("marketplace-sync:get-config");
  },

  /**
   * Connect to JoyMarketplace with API key
   */
  async connect(apiKey: string): Promise<{ success: boolean; publisherId?: string; profile?: any; error?: string }> {
    return getIpcRenderer().invoke("marketplace-sync:connect", apiKey);
  },

  /**
   * Disconnect from JoyMarketplace
   */
  async disconnect(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace-sync:disconnect");
  },

  // ===========================================================================
  // STORE / DOMAIN
  // ===========================================================================

  /**
   * Get store info from a .joy domain
   */
  async getStoreFromDomain(domainName: string): Promise<StoreInfo | null> {
    return getIpcRenderer().invoke("marketplace-sync:get-store-from-domain", domainName);
  },

  /**
   * Verify domain ownership
   */
  async verifyDomainOwnership(domainName: string, walletAddress: string): Promise<boolean> {
    return getIpcRenderer().invoke("marketplace-sync:verify-domain", domainName, walletAddress);
  },

  /**
   * Set default store for listings
   */
  async setDefaultStore(store: StoreInfo): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace-sync:set-default-store", store);
  },

  /**
   * Get default store
   */
  async getDefaultStore(): Promise<StoreInfo | null> {
    return getIpcRenderer().invoke("marketplace-sync:get-default-store");
  },

  // ===========================================================================
  // LISTING SYNC
  // ===========================================================================

  /**
   * Sync a single listing to joymarketplace.io
   */
  async syncListing(listing: AssetListing): Promise<SyncResult> {
    return getIpcRenderer().invoke("marketplace-sync:sync-listing", listing);
  },

  /**
   * Batch sync multiple listings
   */
  async batchSyncListings(listings: AssetListing[]): Promise<SyncResult[]> {
    return getIpcRenderer().invoke("marketplace-sync:batch-sync", listings);
  },

  // ===========================================================================
  // RECEIPT HANDLING
  // ===========================================================================

  /**
   * Ingest a receipt to the marketplace
   */
  async ingestReceipt(receipt: IpldInferenceReceipt, cid: string): Promise<SyncResult> {
    return getIpcRenderer().invoke("marketplace-sync:ingest-receipt", receipt, cid);
  },

  /**
   * Verify a receipt exists on the marketplace
   */
  async verifyReceipt(cid: string): Promise<{ verified: boolean; receipt?: IpldInferenceReceipt }> {
    return getIpcRenderer().invoke("marketplace-sync:verify-receipt", cid);
  },

  // ===========================================================================
  // PINNING
  // ===========================================================================

  /**
   * Configure pinning credentials (4everland, Pinata)
   */
  async configurePinning(credentials: PinningCredentials): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace-sync:configure-pinning", credentials);
  },

  /**
   * Pin a receipt to IPFS services
   */
  async pinReceipt(receiptRecord: IpldReceiptRecord): Promise<PinResult[]> {
    return getIpcRenderer().invoke("marketplace-sync:pin-receipt", receiptRecord);
  },

  /**
   * Pin multiple receipts
   */
  async pinReceiptsBatch(receipts: IpldReceiptRecord[]): Promise<Record<string, PinResult[]>> {
    return getIpcRenderer().invoke("marketplace-sync:pin-receipts-batch", receipts);
  },

  /**
   * Get pin status for a CID
   */
  async getPinStatus(cid: string): Promise<PinStatus> {
    return getIpcRenderer().invoke("marketplace-sync:get-pin-status", cid);
  },

  /**
   * Unpin a receipt
   */
  async unpinReceipt(cid: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace-sync:unpin-receipt", cid);
  },

  /**
   * Get gateway URL for a CID
   */
  async getGatewayUrl(cid: string, provider?: "4everland" | "pinata"): Promise<string> {
    return getIpcRenderer().invoke("marketplace-sync:get-gateway-url", cid, provider);
  },

  // ===========================================================================
  // PAYOUT
  // ===========================================================================

  /**
   * Verify a USDC payout transaction
   */
  async verifyPayout(transactionHash: string): Promise<PayoutVerification> {
    return getIpcRenderer().invoke("marketplace-sync:verify-payout", transactionHash);
  },

  /**
   * Get USDC balance for a wallet
   */
  async getUSDCBalance(walletAddress: string): Promise<string> {
    return getIpcRenderer().invoke("marketplace-sync:get-usdc-balance", walletAddress);
  },

  // ===========================================================================
  // NFT
  // ===========================================================================

  /**
   * Get NFT metadata
   */
  async getNFTMetadata(tokenId: number): Promise<any> {
    return getIpcRenderer().invoke("marketplace-sync:get-nft-metadata", tokenId);
  },

  /**
   * Get owned NFTs for a wallet
   */
  async getOwnedNFTs(walletAddress: string): Promise<number[]> {
    return getIpcRenderer().invoke("marketplace-sync:get-owned-nfts", walletAddress);
  },
};

export default MarketplaceSyncClient;
