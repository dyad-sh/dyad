/**
 * NFT Marketplace IPC Client
 * Renderer-side client for NFT operations
 */

import type { IpcRenderer } from "electron";
import type { Asset } from "@/types/asset_types";
import type {
  AssetChunk,
  NFTListing,
  NFTPricing,
  ChunkingConfig,
  ChunkingResult,
  NFTLicenseType,
  BlockchainNetwork,
  NFTPortfolio,
} from "@/types/nft_types";

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

export interface NFTStats {
  total_listings: number;
  listed_count: number;
  sold_count: number;
  draft_count: number;
  total_value: number;
  total_sales: number;
}

export const NFTClient = {
  /**
   * Chunk an asset into NFT-ready pieces
   */
  async chunkAsset(
    asset: Asset,
    config?: Partial<ChunkingConfig>
  ): Promise<ChunkingResult> {
    return getIpcRenderer().invoke("nft:chunk-asset", asset, config);
  },

  /**
   * Get all chunks for an asset
   */
  async getChunks(assetId: string): Promise<AssetChunk[]> {
    return getIpcRenderer().invoke("nft:get-chunks", assetId);
  },

  /**
   * Create an NFT listing for a single chunk
   */
  async createListing(params: {
    asset: Asset;
    chunk: AssetChunk;
    pricing: NFTPricing;
    license: NFTLicenseType;
    network?: BlockchainNetwork;
  }): Promise<NFTListing> {
    return getIpcRenderer().invoke("nft:create-listing", params);
  },

  /**
   * Bulk create listings for all chunks of an asset
   */
  async bulkCreateListings(params: {
    asset: Asset;
    pricing: NFTPricing;
    license: NFTLicenseType;
    network?: BlockchainNetwork;
  }): Promise<NFTListing[]> {
    return getIpcRenderer().invoke("nft:bulk-create-listings", params);
  },

  /**
   * Get all NFT listings
   */
  async getAllListings(): Promise<NFTListing[]> {
    return getIpcRenderer().invoke("nft:list-all");
  },

  /**
   * Get listings for a specific asset
   */
  async getListingsByAsset(assetId: string): Promise<NFTListing[]> {
    return getIpcRenderer().invoke("nft:list-by-asset", assetId);
  },

  /**
   * Get a single listing by ID
   */
  async getListing(listingId: string): Promise<NFTListing | null> {
    return getIpcRenderer().invoke("nft:get-listing", listingId);
  },

  /**
   * Update listing pricing
   */
  async updatePricing(
    listingId: string,
    pricing: NFTPricing
  ): Promise<NFTListing> {
    return getIpcRenderer().invoke("nft:update-pricing", listingId, pricing);
  },

  /**
   * Update listing status
   */
  async updateStatus(
    listingId: string,
    status: NFTListing["status"]
  ): Promise<NFTListing> {
    return getIpcRenderer().invoke("nft:update-status", listingId, status);
  },

  /**
   * Publish a listing to JoyMarketplace
   */
  async publish(
    listingId: string,
    apiKey: string
  ): Promise<{ success: boolean; marketplace_id?: string; error?: string }> {
    return getIpcRenderer().invoke("nft:publish", listingId, apiKey);
  },

  /**
   * Bulk publish all listings for an asset
   */
  async bulkPublish(
    assetId: string,
    apiKey: string
  ): Promise<{ listingId: string; success: boolean; error?: string }[]> {
    return getIpcRenderer().invoke("nft:bulk-publish", assetId, apiKey);
  },

  /**
   * Delete a listing
   */
  async deleteListing(listingId: string): Promise<void> {
    return getIpcRenderer().invoke("nft:delete-listing", listingId);
  },

  /**
   * Get user's NFT portfolio
   */
  async getPortfolio(): Promise<Partial<NFTPortfolio>> {
    return getIpcRenderer().invoke("nft:portfolio");
  },

  /**
   * Get NFT stats summary
   */
  async getStats(): Promise<NFTStats> {
    return getIpcRenderer().invoke("nft:stats");
  },

  /**
   * Quick list: chunk asset and create listings in one call
   */
  async quickList(params: {
    asset: Asset;
    pricing: NFTPricing;
    license: NFTLicenseType;
    network?: BlockchainNetwork;
    chunkConfig?: Partial<ChunkingConfig>;
    autoPublish?: boolean;
    apiKey?: string;
  }): Promise<{
    chunks: AssetChunk[];
    listings: NFTListing[];
    published?: boolean;
  }> {
    // Step 1: Chunk the asset
    const chunkResult = await this.chunkAsset(params.asset, params.chunkConfig);
    
    if (!chunkResult.success) {
      throw new Error(chunkResult.errors?.join(", ") || "Failed to chunk asset");
    }

    // Step 2: Create listings
    const listings = await this.bulkCreateListings({
      asset: params.asset,
      pricing: params.pricing,
      license: params.license,
      network: params.network,
    });

    // Step 3: Optionally publish
    let published = false;
    if (params.autoPublish && params.apiKey) {
      await this.bulkPublish(params.asset.id, params.apiKey);
      published = true;
    }

    return {
      chunks: chunkResult.chunks,
      listings,
      published,
    };
  },
};
