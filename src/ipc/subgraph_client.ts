/**
 * Subgraph IPC Client
 * Renderer-side API for querying on-chain marketplace data via Goldsky subgraphs.
 */

import type { IpcRenderer } from "electron";
import type {
  SubgraphToken,
  SubgraphPurchase,
  SubgraphUserBalance,
  SubgraphDropStats,
  SubgraphStore,
  SubgraphDomainRegistration,
  SubgraphStoreStats,
  MyMarketplaceAssets,
  SubgraphTokensParams,
} from "@/types/subgraph_types";

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer = (window as unknown as { electron?: { ipcRenderer: IpcRenderer } }).electron
      ?.ipcRenderer ?? null;
    if (!ipcRenderer) {
      throw new Error("IPC not available - are you running in Electron?");
    }
  }
  return ipcRenderer;
}

export const SubgraphClient = {
  /** Fetch all on-chain assets owned by the given wallet. */
  async getMyAssets(walletAddress: string): Promise<MyMarketplaceAssets> {
    return getIpcRenderer().invoke("subgraph:my-assets", { walletAddress });
  },

  /** Browse all tokens (paginated). */
  async getTokens(params?: SubgraphTokensParams): Promise<SubgraphToken[]> {
    return getIpcRenderer().invoke("subgraph:tokens", params);
  },

  /** Get tokens owned by a wallet. */
  async getUserBalances(walletAddress: string): Promise<SubgraphUserBalance[]> {
    return getIpcRenderer().invoke("subgraph:user-balances", { walletAddress });
  },

  /** Get purchases made by a wallet. */
  async getPurchases(walletAddress: string): Promise<SubgraphPurchase[]> {
    return getIpcRenderer().invoke("subgraph:purchases", { walletAddress });
  },

  /** Get global drop statistics. */
  async getDropStats(): Promise<SubgraphDropStats | null> {
    return getIpcRenderer().invoke("subgraph:drop-stats");
  },

  /** Get stores owned by a wallet. */
  async getUserStores(walletAddress: string): Promise<SubgraphStore[]> {
    return getIpcRenderer().invoke("subgraph:user-stores", { walletAddress });
  },

  /** Browse all stores. */
  async getAllStores(first?: number): Promise<SubgraphStore[]> {
    return getIpcRenderer().invoke("subgraph:all-stores", first ? { first } : undefined);
  },

  /** Get domains owned by a wallet. */
  async getUserDomains(walletAddress: string): Promise<SubgraphDomainRegistration[]> {
    return getIpcRenderer().invoke("subgraph:user-domains", { walletAddress });
  },

  /** Browse all registered domains. */
  async getAllDomains(first?: number): Promise<SubgraphDomainRegistration[]> {
    return getIpcRenderer().invoke("subgraph:all-domains", first ? { first } : undefined);
  },

  /** Get global store statistics. */
  async getStoreStats(): Promise<SubgraphStoreStats | null> {
    return getIpcRenderer().invoke("subgraph:store-stats");
  },
};
