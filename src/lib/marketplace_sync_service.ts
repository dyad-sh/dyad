/**
 * JoyMarketplace Sync Service
 * Handles syncing locally created assets to joymarketplace.io
 * 
 * Assets sync to user's store_profiles + digital_assets tables
 * using the same flow as CreateAssetWizard on the web
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
  localAssetId: string;
  success: boolean;
  marketplaceAssetId?: string;
  storeAssetLinkId?: string;
  tokenId?: number;
  contractAddress?: string;
  txHash?: string;
  error?: string;
}

export interface BatchSyncResponse {
  success: boolean;
  results: SyncResult[];
  syncedCount: number;
  failedCount: number;
  storeId?: string;
  storeName?: string;
  collectionContract?: string;
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
  // Local tracking
  localAssetId: string;
  
  // Asset metadata
  name: string;
  description: string;
  category: string; // 'ai_model', 'ai_agent', 'dataset', 'prompt', etc.
  modelType?: string;
  version?: string;
  
  // IPFS/Content
  contentCid: string;
  thumbnailCid?: string;
  metadataCid?: string;
  imageCid?: string;
  
  // Chunking/Merkle data
  merkleRoot?: string;
  totalChunks?: number;
  ipldManifestCid?: string;
  
  // Pricing
  price: number;
  currency: "MATIC" | "USDC";
  royaltyPercent: number;
  
  // License
  licenseType: string;
  licenseCid?: string;
  
  // Quality
  qualityScore?: number;
  
  // Minting options
  mintOnChain?: boolean;
  
  // Additional metadata
  metadata?: Record<string, any>;
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

export interface PublisherProfile {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  website?: string;
  verified: boolean;
  totalSales: number;
  totalEarnings: number;
  joinedAt: string;
}

export interface VerifyResponse {
  success: boolean;
  publisherId?: string;
  profile?: PublisherProfile;
  error?: string;
}

// =============================================================================
// MARKETPLACE SYNC SERVICE
// =============================================================================

export class MarketplaceSyncService {
  private provider: ethers.JsonRpcProvider;
  private apiKey: string | null = null;
  private publisherId: string | null = null;
  private publisherProfile: PublisherProfile | null = null;
  private clientVersion: string = "1.0.0";
  private clientPlatform: string = process.platform;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(POLYGON_MAINNET.rpcUrl);
  }

  /**
   * Initialize the service with API credentials
   */
  async initialize(apiKey: string): Promise<VerifyResponse> {
    this.apiKey = apiKey;
    logger.info("MarketplaceSyncService initializing...");
    
    // Verify API key and get publisher info
    const verifyResult = await this.verifyPublisher();
    
    if (verifyResult.success && verifyResult.publisherId) {
      this.publisherId = verifyResult.publisherId;
      this.publisherProfile = verifyResult.profile || null;
      logger.info(`Initialized for publisher: ${this.publisherId}`);
    }
    
    return verifyResult;
  }

  /**
   * Verify publisher credentials
   */
  async verifyPublisher(): Promise<VerifyResponse> {
    try {
      const result = await this.apiRequest<VerifyResponse>(
        JOYMARKETPLACE_API.endpoints.verifyPublisher,
        { method: "POST" }
      );
      return result;
    } catch (error) {
      logger.error("Failed to verify publisher:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Verification failed",
      };
    }
  }

  /**
   * Get current publisher profile
   */
  getPublisherProfile(): PublisherProfile | null {
    return this.publisherProfile;
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
   * Sync a local listing to joymarketplace.io user's store
   * This mirrors the CreateAssetWizard flow - asset goes to:
   * 1. digital_assets table
   * 2. store_ai_assets junction (links to user's store)
   * 3. Optionally minted to user's collection contract
   */
  async syncListing(listing: AssetListing): Promise<SyncResult> {
    try {
      logger.info(`Syncing listing: ${listing.name}`);

      const result = await this.apiRequest<BatchSyncResponse>(
        JOYMARKETPLACE_API.endpoints.syncListing,
        {
          method: "POST",
          body: JSON.stringify({
            listings: [listing],
            clientVersion: this.clientVersion,
            clientPlatform: this.clientPlatform,
          }),
        }
      );

      if (result.results && result.results.length > 0) {
        const syncResult = result.results[0];
        logger.info(`Listing synced: ${syncResult.marketplaceAssetId} to store: ${result.storeName}`);
        return syncResult;
      }

      return {
        localAssetId: listing.localAssetId,
        success: false,
        error: "No result returned",
      };
    } catch (error) {
      logger.error(`Failed to sync listing:`, error);
      return {
        localAssetId: listing.localAssetId,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Batch sync multiple listings to user's store
   */
  async batchSyncListings(listings: AssetListing[]): Promise<BatchSyncResponse> {
    try {
      logger.info(`Batch syncing ${listings.length} listings`);

      const result = await this.apiRequest<BatchSyncResponse>(
        JOYMARKETPLACE_API.endpoints.syncListing,
        {
          method: "POST",
          body: JSON.stringify({
            listings,
            clientVersion: this.clientVersion,
            clientPlatform: this.clientPlatform,
          }),
        }
      );

      logger.info(`Batch sync completed: ${result.syncedCount}/${listings.length} to store: ${result.storeName}`);
      
      if (result.collectionContract) {
        logger.info(`Collection contract: ${result.collectionContract}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to batch sync listings:`, error);
      return {
        success: false,
        results: listings.map(l => ({
          localAssetId: l.localAssetId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })),
        syncedCount: 0,
        failedCount: listings.length,
      };
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
