/**
 * Subgraph Hooks — TanStack Query integration for on-chain marketplace data.
 */

import { useQuery } from "@tanstack/react-query";
import { SubgraphClient } from "@/ipc/subgraph_client";
import type { SubgraphTokensParams, SubgraphAssetsParams, SubgraphListingsParams, SubgraphAIModelsParams } from "@/types/subgraph_types";

// ── Query Keys ─────────────────────────────────────────────────────────────

export const subgraphKeys = {
  all: ["subgraph"] as const,
  myAssets: (wallet: string) => [...subgraphKeys.all, "my-assets", wallet] as const,
  tokens: (params?: SubgraphTokensParams) => [...subgraphKeys.all, "tokens", params] as const,
  userBalances: (wallet: string) => [...subgraphKeys.all, "balances", wallet] as const,
  purchases: (wallet: string) => [...subgraphKeys.all, "purchases", wallet] as const,
  dropStats: () => [...subgraphKeys.all, "drop-stats"] as const,
  userStores: (wallet: string) => [...subgraphKeys.all, "stores", wallet] as const,
  allStores: () => [...subgraphKeys.all, "all-stores"] as const,
  userDomains: (wallet: string) => [...subgraphKeys.all, "domains", wallet] as const,
  allDomains: () => [...subgraphKeys.all, "all-domains"] as const,
  storeStats: () => [...subgraphKeys.all, "store-stats"] as const,
  // Marketplace subgraph
  marketplaceAssets: (params?: SubgraphAssetsParams) => [...subgraphKeys.all, "marketplace-assets", params] as const,
  marketplaceListings: (params?: SubgraphListingsParams) => [...subgraphKeys.all, "marketplace-listings", params] as const,
  aiModels: (params?: SubgraphAIModelsParams) => [...subgraphKeys.all, "ai-models", params] as const,
  userLicenses: (wallet: string) => [...subgraphKeys.all, "licenses", wallet] as const,
  userReceipts: (wallet: string) => [...subgraphKeys.all, "receipts", wallet] as const,
  marketplaceStats: () => [...subgraphKeys.all, "marketplace-stats"] as const,
};

// ── Hooks ──────────────────────────────────────────────────────────────────

/** Aggregated view of all on-chain assets for a wallet. */
export function useMyMarketplaceAssets(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.myAssets(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getMyAssets(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Browse all tokens (paginated). */
export function useSubgraphTokens(params?: SubgraphTokensParams) {
  return useQuery({
    queryKey: subgraphKeys.tokens(params),
    queryFn: () => SubgraphClient.getTokens(params),
    staleTime: 60_000,
  });
}

/** Tokens owned by a wallet. */
export function useUserBalances(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.userBalances(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getUserBalances(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Purchases made by a wallet. */
export function useUserPurchases(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.purchases(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getPurchases(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Global drop statistics. */
export function useDropStats() {
  return useQuery({
    queryKey: subgraphKeys.dropStats(),
    queryFn: () => SubgraphClient.getDropStats(),
    staleTime: 120_000,
  });
}

/** Stores owned by a wallet. */
export function useUserStores(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.userStores(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getUserStores(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Browse all registered stores. */
export function useAllStores() {
  return useQuery({
    queryKey: subgraphKeys.allStores(),
    queryFn: () => SubgraphClient.getAllStores(),
    staleTime: 60_000,
  });
}

/** Domains owned by a wallet. */
export function useUserDomains(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.userDomains(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getUserDomains(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Browse all registered .joy domains. */
export function useAllDomains() {
  return useQuery({
    queryKey: subgraphKeys.allDomains(),
    queryFn: () => SubgraphClient.getAllDomains(),
    staleTime: 60_000,
  });
}

/** Global store statistics. */
export function useStoreStats() {
  return useQuery({
    queryKey: subgraphKeys.storeStats(),
    queryFn: () => SubgraphClient.getStoreStats(),
    staleTime: 120_000,
  });
}

// ── Marketplace subgraph hooks ─────────────────────────────────────────────

/** Browse on-chain marketplace assets (paginated, filterable). */
export function useMarketplaceAssets(params?: SubgraphAssetsParams) {
  return useQuery({
    queryKey: subgraphKeys.marketplaceAssets(params),
    queryFn: () => SubgraphClient.getMarketplaceAssets(params),
    staleTime: 60_000,
  });
}

/** Browse active marketplace listings (paginated, filterable). */
export function useMarketplaceListings(params?: SubgraphListingsParams) {
  return useQuery({
    queryKey: subgraphKeys.marketplaceListings(params),
    queryFn: () => SubgraphClient.getMarketplaceListings(params),
    staleTime: 60_000,
  });
}

/** Browse AI models (paginated, filterable). */
export function useAIModels(params?: SubgraphAIModelsParams) {
  return useQuery({
    queryKey: subgraphKeys.aiModels(params),
    queryFn: () => SubgraphClient.getAIModels(params),
    staleTime: 60_000,
  });
}

/** Licenses held by a wallet. */
export function useUserLicenses(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.userLicenses(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getUserLicenses(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Purchase receipts for a wallet. */
export function useUserReceipts(walletAddress: string | undefined) {
  return useQuery({
    queryKey: subgraphKeys.userReceipts(walletAddress ?? ""),
    queryFn: () => SubgraphClient.getUserReceipts(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });
}

/** Global marketplace statistics. */
export function useMarketplaceStats() {
  return useQuery({
    queryKey: subgraphKeys.marketplaceStats(),
    queryFn: () => SubgraphClient.getMarketplaceStats(),
    staleTime: 120_000,
  });
}
