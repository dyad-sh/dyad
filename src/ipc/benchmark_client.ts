/**
 * Model Benchmark IPC Client
 * Renderer-side API for benchmarking
 */

import type { IpcRenderer } from "electron";

// =============================================================================
// TYPES (mirrored from model_benchmark.ts)
// =============================================================================

export type BenchmarkId = string & { __brand: "BenchmarkId" };
export type BenchmarkStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type BenchmarkCategory = "speed" | "quality" | "memory" | "comprehensive";
export type ModelType = "llm" | "embedding" | "vision" | "speech" | "multimodal";

export interface ModelInfo {
  id: string;
  name: string;
  type: ModelType;
  provider: string;
  parameterCount?: number;
  quantization?: string;
  contextLength?: number;
  capabilities?: string[];
}

export interface BenchmarkConfig {
  category: BenchmarkCategory;
  models: string[];
  speedTests?: {
    promptLengths: number[];
    outputLengths: number[];
    iterations: number;
  };
  qualityTests?: {
    datasets: string[];
    maxSamples?: number;
    temperature?: number;
  };
  memoryTests?: {
    contextLengths: number[];
    batchSizes: number[];
    measurePeakUsage: boolean;
  };
  hardware?: {
    useGpu: boolean;
    gpuLayers?: number;
    threads?: number;
    batchSize?: number;
  };
}

export interface BenchmarkResult {
  id: BenchmarkId;
  config: BenchmarkConfig;
  status: BenchmarkStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
  results: ModelBenchmarkResult[];
  summary?: BenchmarkSummary;
  systemInfo: SystemInfo;
}

export interface ModelBenchmarkResult {
  modelId: string;
  modelInfo: ModelInfo;
  speedMetrics?: SpeedMetrics;
  qualityMetrics?: QualityMetrics;
  memoryMetrics?: MemoryMetrics;
  overallScore?: number;
  rank?: number;
}

export interface SpeedMetrics {
  tokensPerSecond: number;
  timeToFirstToken: number;
  promptProcessingSpeed: number;
  generationSpeed: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  byPromptLength: Record<number, SpeedByLength>;
}

export interface SpeedByLength {
  promptLength: number;
  outputLength: number;
  avgTime: number;
  tokensPerSecond: number;
  iterations: number;
}

export interface QualityMetrics {
  overallAccuracy: number;
  byDataset: Record<string, DatasetResult>;
  coherenceScore?: number;
  fluencyScore?: number;
  relevanceScore?: number;
}

export interface DatasetResult {
  dataset: string;
  accuracy: number;
  samples: number;
  correctAnswers: number;
  avgConfidence?: number;
}

export interface MemoryMetrics {
  baseMemoryUsage: number;
  peakMemoryUsage: number;
  avgMemoryUsage: number;
  gpuMemoryUsage?: number;
  byContextLength: Record<number, MemoryByContext>;
}

export interface MemoryByContext {
  contextLength: number;
  memoryUsage: number;
  gpuMemoryUsage?: number;
}

export interface BenchmarkSummary {
  fastestModel: string;
  highestQuality: string;
  mostEfficient: string;
  lowestMemory: string;
  recommendations: BenchmarkRecommendation[];
}

export interface BenchmarkRecommendation {
  useCase: string;
  recommendedModel: string;
  reason: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
  gpuInfo?: GPUInfo[];
}

export interface GPUInfo {
  name: string;
  vram: number;
  driver?: string;
}

export interface BenchmarkDataset {
  id: string;
  name: string;
  description: string;
  category: string;
}

export type BenchmarkEventType =
  | "benchmark:started"
  | "benchmark:progress"
  | "benchmark:model-complete"
  | "benchmark:completed"
  | "benchmark:failed"
  | "benchmark:cancelled";

export interface BenchmarkEvent {
  type: BenchmarkEventType;
  benchmarkId: BenchmarkId;
  data?: any;
}

// =============================================================================
// CLIENT
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC Renderer not available");
    }
  }
  return ipcRenderer;
}

export const BenchmarkClient = {
  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("benchmark:initialize");
  },

  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("benchmark:shutdown");
  },

  // ---------------------------------------------------------------------------
  // BENCHMARK EXECUTION
  // ---------------------------------------------------------------------------

  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkId> {
    return getIpcRenderer().invoke("benchmark:run", config);
  },

  async cancelBenchmark(id: BenchmarkId): Promise<boolean> {
    return getIpcRenderer().invoke("benchmark:cancel", id);
  },

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  async getBenchmark(id: BenchmarkId): Promise<BenchmarkResult | null> {
    return getIpcRenderer().invoke("benchmark:get", id);
  },

  async listBenchmarks(limit?: number, offset?: number): Promise<BenchmarkResult[]> {
    return getIpcRenderer().invoke("benchmark:list", limit, offset);
  },

  async deleteBenchmark(id: BenchmarkId): Promise<boolean> {
    return getIpcRenderer().invoke("benchmark:delete", id);
  },

  async getAvailableDatasets(): Promise<BenchmarkDataset[]> {
    return getIpcRenderer().invoke("benchmark:get-datasets");
  },

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("benchmark:subscribe");
  },

  onEvent(callback: (event: BenchmarkEvent) => void): () => void {
    const handler = (_: unknown, event: BenchmarkEvent) => callback(event);
    getIpcRenderer().on("benchmark:event" as any, handler);
    return () => {
      getIpcRenderer().removeListener("benchmark:event" as any, handler);
    };
  },
};

export default BenchmarkClient;
