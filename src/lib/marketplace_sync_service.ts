/**
 * JoyMarketplace Sync Service
 * Handles syncing locally created assets to joymarketplace.io
 */

import { ethers } from "ethers";
import log from "electron-log";
import {
  CONTRACT_ADDRESSES,
  CONTRACT_ABIS,
  JOYMARKETPLACE_API,
  POLYGON_MAINNET,
  FIELD_MAPPING,
  PAYOUT_CONFIG,
  buildApiUrl,
} from "@/config/joymarketplace";
import type { NFTListing, NFTMetadata } from "@/types/nft_types";
import type { IpldInferenceReceipt } from "@/types/ipld_receipt";

const logger = log.scope("marketplace_sync");

// =============================================================================
// TYPES
// =============================================================================

export interface SyncResult {
  success: boolean;
  assetId?: string;
  listingId?: string;
  transactionHash?: string;
  error?: string;
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

export interface PayoutRequest {
  amount: number;
  recipientWallet: string;
  currency: "USDC";
  memo?: string;
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
// MARKETPLACE SYNC SERVICE
// =============================================================================

export class MarketplaceSyncService {
  private provider: ethers.JsonRpcProvider;
  private apiKey: string | null = null;
  private publisherId: string | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(POLYGON_MAINNET.rpcUrl);
  }

  /**
   * Initialize the service with API credentials
   */
  async initialize(apiKey: string, publisherId: string): Promise<void> {
    this.apiKey = apiKey;
    this.publisherId = publisherId;
    logger.info("MarketplaceSyncService initialized");
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("API key not set. Call initialize() first.");
    }

    const url = buildApiUrl(endpoint);
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `${JOYMARKETPLACE_API.authScheme} ${this.apiKey}`,
        "X-Publisher-ID": this.publisherId || "",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // ===========================================================================
  // DOMAIN / STORE FUNCTIONS
  // ===========================================================================

  /**
   * Get store info from a .joy domain
   */
  async getStoreFromDomain(domainName: string): Promise<StoreInfo | null> {
    try {
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.JOY_DOMAIN_REGISTRY,
        CONTRACT_ABIS.JOY_DOMAIN_REGISTRY,
        this.provider
      );

      const [owner, expiresAt, pouScore, isActive, salePrice, isForSale] = 
        await contract.getDomainInfo(domainName);

      if (!isActive || owner === ethers.ZeroAddress) {
        return null;
      }

      // Fetch metadata from domain's metadata URI if available
      // This would typically be stored on IPFS
      return {
        storeName: domainName,
        creatorId: owner,
        creatorWallet: owner,
        payoutWallet: owner, // Default to domain owner
      };
    } catch (error) {
      logger.error(`Failed to get store from domain ${domainName}:`, error);
      return null;
    }
  }

