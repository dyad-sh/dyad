/**
 * JoyMarketplace IPC Client
 * Renderer-side API for marketplace operations
 */

import type { IpcRenderer } from "electron";
import type {
  PublishAppRequest,
  PublishAppResponse,
  MarketplaceAsset,
  PublisherProfile,
  DeploymentStatus,
  EarningsReport,
} from "@/types/marketplace_types";

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

export interface MarketplaceStatus {
  connected: boolean;
  profile: PublisherProfile | null;
  error?: string;
}

export const MarketplaceClient = {
  /**
   * Check marketplace connection status
   */
  async getStatus(): Promise<MarketplaceStatus> {
    return getIpcRenderer().invoke("marketplace:status");
  },

  /**
   * Connect to marketplace with API key
   */
  async connect(apiKey: string): Promise<{ success: boolean; profile?: PublisherProfile }> {
    return getIpcRenderer().invoke("marketplace:connect", apiKey);
  },

  /**
   * Disconnect from marketplace
   */
  async disconnect(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace:disconnect");
  },

  /**
   * Get publisher profile
   */
  async getProfile(): Promise<PublisherProfile> {
    return getIpcRenderer().invoke("marketplace:get-profile");
  },

  /**
   * List all published assets
   */
  async listAssets(): Promise<MarketplaceAsset[]> {
    return getIpcRenderer().invoke("marketplace:list-assets");
  },

  /**
   * Get single asset details
   */
  async getAsset(assetId: string): Promise<MarketplaceAsset> {
    return getIpcRenderer().invoke("marketplace:get-asset", assetId);
  },

  /**
   * Publish an app to marketplace
   */
  async publish(request: PublishAppRequest): Promise<PublishAppResponse> {
    return getIpcRenderer().invoke("marketplace:publish", request);
  },

  /**
   * Update a published asset
   */
  async updateAsset(assetId: string, updates: Partial<PublishAppRequest>): Promise<MarketplaceAsset> {
    return getIpcRenderer().invoke("marketplace:update-asset", assetId, updates);
  },

  /**
   * Unpublish/archive an asset
   */
  async unpublish(assetId: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace:unpublish", assetId);
  },

  /**
   * Get earnings report
   */
  async getEarnings(): Promise<EarningsReport> {
    return getIpcRenderer().invoke("marketplace:earnings");
  },

  /**
   * Export app as ZIP file
   */
  async exportZip(appId: number): Promise<{ success: boolean; path: string }> {
    return getIpcRenderer().invoke("marketplace:export-zip", appId);
  },

  /**
   * Get deployment status for an app
   */
  async getDeploymentStatus(appId: number): Promise<DeploymentStatus> {
    return getIpcRenderer().invoke("marketplace:deployment-status", appId);
  },

  /**
   * Open marketplace in browser
   */
  async openInBrowser(path?: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("marketplace:open", path);
  },

  /**
   * Get marketplace URLs
   */
  async getUrls(): Promise<{ apiUrl: string; webUrl: string }> {
    return getIpcRenderer().invoke("marketplace:get-url");
  },
};

export default MarketplaceClient;
