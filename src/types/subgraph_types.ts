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
