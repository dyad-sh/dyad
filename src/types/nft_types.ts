/**
 * NFT Marketplace Types
 * Chunking, tokenization, and NFT listing for JoyMarketplace
 */

import type { AssetType } from "./asset_types";

// NFT Standards
export type NFTStandard = "ERC-721" | "ERC-1155" | "SPL" | "JOY-NFT";

// Chain types for multi-chain support
export type BlockchainNetwork = 
  | "ethereum" 
  | "polygon" 
  | "base" 
  | "arbitrum" 
  | "solana" 
  | "joy-chain";

// License types for NFTs
export type NFTLicenseType = 
  | "full-ownership"      // Complete transfer of rights
  | "commercial-use"      // Can use commercially
  | "personal-use"        // Personal use only
  | "derivative-allowed"  // Can create derivatives
  | "view-only"           // Can only view/access
  | "limited-uses"        // Pay per use
  | "time-limited"        // Access for limited time
  | "subscription";       // Recurring payment

// Chunk types for different asset categories
export type ChunkType = 
  | "data-slice"          // Dataset rows/segments
  | "model-layer"         // Model weights/layers
  | "code-module"         // Code functions/modules
  | "prompt-segment"      // Prompt parts
  | "ui-component"        // UI pieces
  | "workflow-step"       // Workflow nodes
  | "embedding-vector"    // Vector chunks
  | "training-batch";     // Training data batches

// NFT Metadata Standard
export interface NFTMetadata {
  name: string;
  description: string;
  image: string;                    // IPFS or URL to preview image
  external_url?: string;            // Link to JoyMarketplace listing
  animation_url?: string;           // For interactive previews
  attributes: NFTAttribute[];
  properties: {
    category: AssetType;
    chunk_info?: ChunkInfo;
    license: NFTLicenseType;
    creator: string;
    created_at: string;
    version: string;
    files: NFTFile[];
  };
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
  display_type?: "number" | "boost_number" | "boost_percentage" | "date";
}

export interface NFTFile {
  uri: string;
  type: string;
  size: number;
  checksum: string;
}

// Chunk information
export interface ChunkInfo {
  type: ChunkType;
  index: number;
  total: number;
  parent_asset_id: string;
  dependencies?: string[];         // Other chunks needed
  size_bytes: number;
  rows?: number;                   // For datasets
  tokens?: number;                 // For text/prompts
  parameters?: number;             // For models
}

// Asset Chunk
export interface AssetChunk {
  id: string;
  asset_id: string;
  asset_type: AssetType;
  chunk_type: ChunkType;
  index: number;
  total_chunks: number;
  
  // Content
  content_hash: string;            // SHA-256 of content
  content_path: string;            // Local file path
  ipfs_cid?: string;               // IPFS content ID
  arweave_id?: string;             // Arweave transaction ID
  
  // Metadata
  size_bytes: number;
  preview?: string;                // Preview/sample of content
  schema?: Record<string, any>;    // Schema for data chunks
  
  // NFT Info
  nft_id?: string;
  token_id?: string;
  contract_address?: string;
  
  created_at: string;
}

// NFT Listing
export interface NFTListing {
  id: string;
  chunk_id: string;
  asset_id: string;
  
  // NFT Details
  token_id?: string;
  contract_address?: string;
  network: BlockchainNetwork;
  standard: NFTStandard;
  
  // Metadata
  metadata: NFTMetadata;
  metadata_uri?: string;           // IPFS URI for metadata
  
  // Pricing
  pricing: NFTPricing;
  
  // Status
  status: "draft" | "pending" | "listed" | "sold" | "delisted";
  
  // Stats
  views: number;
  favorites: number;
  offers: NFTOffer[];
  
  // Ownership
  creator: string;
  owner: string;
  royalty_percentage: number;      // Creator royalty on resales
  
  created_at: string;
  listed_at?: string;
  sold_at?: string;
}

// Pricing options
export interface NFTPricing {
  type: "fixed" | "auction" | "pay-per-use" | "subscription";
  
  // Fixed price
  price?: number;
  currency?: string;               // USD, ETH, SOL, JOY
  
  // Auction
  starting_price?: number;
  reserve_price?: number;
  auction_end?: string;
  
  // Pay per use
  price_per_use?: number;
  min_uses?: number;
  max_uses?: number;
  
  // Subscription
  monthly_price?: number;
  yearly_price?: number;
  subscription_period?: "daily" | "weekly" | "monthly" | "yearly";
  
  // Discounts
  bulk_discount?: {
    min_quantity: number;
    discount_percentage: number;
  }[];
}

// NFT Offer
export interface NFTOffer {
  id: string;
  listing_id: string;
  bidder: string;
  amount: number;
  currency: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
}

// NFT Transaction
export interface NFTTransaction {
  id: string;
  listing_id: string;
  chunk_id: string;
  
  type: "mint" | "list" | "buy" | "transfer" | "burn" | "royalty";
  
  from: string;
  to: string;
  amount: number;
  currency: string;
  
  tx_hash?: string;
  network: BlockchainNetwork;
  status: "pending" | "confirmed" | "failed";
  
