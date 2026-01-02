/**
 * Asset Studio IPC Client
 * Renderer-side API for unified asset management
 */

import type { IpcRenderer } from "electron";
import type {
  Asset,
  AssetType,
  AlgorithmAsset,
  SchemaAsset,
  PromptAsset,
  UIComponentAsset,
  APIAsset,
  TrainingDataAsset,
} from "@/types/asset_types";

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

export interface AssetStats {
  total: number;
  byType: Record<AssetType, number>;
  published: number;
  totalSize: number;
}

export const AssetStudioClient = {
  // ============= Stats & General =============

  /**
   * Get asset statistics
   */
  async getStats(): Promise<AssetStats> {
    return getIpcRenderer().invoke("assets:stats");
  },

  /**
   * List assets by type
   */
  async listByType(assetType: AssetType): Promise<Asset[]> {
    return getIpcRenderer().invoke("assets:list", assetType);
  },

  /**
   * List all assets
   */
  async listAll(): Promise<Asset[]> {
    return getIpcRenderer().invoke("assets:list-all");
  },

  /**
   * Get single asset
   */
  async get(assetType: AssetType, assetId: string): Promise<Asset | null> {
    return getIpcRenderer().invoke("assets:get", assetType, assetId);
  },

  /**
   * Delete asset
   */
  async delete(assetType: AssetType, assetId: string): Promise<void> {
    return getIpcRenderer().invoke("assets:delete", assetType, assetId);
  },

  /**
   * Update asset
   */
  async update(asset: Asset): Promise<Asset> {
    return getIpcRenderer().invoke("assets:update", asset);
  },

  /**
   * Export asset to ZIP
   */
  async export(assetType: AssetType, assetId: string): Promise<string> {
    return getIpcRenderer().invoke("assets:export", assetType, assetId);
  },

  /**
   * Import asset from ZIP
   */
  async import(zipPath: string): Promise<Asset> {
    return getIpcRenderer().invoke("assets:import", zipPath);
  },

  /**
   * Open asset folder in file explorer
   */
  async openFolder(assetType: AssetType, assetId: string): Promise<void> {
    return getIpcRenderer().invoke("assets:open-folder", assetType, assetId);
  },

  /**
   * Read asset file content
   */
  async readFile(assetType: AssetType, assetId: string): Promise<string> {
    return getIpcRenderer().invoke("assets:read-file", assetType, assetId);
  },

  /**
   * Get assets directory
   */
  async getDirectory(): Promise<string> {
    return getIpcRenderer().invoke("assets:get-directory");
  },

  // ============= Asset Creation =============

  /**
   * Create algorithm asset
   */
  async createAlgorithm(params: {
    name: string;
    description?: string;
    language: AlgorithmAsset["language"];
    algorithmType: AlgorithmAsset["algorithmType"];
    code: string;
    inputs: AlgorithmAsset["inputs"];
    outputs: AlgorithmAsset["outputs"];
    dependencies?: string[];
  }): Promise<AlgorithmAsset> {
    return getIpcRenderer().invoke("assets:create:algorithm", params);
  },

  /**
   * Create schema asset
   */
  async createSchema(params: {
    name: string;
    description?: string;
    schemaType: SchemaAsset["schemaType"];
    content: string;
  }): Promise<SchemaAsset> {
    return getIpcRenderer().invoke("assets:create:schema", params);
  },

  /**
   * Create prompt asset
   */
  async createPrompt(params: {
    name: string;
    description?: string;
    promptType: PromptAsset["promptType"];
    content: string;
    variables: PromptAsset["variables"];
    targetModel?: string;
    examples?: PromptAsset["examples"];
  }): Promise<PromptAsset> {
    return getIpcRenderer().invoke("assets:create:prompt", params);
  },

  /**
   * Create UI component asset
   */
  async createUIComponent(params: {
    name: string;
    description?: string;
    componentType: UIComponentAsset["componentType"];
    framework: UIComponentAsset["framework"];
    styling: UIComponentAsset["styling"];
    code: string;
    props: UIComponentAsset["props"];
    responsive?: boolean;
    darkMode?: boolean;
    dependencies?: string[];
  }): Promise<UIComponentAsset> {
    return getIpcRenderer().invoke("assets:create:ui-component", params);
  },

  /**
   * Create API asset
   */
  async createAPI(params: {
    name: string;
    description?: string;
    apiType: APIAsset["apiType"];
    baseUrl?: string;
    authentication: APIAsset["authentication"];
    endpoints: APIAsset["endpoints"];
    spec?: string;
  }): Promise<APIAsset> {
    return getIpcRenderer().invoke("assets:create:api", params);
  },

  /**
   * Create training data asset
   */
  async createTrainingData(params: {
    name: string;
    description?: string;
    dataType: TrainingDataAsset["dataType"];
    format: TrainingDataAsset["format"];
    data: any[];
    quality?: TrainingDataAsset["quality"];
    splitRatio?: TrainingDataAsset["splitRatio"];
  }): Promise<TrainingDataAsset> {
    return getIpcRenderer().invoke("assets:create:training-data", params);
  },
};
