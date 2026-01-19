/**
 * Dataset Studio IPC Client
 * Client-side interface for Dataset Studio operations
 */

import type {
  ItemLineage,
  ItemLabels,
  QualitySignals,
  DatasetSchemaV2,
  DatasetStatsV2,
  SplitsInfo,
  GenerationJobConfig,
} from "@/db/schema";

// Types for API responses
export interface DatasetItem {
  id: string;
  datasetId: string;
  modality: "text" | "image" | "audio" | "video" | "context";
  contentHash: string;
  byteSize: number;
  sourceType: "captured" | "imported" | "generated" | "api" | "scraped";
  sourcePath?: string;
  generator?: "local_model" | "provider_api" | "human" | "hybrid";
  lineageJson?: ItemLineage;
  contentUri: string;
  localPath?: string;
  thumbnailPath?: string;
  labelsJson?: ItemLabels;
  qualitySignalsJson?: QualitySignals;
  license: string;
  split: "train" | "val" | "test" | "unassigned";
  creatorSignature?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetManifest {
  id: string;
  datasetId: string;
  version: string;
  manifestHash: string;
  merkleRoot?: string;
  schemaJson?: DatasetSchemaV2;
  statsJson?: DatasetStatsV2;
  totalItems: number;
  totalBytes: number;
  splitsJson?: SplitsInfo;
  license: string;
  publishStatus: "draft" | "local" | "p2p_shared" | "marketplace_pending" | "marketplace_published";
  publishedAt?: Date;
  marketplaceId?: string;
  creatorSignature?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProvenanceRecord {
  id: string;
  itemId: string;
  action: "created" | "imported" | "generated" | "transformed" | "labeled" | "merged" | "split";
  actorType: "human" | "local_model" | "remote_api" | "pipeline";
  actorId?: string;
  inputHashesJson?: string[];
  outputHash: string;
  parametersJson?: Record<string, unknown>;
  timestamp: Date;
}

export interface GenerationJob {
  id: string;
  datasetId: string;
  jobType: "text_generation" | "image_generation" | "audio_transcription" | "labeling" | "augmentation" | "embedding";
  configJson?: GenerationJobConfig;
  providerType: "local" | "remote";
  providerId: string;
  modelId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  progress: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  errorMessage?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface P2pSyncState {
  id: string;
  datasetId: string;
  peerId: string;
  peerName?: string;
  syncDirection: "push" | "pull" | "bidirectional";
  lastSyncedVersion?: string;
  lastSyncedAt?: Date;
  conflictState: "none" | "detected" | "resolved" | "manual_required";
  syncStatus: "idle" | "syncing" | "queued" | "error";
  errorMessage?: string;
}

// Dataset type for listing
export interface StudioDataset {
  id: string;
  name: string;
  description?: string;
  datasetType: "custom" | "training" | "evaluation" | "fine_tuning" | "rag" | "mixed";
  license: string;
  tags?: string[];
  supportedModalities?: string[];
  itemCount: number;
  totalBytes: number;
  publishStatus: "draft" | "local" | "p2p_shared" | "marketplace_pending" | "marketplace_published";
  createdAt: Date;
  updatedAt: Date;
}

class DatasetStudioClient {
  private ipcRenderer: Electron.IpcRenderer;

  constructor() {
    this.ipcRenderer = window.electron.ipcRenderer;
  }

  // ========== Dataset CRUD Operations ==========

  async createDataset(args: {
    name: string;
    description?: string;
    datasetType?: "custom" | "training" | "evaluation" | "fine_tuning" | "rag" | "mixed";
    license?: string;
    tags?: string[];
    supportedModalities?: string[];
  }): Promise<{ success: boolean; datasetId: string }> {
    return this.ipcRenderer.invoke("dataset-studio:create-dataset", args);
  }

  async listDatasets(args?: {
    datasetType?: string;
    publishStatus?: string;
  }): Promise<StudioDataset[]> {
    return this.ipcRenderer.invoke("dataset-studio:list-datasets", args);
  }

  async getDataset(datasetId: string): Promise<StudioDataset> {
    return this.ipcRenderer.invoke("dataset-studio:get-dataset", datasetId);
  }

  async updateDataset(args: {
    datasetId: string;
    name?: string;
    description?: string;
    license?: string;
    tags?: string[];
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("dataset-studio:update-dataset", args);
  }

  async deleteDataset(datasetId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("dataset-studio:delete-dataset", datasetId);
  }

  async refreshStats(datasetId: string): Promise<{ success: boolean; itemCount: number; totalBytes: number }> {
    return this.ipcRenderer.invoke("dataset-studio:refresh-stats", datasetId);
  }

  // ========== Item Operations ==========

  async addItemFromFile(args: {
    datasetId: string;
    filePath: string;
    mimeType?: string;
    sourceType?: "captured" | "imported" | "generated" | "api" | "scraped";
    labels?: ItemLabels;
    license?: string;
  }): Promise<{ success: boolean; itemId: string; hash: string }> {
    return this.ipcRenderer.invoke("dataset-studio:add-item-from-file", args);
  }

  async addGeneratedItem(args: {
    datasetId: string;
    content: string | ArrayBuffer;
    mimeType: string;
    lineage: ItemLineage;
    labels?: ItemLabels;
    generator: "local_model" | "provider_api" | "hybrid";
  }): Promise<{ success: boolean; itemId: string; hash: string }> {
    return this.ipcRenderer.invoke("dataset-studio:add-generated-item", args);
  }

  async updateItemLabels(args: {
    itemId: string;
    labels: Partial<ItemLabels>;
    merge?: boolean;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("dataset-studio:update-item-labels", args);
  }

  async updateQualitySignals(args: {
    itemId: string;
    signals: Partial<QualitySignals>;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("dataset-studio:update-quality-signals", args);
  }

  async listItems(args: {
    datasetId: string;
    limit?: number;
    offset?: number;
    modality?: string;
    split?: string;
  }): Promise<{ items: DatasetItem[]; total: number }> {
    return this.ipcRenderer.invoke("dataset-studio:list-items", args);
  }

  async getItem(itemId: string): Promise<{ item: DatasetItem; provenance: ProvenanceRecord[] }> {
    return this.ipcRenderer.invoke("dataset-studio:get-item", itemId);
  }

  async deleteItem(itemId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("dataset-studio:delete-item", itemId);
  }

  // ========== Manifest Operations ==========

  async buildManifest(args: {
    datasetId: string;
    version: string;
    license: string;
    schema?: DatasetSchemaV2;
  }): Promise<{
    success: boolean;
    manifestId: string;
    manifestHash: string;
    merkleRoot: string;
    stats: DatasetStatsV2;
  }> {
    return this.ipcRenderer.invoke("dataset-studio:build-manifest", args);
  }

  async createSplits(args: {
    datasetId: string;
    ratios: { train: number; val: number; test: number };
    seed?: number;
  }): Promise<{ success: boolean; splits: SplitsInfo }> {
    return this.ipcRenderer.invoke("dataset-studio:create-splits", args);
  }

  async signManifest(manifestId: string): Promise<{ success: boolean; signature: string }> {
    return this.ipcRenderer.invoke("dataset-studio:sign-manifest", manifestId);
  }

  async getManifest(args: {
    datasetId?: string;
    manifestId?: string;
    version?: string;
  }): Promise<DatasetManifest | null> {
    return this.ipcRenderer.invoke("dataset-studio:get-manifest", args);
  }

  // ========== Generation Jobs ==========

  async createGenerationJob(args: {
    datasetId: string;
    jobType: "text_generation" | "image_generation" | "audio_transcription" | "labeling" | "augmentation" | "embedding";
    config: GenerationJobConfig;
    providerType: "local" | "remote";
    providerId: string;
    modelId: string;
  }): Promise<{ success: boolean; jobId: string }> {
    return this.ipcRenderer.invoke("dataset-studio:create-generation-job", args);
  }

  async getJobStatus(jobId: string): Promise<GenerationJob | null> {
    return this.ipcRenderer.invoke("dataset-studio:get-job-status", jobId);
  }

  async listJobs(datasetId: string): Promise<GenerationJob[]> {
    return this.ipcRenderer.invoke("dataset-studio:list-jobs", datasetId);
  }

  // ========== P2P Sync ==========

  async initP2pSync(args: {
    datasetId: string;
    peerId: string;
    peerName?: string;
    direction: "push" | "pull" | "bidirectional";
  }): Promise<{ success: boolean; syncId: string }> {
    return this.ipcRenderer.invoke("dataset-studio:init-p2p-sync", args);
  }

  async getP2pSyncStatus(datasetId: string): Promise<P2pSyncState[]> {
    return this.ipcRenderer.invoke("dataset-studio:get-p2p-sync-status", datasetId);
  }

  // ========== Content ==========

  async getContent(hash: string): Promise<{ content: ArrayBuffer; mimeType: string }> {
    return this.ipcRenderer.invoke("dataset-studio:get-content", hash);
  }

  async exportDataset(args: {
    datasetId: string;
    manifestId: string;
    outputDir: string;
    format: "jsonl" | "parquet" | "huggingface";
    includeMedia?: boolean;
  }): Promise<{ success: boolean; outputDir: string }> {
    return this.ipcRenderer.invoke("dataset-studio:export-dataset", args);
  }
}

// Singleton instance
let instance: DatasetStudioClient | null = null;

export function getDatasetStudioClient(): DatasetStudioClient {
  if (!instance) {
    instance = new DatasetStudioClient();
  }
  return instance;
}

export const datasetStudioClient = {
  getInstance: getDatasetStudioClient,
};
