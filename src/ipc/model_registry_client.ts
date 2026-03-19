/**
 * Model Registry Client — Renderer-side IPC client for the Decentralized Model Registry
 */

import type { IpcRenderer } from "electron";
import type {
  ModelRegistryEntry,
  SearchParams,
  PublishResult,
  RegistryStats,
  RegisterModelParams,
  RateModelParams,
} from "@/lib/model_registry_service";

class ModelRegistryClient {
  private static instance: ModelRegistryClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): ModelRegistryClient {
    if (!ModelRegistryClient.instance) {
      ModelRegistryClient.instance = new ModelRegistryClient();
    }
    return ModelRegistryClient.instance;
  }

  /** Register a new model in the local registry */
  async register(params: RegisterModelParams): Promise<ModelRegistryEntry> {
    return this.ipcRenderer.invoke("model-registry:register", params);
  }

  /** Register an adapter from the data flywheel */
  async registerAdapter(params: {
    adapterId: string;
    name: string;
    baseModel: string;
    adapterType: "lora" | "qlora" | "full";
    adapterPath: string;
    rank?: number;
    alpha?: number;
    flywheelRunId?: number;
    datasetName?: string;
    trainingPairs?: number;
    epochs?: number;
    agentId?: number;
  }): Promise<ModelRegistryEntry> {
    return this.ipcRenderer.invoke("model-registry:register-adapter", params);
  }

  /** Get a single model entry by ID */
  async get(id: string): Promise<ModelRegistryEntry | null> {
    return this.ipcRenderer.invoke("model-registry:get", { id });
  }

  /** Search models with filters */
  async search(
    params?: SearchParams,
  ): Promise<{ entries: ModelRegistryEntry[]; total: number }> {
    return this.ipcRenderer.invoke("model-registry:search", params);
  }

  /** List all locally registered models */
  async listLocal(): Promise<ModelRegistryEntry[]> {
    return this.ipcRenderer.invoke("model-registry:list-local");
  }

  /** Publish a model to the decentralized network */
  async publish(modelId: string): Promise<PublishResult> {
    return this.ipcRenderer.invoke("model-registry:publish", { modelId });
  }

  /** Rate a model */
  async rate(params: RateModelParams): Promise<void> {
    return this.ipcRenderer.invoke("model-registry:rate", params);
  }

  /** Record MAB quality signal */
  async recordMABSignal(
    modelEntryId: string,
    mabAlpha: number,
    mabBeta: number,
    sampleCount: number,
  ): Promise<void> {
    return this.ipcRenderer.invoke("model-registry:mab-signal", {
      modelEntryId,
      mabAlpha,
      mabBeta,
      sampleCount,
    });
  }

  /** Record model usage */
  async recordUsage(modelId: string): Promise<void> {
    return this.ipcRenderer.invoke("model-registry:record-usage", { modelId });
  }

  /** Update a model entry */
  async update(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      tags: string[];
      license: string;
      licenseUrl: string;
    }>,
  ): Promise<ModelRegistryEntry | null> {
    return this.ipcRenderer.invoke("model-registry:update", { id, updates });
  }

  /** Delete a model entry (only unpublished local models) */
  async delete(id: string): Promise<void> {
    return this.ipcRenderer.invoke("model-registry:delete", { id });
  }

  /** Delist a published model */
  async delist(id: string): Promise<void> {
    return this.ipcRenderer.invoke("model-registry:delist", { id });
  }

  /** Get registry stats */
  async getStats(): Promise<RegistryStats> {
    return this.ipcRenderer.invoke("model-registry:stats");
  }

  /** Get ratings for a model */
  async getRatings(
    modelEntryId: string,
  ): Promise<
    Array<{
      id: string;
      raterId: string;
      raterType: string;
      score: number;
      dimension: string;
      evidence: Record<string, unknown> | null;
      createdAt: Date;
    }>
  > {
    return this.ipcRenderer.invoke("model-registry:get-ratings", {
      modelEntryId,
    });
  }

  /** List known peers */
  async listPeers(): Promise<
    Array<{
      id: string;
      displayName: string | null;
      wallet: string | null;
      isOnline: boolean;
      trustScore: number;
      modelsShared: number;
      lastSeenAt: Date | null;
    }>
  > {
    return this.ipcRenderer.invoke("model-registry:list-peers");
  }

  /** Start downloading a model from the network */
  async download(modelEntryId: string): Promise<string> {
    return this.ipcRenderer.invoke("model-registry:download", {
      modelEntryId,
    });
  }

  /** Get download status */
  async getDownloadStatus(downloadId: string): Promise<{
    id: string;
    status: string;
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
    localPath: string | null;
    errorMessage: string | null;
  } | null> {
    return this.ipcRenderer.invoke("model-registry:download-status", {
      downloadId,
    });
  }

  /** List active downloads */
  async listDownloads(): Promise<
    Array<{
      id: string;
      modelEntryId: string;
      status: string;
      progress: number;
    }>
  > {
    return this.ipcRenderer.invoke("model-registry:list-downloads");
  }
}

export { ModelRegistryClient };
