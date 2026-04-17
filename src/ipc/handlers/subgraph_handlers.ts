/**
 * Subgraph IPC Handlers
 *
 * Exposes Goldsky subgraph data (tokens, stores, domains, purchases) to the renderer.
 */

import { ipcMain } from "electron";
import type { SubgraphQueryParams, SubgraphTokensParams, SubgraphAssetsParams, SubgraphListingsParams, SubgraphAIModelsParams } from "@/types/subgraph_types";
import {
  getTokens,
  getUserBalances,
  getUserPurchases,
  getDropStats,
  getUserStores,
  getUserDomains,
  getAllStores,
  getAllDomains,
  getStoreStats,
  getMyMarketplaceAssets,
  getMarketplaceAssets,
  getMarketplaceListings,
  getAIModels,
  getUserLicenses,
  getUserReceipts,
  getMarketplaceStats,
} from "@/lib/subgraph_client";

export function registerSubgraphHandlers() {
  ipcMain.handle("subgraph:my-assets", async (_, params: SubgraphQueryParams) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getMyMarketplaceAssets(params);
  });

  ipcMain.handle("subgraph:tokens", async (_, params?: SubgraphTokensParams) => {
    return getTokens(params);
  });

  ipcMain.handle("subgraph:user-balances", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserBalances(params.walletAddress);
  });

  ipcMain.handle("subgraph:purchases", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserPurchases(params.walletAddress);
  });

  ipcMain.handle("subgraph:drop-stats", async () => {
    return getDropStats();
  });

  ipcMain.handle("subgraph:user-stores", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserStores(params.walletAddress);
  });

  ipcMain.handle("subgraph:all-stores", async (_, params?: { first?: number }) => {
    return getAllStores(params?.first);
  });

  ipcMain.handle("subgraph:user-domains", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserDomains(params.walletAddress);
  });

  ipcMain.handle("subgraph:all-domains", async (_, params?: { first?: number }) => {
    return getAllDomains(params?.first);
  });

  ipcMain.handle("subgraph:store-stats", async () => {
    return getStoreStats();
  });

  // ── Marketplace subgraph handlers ──────────────────────────────────────

  ipcMain.handle("subgraph:marketplace-assets", async (_, params?: SubgraphAssetsParams) => {
    return getMarketplaceAssets(params);
  });

  ipcMain.handle("subgraph:marketplace-listings", async (_, params?: SubgraphListingsParams) => {
    return getMarketplaceListings(params);
  });

  ipcMain.handle("subgraph:ai-models", async (_, params?: SubgraphAIModelsParams) => {
    return getAIModels(params);
  });

  ipcMain.handle("subgraph:user-licenses", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserLicenses(params.walletAddress);
  });

  ipcMain.handle("subgraph:user-receipts", async (_, params: { walletAddress: string }) => {
    if (!params?.walletAddress) {
      throw new Error("walletAddress is required");
    }
    return getUserReceipts(params.walletAddress);
  });

  ipcMain.handle("subgraph:marketplace-stats", async () => {
    return getMarketplaceStats();
  });
}