  gas_fee?: number;
  platform_fee?: number;
  royalty_amount?: number;
  
  created_at: string;
  confirmed_at?: string;
}

// Chunking Configuration
export interface ChunkingConfig {
  asset_type: AssetType;
  
  // Size limits
  max_chunk_size_bytes: number;
  min_chunk_size_bytes: number;
  
  // Dataset specific
  rows_per_chunk?: number;
  preserve_schema?: boolean;
  
  // Model specific
  layers_per_chunk?: number;
  include_config?: boolean;
  
  // Code specific
  functions_per_chunk?: number;
  preserve_imports?: boolean;
  
  // Text specific
  tokens_per_chunk?: number;
  overlap_tokens?: number;
  
  // General
  create_preview?: boolean;
  preview_size?: number;
  compute_checksums?: boolean;
}

// Chunking Result
export interface ChunkingResult {
  success: boolean;
  asset_id: string;
  total_chunks: number;
  chunks: AssetChunk[];
  original_size: number;
  chunked_size: number;
  errors?: string[];
}

// NFT Collection
export interface NFTCollection {
  id: string;
  name: string;
  description: string;
  image: string;
  banner?: string;
  
  creator: string;
  network: BlockchainNetwork;
  contract_address?: string;
  
  // Collection stats
  total_items: number;
  total_owners: number;
  floor_price?: number;
  volume_traded: number;
  
  // Royalties
  royalty_percentage: number;
  royalty_recipient: string;
  
  // Categories
  categories: AssetType[];
  tags: string[];
  
  // Listings in collection
  listings: string[];             // Listing IDs
  
  created_at: string;
  updated_at: string;
}

// User NFT Portfolio
export interface NFTPortfolio {
  user_id: string;
  
  // Owned NFTs
  owned: {
    listing_id: string;
    acquired_at: string;
    acquisition_price: number;
    current_value?: number;
  }[];
  
  // Created NFTs
  created: {
    listing_id: string;
    total_sales: number;
    total_royalties: number;
  }[];
  
  // Usage licenses
  licenses: {
    listing_id: string;
    license_type: NFTLicenseType;
    uses_remaining?: number;
    expires_at?: string;
  }[];
  
  // Stats
  total_value: number;
  total_earnings: number;
  total_spent: number;
}

// Marketplace Analytics
export interface NFTAnalytics {
  period: "24h" | "7d" | "30d" | "all";
  
  // Volume
  total_volume: number;
  volume_change: number;
  
  // Sales
  total_sales: number;
  average_price: number;
  
  // Users
  unique_buyers: number;
  unique_sellers: number;
  
  // Top categories
  top_categories: {
    category: AssetType;
    volume: number;
    sales: number;
  }[];
  
  // Top listings
  top_listings: {
    listing_id: string;
    name: string;
    volume: number;
  }[];
  
  // Price trends
  price_history: {
    timestamp: string;
    average_price: number;
    volume: number;
  }[];
}

// Default chunking configs by asset type
export const DEFAULT_CHUNKING_CONFIGS: Record<AssetType, Partial<ChunkingConfig>> = {
  "dataset": {
    max_chunk_size_bytes: 10 * 1024 * 1024, // 10MB
    rows_per_chunk: 10000,
    preserve_schema: true,
    create_preview: true,
    preview_size: 100,
  },
  "model": {
    max_chunk_size_bytes: 100 * 1024 * 1024, // 100MB
    layers_per_chunk: 10,
    include_config: true,
    create_preview: false,
  },
  "algorithm": {
    max_chunk_size_bytes: 1 * 1024 * 1024, // 1MB
    functions_per_chunk: 5,
    preserve_imports: true,
    create_preview: true,
    preview_size: 500,
  },
  "schema": {
    max_chunk_size_bytes: 512 * 1024, // 512KB
    create_preview: true,
    preview_size: 1000,
  },
  "agent": {
    max_chunk_size_bytes: 5 * 1024 * 1024, // 5MB
    create_preview: true,
  },
  "ui-component": {
    max_chunk_size_bytes: 2 * 1024 * 1024, // 2MB
    create_preview: true,
  },
  "template": {
    max_chunk_size_bytes: 50 * 1024 * 1024, // 50MB
    create_preview: true,
  },
  "workflow": {
    max_chunk_size_bytes: 5 * 1024 * 1024, // 5MB
    create_preview: true,
  },
  "prompt": {
    max_chunk_size_bytes: 100 * 1024, // 100KB
    tokens_per_chunk: 2000,
    overlap_tokens: 100,
    create_preview: true,
    preview_size: 500,
  },
  "api": {
    max_chunk_size_bytes: 1 * 1024 * 1024, // 1MB
    create_preview: true,
  },
  "plugin": {
    max_chunk_size_bytes: 10 * 1024 * 1024, // 10MB
    create_preview: false,
  },
  "training-data": {
    max_chunk_size_bytes: 50 * 1024 * 1024, // 50MB
    rows_per_chunk: 5000,
    preserve_schema: true,
    create_preview: true,
    preview_size: 50,
  },
  "embedding": {
    max_chunk_size_bytes: 100 * 1024 * 1024, // 100MB
    create_preview: false,
  },
};