  /**
   * Verify domain ownership
   */
  async verifyDomainOwnership(
    domainName: string,
    walletAddress: string
  ): Promise<boolean> {
    try {
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.JOY_DOMAIN_REGISTRY,
        CONTRACT_ABIS.JOY_DOMAIN_REGISTRY,
        this.provider
      );

      const owner = await contract.getOwner(domainName);
      return owner.toLowerCase() === walletAddress.toLowerCase();
    } catch (error) {
      logger.error(`Failed to verify domain ownership:`, error);
      return false;
    }
  }

  // ===========================================================================
  // LISTING SYNC FUNCTIONS
  // ===========================================================================

  /**
   * Sync a local listing to joymarketplace.io
   */
  async syncListing(listing: AssetListing): Promise<SyncResult> {
    try {
      logger.info(`Syncing listing: ${listing.name}`);

      // Map local fields to marketplace fields
      const payload = {
        // Asset identification
        localId: listing.localId,
        
        // Mapped fields from FIELD_MAPPING.nft
        assetName: listing.name,
        assetDescription: listing.description,
        category: listing.category,
        thumbnailUrl: listing.thumbnailCid 
          ? `https://gateway.pinata.cloud/ipfs/${listing.thumbnailCid}`
          : undefined,
        metadataUri: listing.metadataCid
          ? `ipfs://${listing.metadataCid}`
          : undefined,
        contentCid: listing.contentCid,
        
        // Pricing
        price: listing.price,
        currency: listing.currency,
        
        // Licensing
        licenseType: listing.licenseType,
        royaltyBps: listing.royaltyBps,
        
        // Store mapping from FIELD_MAPPING.domain
        storeName: listing.store.storeName,
        creatorId: listing.store.creatorId,
        creatorWallet: listing.store.creatorWallet,
        payoutWallet: listing.store.payoutWallet,
        storeLogo: listing.store.logo,
        storeDescription: listing.store.bio,
        storeBanner: listing.store.banner,
      };

      const result = await this.apiRequest<SyncResult>(
        JOYMARKETPLACE_API.endpoints.syncListing,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      logger.info(`Listing synced successfully: ${result.listingId}`);
      return result;
    } catch (error) {
      logger.error(`Failed to sync listing:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Batch sync multiple listings
   */
  async batchSyncListings(listings: AssetListing[]): Promise<SyncResult[]> {
    try {
      logger.info(`Batch syncing ${listings.length} listings`);

      const payload = listings.map(listing => ({
        localId: listing.localId,
        assetName: listing.name,
        assetDescription: listing.description,
        category: listing.category,
        thumbnailUrl: listing.thumbnailCid 
          ? `https://gateway.pinata.cloud/ipfs/${listing.thumbnailCid}`
          : undefined,
        metadataUri: listing.metadataCid
          ? `ipfs://${listing.metadataCid}`
          : undefined,
        contentCid: listing.contentCid,
        price: listing.price,
        currency: listing.currency,
        licenseType: listing.licenseType,
        royaltyBps: listing.royaltyBps,
        storeName: listing.store.storeName,
        creatorId: listing.store.creatorId,
        creatorWallet: listing.store.creatorWallet,
        payoutWallet: listing.store.payoutWallet,
      }));

      const results = await this.apiRequest<SyncResult[]>(
        JOYMARKETPLACE_API.endpoints.batchSyncListings,
        {
          method: "POST",
          body: JSON.stringify({ listings: payload }),
        }
      );

      logger.info(`Batch sync completed: ${results.filter(r => r.success).length}/${results.length} successful`);
      return results;
    } catch (error) {
      logger.error(`Failed to batch sync listings:`, error);
      return listings.map(() => ({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  }

  // ===========================================================================
  // RECEIPT FUNCTIONS
  // ===========================================================================

  /**
   * Submit an IPLD receipt to the marketplace
   */
  async ingestReceipt(
    receipt: IpldInferenceReceipt,
    cid: string
  ): Promise<SyncResult> {
    try {
      logger.info(`Ingesting receipt: ${cid}`);

      // Map receipt fields to transaction using FIELD_MAPPING.receipt
      const payload = {
        cid,
        receipt: {
          // Core receipt data
          version: receipt.v,
          type: receipt.type,
          timestamp: receipt.ts,
          
          // Mapped fields
          sellerId: receipt.issuer,
          buyerId: receipt.payer,
          assetId: receipt.model.id,
          modelHash: receipt.model.hash,
          
          // Store info
          storeName: receipt.store?.name,
          creatorId: receipt.store?.creatorId,
          
          // Payment info
          chain: receipt.payment.chain,
          currency: receipt.payment.currency,
          transactionHash: receipt.payment.tx,
          amount: receipt.payment.amount,
          
          // Signature
          signature: receipt.sig,
        },
      };

      const result = await this.apiRequest<SyncResult>(
        JOYMARKETPLACE_API.endpoints.ingestReceipt,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      logger.info(`Receipt ingested successfully`);
      return result;
    } catch (error) {
      logger.error(`Failed to ingest receipt:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Verify a receipt CID exists on the marketplace
   */
  async verifyReceipt(cid: string): Promise<{ verified: boolean; receipt?: IpldInferenceReceipt }> {
    try {
      const result = await this.apiRequest<{ verified: boolean; receipt?: IpldInferenceReceipt }>(
        JOYMARKETPLACE_API.endpoints.verifyReceipt.replace(":cid", cid),
        { method: "GET" }
      );
      return result;
    } catch (error) {
      logger.error(`Failed to verify receipt:`, error);
      return { verified: false };
    }
  }

  // ===========================================================================
  // PAYOUT FUNCTIONS
  // ===========================================================================

  /**
   * Verify a USDC payout transaction
   */
  async verifyPayout(transactionHash: string): Promise<PayoutVerification> {
    try {
      const tx = await this.provider.getTransaction(transactionHash);
      if (!tx) {
        return { verified: false, error: "Transaction not found" };
      }

      const receipt = await tx.wait(PAYOUT_CONFIG.confirmations);
      if (!receipt || receipt.status !== 1) {
        return { verified: false, error: "Transaction failed or not confirmed" };
      }

      // Parse USDC transfer logs
      const usdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.USDC_POLYGON,
        CONTRACT_ABIS.USDC,
        this.provider
      );

      const transferEvents = receipt.logs
        .filter(log => log.address.toLowerCase() === CONTRACT_ADDRESSES.USDC_POLYGON.toLowerCase())
        .map(log => {
          try {
            return usdcContract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (transferEvents.length === 0) {
        return { verified: false, error: "No USDC transfer found in transaction" };
      }

      const transferEvent = transferEvents[0];
      const block = await this.provider.getBlock(receipt.blockNumber);

      return {
        verified: true,
        transactionHash,
        amount: ethers.formatUnits(transferEvent?.args?.value || 0, 6),
        timestamp: block?.timestamp,
        confirmations: await this.provider.getBlockNumber() - receipt.blockNumber,
      };
    } catch (error) {
      logger.error(`Failed to verify payout:`, error);
      return {
        verified: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get USDC balance for a wallet
   */
  async getUSDCBalance(walletAddress: string): Promise<string> {
    try {
      const usdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.USDC_POLYGON,
        CONTRACT_ABIS.USDC,
        this.provider
      );

      const balance = await usdcContract.balanceOf(walletAddress);
      return ethers.formatUnits(balance, 6);
    } catch (error) {
      logger.error(`Failed to get USDC balance:`, error);
      return "0";
    }
  }

  // ===========================================================================
  // NFT FUNCTIONS
  // ===========================================================================

  /**
   * Get NFT metadata from token URI
   */
  async getNFTMetadata(tokenId: number): Promise<NFTMetadata | null> {
    try {
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.JOY_ASSET_NFT,
        CONTRACT_ABIS.JOY_ASSET_NFT,
        this.provider
      );

      const tokenURI = await contract.tokenURI(tokenId);
      const owner = await contract.ownerOf(tokenId);

      // Fetch metadata from IPFS if needed
      let metadata: NFTMetadata | null = null;
      if (tokenURI.startsWith("ipfs://")) {
        const cid = tokenURI.replace("ipfs://", "");
        const response = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
        if (response.ok) {
          metadata = await response.json();
        }
      } else if (tokenURI.startsWith("http")) {
        const response = await fetch(tokenURI);
        if (response.ok) {
          metadata = await response.json();
        }
      }

      return metadata;
    } catch (error) {
      logger.error(`Failed to get NFT metadata:`, error);
      return null;
    }
  }

  /**
   * Get owned NFTs for a wallet
   */
  async getOwnedNFTs(walletAddress: string): Promise<number[]> {
    try {
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.JOY_ASSET_NFT,
        CONTRACT_ABIS.JOY_ASSET_NFT,
        this.provider
      );

      const balance = await contract.balanceOf(walletAddress);
      // Note: This is a simplified version. In production, you'd use events
      // or an indexer to get all token IDs
      return [];
    } catch (error) {
      logger.error(`Failed to get owned NFTs:`, error);
      return [];
    }
  }
}

// Export singleton instance
export const marketplaceSyncService = new MarketplaceSyncService();
export default marketplaceSyncService;
