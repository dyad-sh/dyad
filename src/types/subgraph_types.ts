/**
 * Joy Marketplace Subgraph Types
 * Types for Goldsky-indexed on-chain data (Amoy testnet)
 */

// ── joy-drop-amoy subgraph entities ────────────────────────────────────────

export interface SubgraphToken {
  id: string;
  tokenId: string;
  baseURI: string;
  lazyMintedAt: string;
  lazyMintBlock?: string;
  lazyMintTxHash?: string;
  pricePerToken: string | null;
  currency: string | null;
  maxClaimableSupply: string | null;
  supplyClaimed: string | null;
  quantityLimitPerWallet: string | null;
  conditionStartTimestamp?: string | null;
  conditionUpdatedAt?: string | null;
  totalPurchases: string;
  purchases?: SubgraphPurchase[];
}

export interface SubgraphPurchase {
  id: string;
  tokenId: string;
  claimConditionIndex?: string;
  claimer: string;
  receiver: string;
  quantity: string;
  timestamp: string;
  blockNumber: string;
  txHash: string;
}

export interface SubgraphUserBalance {
  id: string;
  user: string;
  tokenId: string;
  totalClaimed: string;
  lastClaimedAt: string;
  token?: SubgraphToken;
}

export interface SubgraphDropStats {
  id: string;
  totalTokens: string;
  totalPurchases: string;
  updatedAt: string;
}

// ── joy-stores-amoy subgraph entities ──────────────────────────────────────

export interface SubgraphStore {
  id: string;
  domain: string | null;
  owner: string;
  name: string | null;
  description: string | null;
  logo: string | null;
  website: string | null;
  tagline: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  textRecords?: SubgraphStoreTextRecord[];
}

export interface SubgraphStoreTextRecord {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface SubgraphDomainRegistration {
  id: string;
  labelHash?: string;
  name: string | null;
  fullName: string | null;
  owner: string;
  resolver?: string | null;
  resolvedAddress: string | null;
  expiresAt: string | null;
  registeredAt: string;
  registeredTxHash?: string;
  cost: string | null;
  store?: SubgraphStore | null;
  textRecords?: SubgraphDomainTextRecord[];
}

export interface SubgraphDomainTextRecord {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface SubgraphStoreStats {
  id: string;
  totalDomains: string;
  totalStores: string;
  totalTextRecords: string;
  updatedAt: string;
}

// ── joy-marketplace-amoy subgraph entities ─────────────────────────────────

export interface SubgraphAsset {
  id: string;
  tokenId: string;
  contractAddress: string;
  owner: string;
  creator: string;
  name: string | null;
  assetType: string | null;
  merkleRoot: string | null;
  totalChunks: string | null;
  encrypted: boolean;
  verificationScore: string | null;
  totalSales: string;
  totalVolume: string;
  createdAt: string;
  createdTxHash: string;
  listings?: SubgraphListing[];
  reviews?: SubgraphReview[];
  publisher?: SubgraphPublisher | null;
  store?: SubgraphMarketplaceStore | null;
  verification?: SubgraphVerification | null;
}

export interface SubgraphListing {
  id: string;
  listingId: string;
  seller: string;
  nftContract: string;
  tokenId: string;
  quantity: string;
  pricePerItem: string;
  effectivePrice: string;
  hasDiscount: boolean;
  discountEndTime: string | null;
  discountedPrice: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  soldAt: string | null;
  buyer: string | null;
  totalPaid: string | null;
  platformFee: string | null;
  royaltyPaid: string | null;
  createdTxHash: string;
  asset?: SubgraphAsset | null;
}

export interface SubgraphAIModel {
  id: string;
  tokenId: string;
  creator: string;
  owner: string;
  name: string | null;
  category: number;
  licenseType: number;
  verified: boolean;
  qualityScore: string;
  usageCount: string;
  totalLicenseRevenue: string;
  createdAt: string;
  createdTxHash: string;
  licenses?: SubgraphAIModelLicense[];
}

export interface SubgraphAIModelLicense {
  id: string;
  model?: SubgraphAIModel;
  licensee: string;
  licenseType: number;
  amount: string;
  expiresAt: string;
  timestamp: string;
  txHash: string;
}

export interface SubgraphPublisher {
  id: string;
  address: string;
  name: string | null;
  reputationScore: string;
  totalAssets: string;
  totalSales: string;
  totalVolume: string;
  successRate: string;
  firstPublishAt: string;
  lastActiveAt: string;
}

export interface SubgraphReview {
  id: string;
  reviewId: string;
  reviewer: string;
  seller: string;
  nftContract: string;
  tokenId: string;
  rating: number;
  verified: boolean;
  helpfulCount: string;
  reportCount: string;
  removed: boolean;
  createdAt: string;
  createdTxHash: string;
}

export interface SubgraphVerification {
  id: string;
  assetContract: string;
  tokenId: string;
  level: number;
  verifier: string;
  verificationCid: string | null;
  active: boolean;
  verifiedAt: string;
  txHash: string;
}

export interface SubgraphMarketplaceStore {
  id: string;
  contractAddress: string;
  owner: string;
  name: string | null;
  description: string | null;
  isActive: boolean;
  isVerified: boolean;
  assetCount: string;
  totalSales: string;
  totalVolume: string;
  createdAt: string;
}

export interface SubgraphMarketplaceStats {
  id: string;
  totalListings: string;
  activeListings: string;
  totalSales: string;
  totalVolume: string;
  totalAssets: string;
  totalPublishers: string;
  totalEscrows: string;
  totalReviews: string;
  totalCollections: string;
  totalBundles: string;
  updatedAt: string;
}

export interface SubgraphReceipt {
  id: string;
  receiptId: string;
  buyer: string;
  seller: string;
  listingId: string;
  price: string;
  fulfilled: boolean;
  fulfilledMethod: number | null;
  fulfilledAt: string | null;
  disputed: boolean;
  disputeReason: string | null;
  refunded: boolean;
  refundAmount: string | null;
  downloadCount: string;
  issuedAt: string;
  issuedTxHash: string;
}

// ── Marketplace query parameters ───────────────────────────────────────────

export interface SubgraphAssetsParams {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  assetType?: string;
  creator?: string;
}

export interface SubgraphListingsParams {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  activeOnly?: boolean;
  seller?: string;
}

export interface SubgraphAIModelsParams {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  creator?: string;
  verified?: boolean;
}

// ── Aggregated "My Assets" view ────────────────────────────────────────────

export interface MyMarketplaceAssets {
  /** Tokens the user owns (claimed via drops) */
  ownedTokens: SubgraphUserBalance[];
  /** Purchases the user has made */
  purchases: SubgraphPurchase[];
  /** Stores the user owns */
  stores: SubgraphStore[];
  /** Domains the user has registered */
  domains: SubgraphDomainRegistration[];
  /** Global drop stats */
  dropStats: SubgraphDropStats | null;
  /** Global store stats */
  storeStats: SubgraphStoreStats | null;
  /** On-chain marketplace assets created by the user */
  marketplaceAssets: SubgraphAsset[];
  /** Active listings by the user */
  activeListings: SubgraphListing[];
  /** AI model licenses held by the user */
  licenses: SubgraphAIModelLicense[];
  /** Global marketplace stats */
  marketplaceStats: SubgraphMarketplaceStats | null;
}

// ── Query parameters ───────────────────────────────────────────────────────

export interface SubgraphQueryParams {
  walletAddress: string;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

export interface SubgraphTokensParams {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}
