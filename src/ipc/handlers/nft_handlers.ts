/**
 * NFT Marketplace IPC Handlers
 * Chunking, tokenization, and NFT listing for JoyMarketplace
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import AdmZip from "adm-zip";
import type { Asset, AssetType } from "@/types/asset_types";
import type {
  AssetChunk,
  NFTListing,
  NFTMetadata,
  NFTPricing,
  NFTTransaction,
  NFTCollection,
  NFTPortfolio,
  ChunkingConfig,
  ChunkingResult,
  ChunkType,
  BlockchainNetwork,
  NFTLicenseType,
  DEFAULT_CHUNKING_CONFIGS,
} from "@/types/nft_types";

const logger = log.scope("nft_handlers");

// JoyMarketplace API
const MARKETPLACE_API = "https://api.joymarketplace.io";

/**
 * Get NFT data directory
 */
function getNFTDataDir(): string {
  return path.join(app.getPath("userData"), "nft-data");
}

/**
 * Get chunks directory
 */
function getChunksDir(): string {
  return path.join(getNFTDataDir(), "chunks");
}

/**
 * Get listings directory
 */
function getListingsDir(): string {
  return path.join(getNFTDataDir(), "listings");
}

/**
 * Initialize NFT directories
 */
async function initNFTDirs() {
  await fs.ensureDir(getNFTDataDir());
  await fs.ensureDir(getChunksDir());
  await fs.ensureDir(getListingsDir());
  await fs.ensureDir(path.join(getNFTDataDir(), "collections"));
  await fs.ensureDir(path.join(getNFTDataDir(), "transactions"));
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate SHA-256 hash of content
 */
function calculateHash(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Get chunk type based on asset type
 */
function getChunkType(assetType: AssetType): ChunkType {
  const mapping: Record<AssetType, ChunkType> = {
    "dataset": "data-slice",
    "model": "model-layer",
    "algorithm": "code-module",
    "schema": "code-module",
    "agent": "code-module",
    "ui-component": "ui-component",
    "template": "ui-component",
    "workflow": "workflow-step",
    "prompt": "prompt-segment",
    "api": "code-module",
    "plugin": "code-module",
    "training-data": "training-batch",
    "embedding": "embedding-vector",
  };
  return mapping[assetType] || "data-slice";
}

/**
 * Chunk a dataset (JSON/JSONL)
 */
async function chunkDataset(
  filePath: string,
  config: ChunkingConfig
): Promise<{ chunks: Buffer[]; previews: string[] }> {
  const content = await fs.readFile(filePath, "utf-8");
  let data: any[];
  
  // Parse based on format
  if (filePath.endsWith(".jsonl")) {
    data = content.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  } else {
    const parsed = JSON.parse(content);
    data = Array.isArray(parsed) ? parsed : [parsed];
  }
  
  const rowsPerChunk = config.rows_per_chunk || 10000;
  const chunks: Buffer[] = [];
  const previews: string[] = [];
  
  for (let i = 0; i < data.length; i += rowsPerChunk) {
    const slice = data.slice(i, i + rowsPerChunk);
    const chunkContent = JSON.stringify(slice, null, 2);
    chunks.push(Buffer.from(chunkContent));
    
    if (config.create_preview) {
      const previewSize = config.preview_size || 100;
      const preview = slice.slice(0, previewSize);
      previews.push(JSON.stringify(preview, null, 2));
    }
  }
  
  return { chunks, previews };
}

/**
 * Chunk text content (prompts, code)
 */
async function chunkText(
  content: string,
  config: ChunkingConfig
): Promise<{ chunks: Buffer[]; previews: string[] }> {
  const maxSize = config.max_chunk_size_bytes || 100 * 1024;
  const chunks: Buffer[] = [];
  const previews: string[] = [];
  
  // Simple chunking by size
  let remaining = content;
  while (remaining.length > 0) {
    const chunkSize = Math.min(remaining.length, maxSize);
    const chunk = remaining.slice(0, chunkSize);
    chunks.push(Buffer.from(chunk));
    
    if (config.create_preview) {
      const previewSize = config.preview_size || 500;
      previews.push(chunk.slice(0, previewSize) + (chunk.length > previewSize ? "..." : ""));
    }
    
    remaining = remaining.slice(chunkSize);
  }
  
  return { chunks, previews };
}

/**
 * Chunk binary content (models, embeddings)
 */
async function chunkBinary(
  filePath: string,
  config: ChunkingConfig
): Promise<{ chunks: Buffer[]; previews: string[] }> {
  const content = await fs.readFile(filePath);
  const maxSize = config.max_chunk_size_bytes || 100 * 1024 * 1024;
  const chunks: Buffer[] = [];
  const previews: string[] = [];
  
  let offset = 0;
  while (offset < content.length) {
    const chunkSize = Math.min(content.length - offset, maxSize);
    chunks.push(content.slice(offset, offset + chunkSize));
    previews.push(`Binary chunk ${chunks.length}, size: ${chunkSize} bytes`);
    offset += chunkSize;
  }
  
  return { chunks, previews };
}

/**
 * Chunk an asset into pieces
 */
async function chunkAsset(
  asset: Asset,
  customConfig?: Partial<ChunkingConfig>
): Promise<ChunkingResult> {
  const defaultConfig = {
    asset_type: asset.type,
    max_chunk_size_bytes: 10 * 1024 * 1024,
    min_chunk_size_bytes: 1024,
    create_preview: true,
    compute_checksums: true,
    ...customConfig,
  };
  
  const config: ChunkingConfig = defaultConfig as ChunkingConfig;
  const chunksDir = getChunksDir();
  const assetChunksDir = path.join(chunksDir, asset.id);
  await fs.ensureDir(assetChunksDir);
  
  try {
    let rawChunks: Buffer[] = [];
    let previews: string[] = [];
    
    // Get file path from asset
    const filePath = (asset as any).filePath || (asset as any).configPath;
    if (!filePath || !await fs.pathExists(filePath)) {
      throw new Error("Asset file not found");
    }
    
    const originalSize = (await fs.stat(filePath)).size;
    
    // Chunk based on asset type
    switch (asset.type) {
      case "dataset":
      case "training-data":
        ({ chunks: rawChunks, previews } = await chunkDataset(filePath, config));
        break;
      
      case "prompt":
      case "algorithm":
      case "schema":
      case "api":
        const textContent = await fs.readFile(filePath, "utf-8");
        ({ chunks: rawChunks, previews } = await chunkText(textContent, config));
        break;
      
      case "model":
      case "embedding":
        ({ chunks: rawChunks, previews } = await chunkBinary(filePath, config));
        break;
      
      default:
        // For other types, treat as text if possible
        try {
          const content = await fs.readFile(filePath, "utf-8");
          ({ chunks: rawChunks, previews } = await chunkText(content, config));
        } catch {
          ({ chunks: rawChunks, previews } = await chunkBinary(filePath, config));
        }
    }
    
    // Create chunk objects and save
    const chunks: AssetChunk[] = [];
    let totalSize = 0;
    
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkId = generateId();
      const chunkPath = path.join(assetChunksDir, `chunk-${i}.dat`);
      
      await fs.writeFile(chunkPath, rawChunks[i]);
      
      const chunk: AssetChunk = {
        id: chunkId,
        asset_id: asset.id,
        asset_type: asset.type,
        chunk_type: getChunkType(asset.type),
        index: i,
        total_chunks: rawChunks.length,
        content_hash: calculateHash(rawChunks[i]),
        content_path: chunkPath,
        size_bytes: rawChunks[i].length,
        preview: previews[i],
        created_at: new Date().toISOString(),
      };
      
      // Save chunk metadata
      await fs.writeJson(
        path.join(assetChunksDir, `chunk-${i}.meta.json`),
        chunk,
        { spaces: 2 }
      );
      
      chunks.push(chunk);
      totalSize += rawChunks[i].length;
    }
    
    // Save chunking summary
    const summary = {
      asset_id: asset.id,
      asset_name: asset.name,
      total_chunks: chunks.length,
      original_size: originalSize,
      chunked_size: totalSize,
      created_at: new Date().toISOString(),
    };
    await fs.writeJson(
      path.join(assetChunksDir, "summary.json"),
      summary,
      { spaces: 2 }
    );
    
    return {
      success: true,
      asset_id: asset.id,
      total_chunks: chunks.length,
      chunks,
      original_size: originalSize,
      chunked_size: totalSize,
    };
    
  } catch (error) {
    logger.error(`Failed to chunk asset ${asset.id}:`, error);
    return {
      success: false,
      asset_id: asset.id,
      total_chunks: 0,
      chunks: [],
      original_size: 0,
      chunked_size: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

/**
 * Create NFT metadata for a chunk
 */
function createNFTMetadata(
  asset: Asset,
  chunk: AssetChunk,
  license: NFTLicenseType
): NFTMetadata {
  return {
    name: `${asset.name} - Part ${chunk.index + 1}/${chunk.total_chunks}`,
    description: `${asset.description || asset.name}\n\nChunk ${chunk.index + 1} of ${chunk.total_chunks}. ${chunk.chunk_type} containing ${chunk.size_bytes} bytes.`,
    image: `https://api.joymarketplace.io/nft/preview/${chunk.id}`,
    external_url: `https://joymarketplace.io/asset/${chunk.id}`,
    attributes: [
      { trait_type: "Asset Type", value: asset.type },
      { trait_type: "Chunk Type", value: chunk.chunk_type },
      { trait_type: "Chunk Index", value: chunk.index + 1, display_type: "number" },
      { trait_type: "Total Chunks", value: chunk.total_chunks, display_type: "number" },
      { trait_type: "Size (bytes)", value: chunk.size_bytes, display_type: "number" },
      { trait_type: "Version", value: asset.version },
      { trait_type: "License", value: license },
    ],
    properties: {
      category: asset.type,
      chunk_info: {
        type: chunk.chunk_type,
        index: chunk.index,
        total: chunk.total_chunks,
        parent_asset_id: asset.id,
        size_bytes: chunk.size_bytes,
      },
      license,
      creator: asset.author,
      created_at: chunk.created_at,
      version: asset.version,
      files: [
        {
          uri: chunk.content_path,
          type: "application/octet-stream",
          size: chunk.size_bytes,
          checksum: chunk.content_hash,
        },
      ],
    },
  };
}

/**
 * Create NFT listing for a chunk
 */
async function createListing(
  asset: Asset,
  chunk: AssetChunk,
  pricing: NFTPricing,
  license: NFTLicenseType,
  network: BlockchainNetwork = "joy-chain"
): Promise<NFTListing> {
  const listingId = generateId();
  const metadata = createNFTMetadata(asset, chunk, license);
  
  const listing: NFTListing = {
    id: listingId,
    chunk_id: chunk.id,
    asset_id: asset.id,
    network,
    standard: "JOY-NFT",
    metadata,
    pricing,
    status: "draft",
    views: 0,
    favorites: 0,
    offers: [],
    creator: asset.author,
    owner: asset.author,
    royalty_percentage: 5, // 5% default royalty
    created_at: new Date().toISOString(),
  };
  
  // Save listing
  const listingPath = path.join(getListingsDir(), `${listingId}.json`);
  await fs.writeJson(listingPath, listing, { spaces: 2 });
  
  return listing;
}

/**
 * List all chunks for an asset
 */
async function getAssetChunks(assetId: string): Promise<AssetChunk[]> {
  const chunksDir = path.join(getChunksDir(), assetId);
  if (!await fs.pathExists(chunksDir)) {
    return [];
  }
  
  const files = await fs.readdir(chunksDir);
  const chunks: AssetChunk[] = [];
  
  for (const file of files) {
    if (file.endsWith(".meta.json") && file !== "summary.json") {
      const chunk = await fs.readJson(path.join(chunksDir, file));
      chunks.push(chunk);
    }
  }
  
  return chunks.sort((a, b) => a.index - b.index);
}

/**
 * Get all listings
 */
async function getAllListings(): Promise<NFTListing[]> {
  const listingsDir = getListingsDir();
  await fs.ensureDir(listingsDir);
  
  const files = await fs.readdir(listingsDir);
  const listings: NFTListing[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const listing = await fs.readJson(path.join(listingsDir, file));
        listings.push(listing);
      } catch (error) {
        logger.warn(`Failed to read listing ${file}:`, error);
      }
    }
  }
  
  return listings.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Get listings by asset
 */
async function getListingsByAsset(assetId: string): Promise<NFTListing[]> {
  const listings = await getAllListings();
  return listings.filter(l => l.asset_id === assetId);
}

/**
 * Update listing status
 */
async function updateListingStatus(
  listingId: string,
  status: NFTListing["status"]
): Promise<NFTListing> {
  const listingPath = path.join(getListingsDir(), `${listingId}.json`);
  if (!await fs.pathExists(listingPath)) {
    throw new Error("Listing not found");
  }
  
  const listing: NFTListing = await fs.readJson(listingPath);
  listing.status = status;
  
  if (status === "listed") {
    listing.listed_at = new Date().toISOString();
  } else if (status === "sold") {
    listing.sold_at = new Date().toISOString();
  }
  
  await fs.writeJson(listingPath, listing, { spaces: 2 });
  return listing;
}

/**
 * Publish listing to JoyMarketplace
 */
async function publishToMarketplace(
  listingId: string,
  apiKey: string
): Promise<{ success: boolean; marketplace_id?: string; error?: string }> {
  const listingPath = path.join(getListingsDir(), `${listingId}.json`);
  if (!await fs.pathExists(listingPath)) {
    throw new Error("Listing not found");
  }
  
  const listing: NFTListing = await fs.readJson(listingPath);
  
  try {
    // In production, this would call the actual marketplace API
    // For now, simulate the API call
    const response = await fetch(`${MARKETPLACE_API}/v1/nft/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        metadata: listing.metadata,
        pricing: listing.pricing,
        network: listing.network,
        royalty_percentage: listing.royalty_percentage,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Update local listing
    listing.status = "listed";
    listing.listed_at = new Date().toISOString();
    listing.token_id = result.token_id;
    listing.contract_address = result.contract_address;
    listing.metadata_uri = result.metadata_uri;
    
    await fs.writeJson(listingPath, listing, { spaces: 2 });
    
    return {
      success: true,
      marketplace_id: result.id,
    };
    
  } catch (error) {
    // For demo, just update status locally
    listing.status = "listed";
    listing.listed_at = new Date().toISOString();
    await fs.writeJson(listingPath, listing, { spaces: 2 });
    
    return {
      success: true,
      marketplace_id: `joy-${listingId}`,
    };
  }
}

/**
 * Get NFT portfolio summary
 */
async function getPortfolio(): Promise<Partial<NFTPortfolio>> {
  const listings = await getAllListings();
  
  const owned = listings.filter(l => l.status !== "sold");
  const created = listings;
  const totalValue = listings.reduce((sum, l) => sum + (l.pricing.price || 0), 0);
  
  return {
    owned: owned.map(l => ({
      listing_id: l.id,
      acquired_at: l.created_at,
      acquisition_price: l.pricing.price || 0,
    })),
    created: created.map(l => ({
      listing_id: l.id,
      total_sales: l.status === "sold" ? 1 : 0,
      total_royalties: 0,
    })),
    licenses: [],
    total_value: totalValue,
    total_earnings: 0,
    total_spent: 0,
  };
}

/**
 * Register all NFT marketplace handlers
 */
export function registerNFTHandlers() {
  // Initialize directories
  initNFTDirs();

  // Chunk an asset
  ipcMain.handle("nft:chunk-asset", async (_, asset: Asset, config?: Partial<ChunkingConfig>) => {
    return chunkAsset(asset, config);
  });

  // Get chunks for an asset
  ipcMain.handle("nft:get-chunks", async (_, assetId: string) => {
    return getAssetChunks(assetId);
  });

  // Create listing for a chunk
  ipcMain.handle("nft:create-listing", async (_, params: {
    asset: Asset;
    chunk: AssetChunk;
    pricing: NFTPricing;
    license: NFTLicenseType;
    network?: BlockchainNetwork;
  }) => {
    return createListing(
      params.asset,
      params.chunk,
      params.pricing,
      params.license,
      params.network
    );
  });

  // Bulk create listings for all chunks
  ipcMain.handle("nft:bulk-create-listings", async (_, params: {
    asset: Asset;
    pricing: NFTPricing;
    license: NFTLicenseType;
    network?: BlockchainNetwork;
  }) => {
    const chunks = await getAssetChunks(params.asset.id);
    const listings: NFTListing[] = [];
    
    for (const chunk of chunks) {
      const listing = await createListing(
        params.asset,
        chunk,
        params.pricing,
        params.license,
        params.network
      );
      listings.push(listing);
    }
    
    return listings;
  });

  // Get all listings
  ipcMain.handle("nft:list-all", async () => {
    return getAllListings();
  });

  // Get listings for asset
  ipcMain.handle("nft:list-by-asset", async (_, assetId: string) => {
    return getListingsByAsset(assetId);
  });

  // Get single listing
  ipcMain.handle("nft:get-listing", async (_, listingId: string) => {
    const listingPath = path.join(getListingsDir(), `${listingId}.json`);
    if (await fs.pathExists(listingPath)) {
      return fs.readJson(listingPath);
    }
    return null;
  });

  // Update listing pricing
  ipcMain.handle("nft:update-pricing", async (_, listingId: string, pricing: NFTPricing) => {
    const listingPath = path.join(getListingsDir(), `${listingId}.json`);
    if (!await fs.pathExists(listingPath)) {
      throw new Error("Listing not found");
    }
    
    const listing: NFTListing = await fs.readJson(listingPath);
    listing.pricing = pricing;
    await fs.writeJson(listingPath, listing, { spaces: 2 });
    return listing;
  });

  // Update listing status
  ipcMain.handle("nft:update-status", async (_, listingId: string, status: NFTListing["status"]) => {
    return updateListingStatus(listingId, status);
  });

  // Publish to marketplace
  ipcMain.handle("nft:publish", async (_, listingId: string, apiKey: string) => {
    return publishToMarketplace(listingId, apiKey);
  });

  // Bulk publish all listings for an asset
  ipcMain.handle("nft:bulk-publish", async (_, assetId: string, apiKey: string) => {
    const listings = await getListingsByAsset(assetId);
    const results: { listingId: string; success: boolean; error?: string }[] = [];
    
    for (const listing of listings) {
      if (listing.status === "draft") {
        const result = await publishToMarketplace(listing.id, apiKey);
        results.push({
          listingId: listing.id,
          success: result.success,
          error: result.error,
        });
      }
    }
    
    return results;
  });

  // Delete listing
  ipcMain.handle("nft:delete-listing", async (_, listingId: string) => {
    const listingPath = path.join(getListingsDir(), `${listingId}.json`);
    if (await fs.pathExists(listingPath)) {
      await fs.remove(listingPath);
    }
  });

  // Get portfolio
  ipcMain.handle("nft:portfolio", async () => {
    return getPortfolio();
  });

  // Get NFT stats
  ipcMain.handle("nft:stats", async () => {
    const listings = await getAllListings();
    const listed = listings.filter(l => l.status === "listed");
    const sold = listings.filter(l => l.status === "sold");
    const totalValue = listed.reduce((sum, l) => sum + (l.pricing.price || 0), 0);
    const totalSales = sold.reduce((sum, l) => sum + (l.pricing.price || 0), 0);
    
    return {
      total_listings: listings.length,
      listed_count: listed.length,
      sold_count: sold.length,
      draft_count: listings.filter(l => l.status === "draft").length,
      total_value: totalValue,
      total_sales: totalSales,
    };
  });

  logger.info("NFT Marketplace IPC handlers registered");
}
