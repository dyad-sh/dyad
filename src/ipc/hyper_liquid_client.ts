/**
 * Hyper Liquid Data Client
 * Renderer-side API for real-time data liquidity pipeline
 * 
 * Provides seamless data flow from local to joymarketplace.io
 */

import type { IpcRenderer } from "electron";
import type {
  LiquidDataContainer,
  LiquidityPipelineConfig,
  FlowQueue,
  LiquidityStreamEvent,
  FlowProgressEvent,
  LiquidityStats,
  StartFlowRequest,
  StartFlowResponse,
  BatchFlowRequest,
  BatchFlowResponse,
  ContentDeduplication,
  FlowCheckpoint,
  FlowStatus,
  FlowPriority,
} from "@/types/hyper_liquid_types";

type EventCallback = (event: LiquidityStreamEvent) => void;
type ProgressCallback = (event: FlowProgressEvent) => void;

// =============================================================================
// IPC RENDERER ACCESS
// =============================================================================

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

class HyperLiquidClient {
  private static instance: HyperLiquidClient | null = null;
  private eventListeners: Map<string, EventCallback[]> = new Map();
  private progressListeners: Map<string, ProgressCallback[]> = new Map();
  private globalEventListeners: EventCallback[] = [];
  private globalProgressListeners: ProgressCallback[] = [];
  private initialized = false;

  private constructor() {}

  public static getInstance(): HyperLiquidClient {
    if (!HyperLiquidClient.instance) {
      HyperLiquidClient.instance = new HyperLiquidClient();
    }
    return HyperLiquidClient.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initialize the client and register for events
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const ipc = getIpcRenderer();

    // Listen for events
    ipc.on("hyper-liquid:event", (_: unknown, event: LiquidityStreamEvent) => {
      this.handleEvent(event);
    });

    // Listen for progress updates
    ipc.on("hyper-liquid:progress", (_: unknown, progress: FlowProgressEvent) => {
      this.handleProgress(progress);
    });

    this.initialized = true;
  }

  private handleEvent(event: LiquidityStreamEvent): void {
    // Notify global listeners
    this.globalEventListeners.forEach(cb => cb(event));

    // Notify flow-specific listeners
    if (event.flowId) {
      const listeners = this.eventListeners.get(event.flowId) || [];
      listeners.forEach(cb => cb(event));
    }

    // Notify pipeline-specific listeners
    if (event.pipelineId) {
      const listeners = this.eventListeners.get(`pipeline:${event.pipelineId}`) || [];
      listeners.forEach(cb => cb(event));
    }
  }

  private handleProgress(progress: FlowProgressEvent): void {
    // Notify global progress listeners
    this.globalProgressListeners.forEach(cb => cb(progress));

    // Notify flow-specific listeners
    const listeners = this.progressListeners.get(progress.flowId) || [];
    listeners.forEach(cb => cb(progress));
  }

  // ===========================================================================
  // EVENT SUBSCRIPTIONS
  // ===========================================================================

  /**
   * Subscribe to all liquidity events
   */
  onEvent(callback: EventCallback): () => void {
    this.globalEventListeners.push(callback);
    return () => {
      this.globalEventListeners = this.globalEventListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to events for a specific flow
   */
  onFlowEvent(flowId: string, callback: EventCallback): () => void {
    const listeners = this.eventListeners.get(flowId) || [];
    listeners.push(callback);
    this.eventListeners.set(flowId, listeners);

    return () => {
      const current = this.eventListeners.get(flowId) || [];
      this.eventListeners.set(flowId, current.filter(cb => cb !== callback));
    };
  }

  /**
   * Subscribe to events for a specific pipeline
   */
  onPipelineEvent(pipelineId: string, callback: EventCallback): () => void {
    const key = `pipeline:${pipelineId}`;
    const listeners = this.eventListeners.get(key) || [];
    listeners.push(callback);
    this.eventListeners.set(key, listeners);

    return () => {
      const current = this.eventListeners.get(key) || [];
      this.eventListeners.set(key, current.filter(cb => cb !== callback));
    };
  }

  /**
   * Subscribe to all progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.globalProgressListeners.push(callback);
    return () => {
      this.globalProgressListeners = this.globalProgressListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to progress for a specific flow
   */
  onFlowProgress(flowId: string, callback: ProgressCallback): () => void {
    const listeners = this.progressListeners.get(flowId) || [];
    listeners.push(callback);
    this.progressListeners.set(flowId, listeners);

    return () => {
      const current = this.progressListeners.get(flowId) || [];
      this.progressListeners.set(flowId, current.filter(cb => cb !== callback));
    };
  }

  // ===========================================================================
  // PIPELINE MANAGEMENT
  // ===========================================================================

  /**
   * Get all configured pipelines
   */
  async getPipelines(): Promise<LiquidityPipelineConfig[]> {
    return getIpcRenderer().invoke("hyper-liquid:get-pipelines");
  }

  /**
   * Get a specific pipeline by ID
   */
  async getPipeline(pipelineId: string): Promise<LiquidityPipelineConfig | null> {
    return getIpcRenderer().invoke("hyper-liquid:get-pipeline", pipelineId);
  }

  /**
   * Create a new pipeline
   */
  async createPipeline(config: LiquidityPipelineConfig): Promise<LiquidityPipelineConfig> {
    return getIpcRenderer().invoke("hyper-liquid:create-pipeline", config);
  }

  /**
   * Update an existing pipeline
   */
  async updatePipeline(config: LiquidityPipelineConfig): Promise<LiquidityPipelineConfig> {
    return getIpcRenderer().invoke("hyper-liquid:update-pipeline", config);
  }

  /**
   * Delete a pipeline (cannot delete default)
   */
  async deletePipeline(pipelineId: string): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:delete-pipeline", pipelineId);
  }

  /**
   * Start a pipeline to begin processing flows
   */
  async startPipeline(pipelineId: string = "default"): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:start-pipeline", pipelineId);
  }

  /**
   * Stop a pipeline
   * @param graceful - If true, waits for active flows to complete
   */
  async stopPipeline(pipelineId: string, graceful: boolean = true): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:stop-pipeline", pipelineId, graceful);
  }

  /**
   * Pause a pipeline (active flows continue, new flows wait)
   */
  async pausePipeline(pipelineId: string): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:pause-pipeline", pipelineId);
  }

  /**
   * Resume a paused pipeline
   */
  async resumePipeline(pipelineId: string): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:resume-pipeline", pipelineId);
  }

  // ===========================================================================
  // FLOW MANAGEMENT
  // ===========================================================================

  /**
   * Start a new flow to transfer data to marketplace
   */
  async startFlow(request: StartFlowRequest): Promise<StartFlowResponse> {
    return getIpcRenderer().invoke("hyper-liquid:start-flow", request);
  }

  /**
   * Start a batch flow to transfer multiple items
   */
  async batchFlow(request: BatchFlowRequest): Promise<BatchFlowResponse> {
    return getIpcRenderer().invoke("hyper-liquid:batch-flow", request);
  }

  /**
   * Get a specific flow by ID
   */
  async getFlow(flowId: string): Promise<LiquidDataContainer | null> {
    return getIpcRenderer().invoke("hyper-liquid:get-flow", flowId);
  }

  /**
   * Get all flows, optionally filtered by pipeline
   */
  async getFlows(pipelineId?: string): Promise<LiquidDataContainer[]> {
    return getIpcRenderer().invoke("hyper-liquid:get-flows", pipelineId);
  }

  /**
   * Cancel a pending or active flow
   */
  async cancelFlow(flowId: string): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:cancel-flow", flowId);
  }

  /**
   * Retry a failed flow
   */
  async retryFlow(flowId: string): Promise<boolean> {
    return getIpcRenderer().invoke("hyper-liquid:retry-flow", flowId);
  }

  // ===========================================================================
  // QUEUE MANAGEMENT
  // ===========================================================================

  /**
   * Get queue for a specific pipeline
   */
  async getQueue(pipelineId: string): Promise<FlowQueue | null> {
    return getIpcRenderer().invoke("hyper-liquid:get-queue", pipelineId);
  }

  /**
   * Get all queues
   */
  async getQueues(): Promise<FlowQueue[]> {
    return getIpcRenderer().invoke("hyper-liquid:get-queues");
  }

  // ===========================================================================
  // STATS & ANALYTICS
  // ===========================================================================

  /**
   * Get liquidity statistics
   */
  async getStats(period?: "hour" | "day" | "week" | "month" | "all"): Promise<LiquidityStats> {
    return getIpcRenderer().invoke("hyper-liquid:get-stats", period);
  }

  /**
   * Reset statistics
   */
  async resetStats(): Promise<LiquidityStats> {
    return getIpcRenderer().invoke("hyper-liquid:reset-stats");
  }

  // ===========================================================================
  // DEDUPLICATION
  // ===========================================================================

  /**
   * Check if content already exists on marketplace
   */
  async checkDeduplication(dataId: string): Promise<ContentDeduplication> {
    return getIpcRenderer().invoke("hyper-liquid:check-dedup", dataId);
  }

  // ===========================================================================
  // CHECKPOINTS & RESUME
  // ===========================================================================

  /**
   * Get checkpoint for a flow (for resuming interrupted transfers)
   */
  async getCheckpoint(flowId: string): Promise<FlowCheckpoint | null> {
    return getIpcRenderer().invoke("hyper-liquid:get-checkpoint", flowId);
  }

  /**
   * Resume a flow from its last checkpoint
   */
  async resumeFromCheckpoint(flowId: string): Promise<{ success: boolean; error?: string }> {
    return getIpcRenderer().invoke("hyper-liquid:resume-from-checkpoint", flowId);
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  /**
   * Get overall hyper liquid status
   */
  async getStatus(): Promise<{
    running: boolean;
    activePipeline?: string;
    totalPipelines: number;
    totalFlows: number;
    activeFlows: number;
    stats: LiquidityStats;
  }> {
    return getIpcRenderer().invoke("hyper-liquid:status");
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Quick flow: Start a flow and wait for completion
   */
  async quickFlow(
    dataId: string,
    options: {
      priority?: FlowPriority;
      pipelineId?: string;
      timeoutMs?: number;
    } = {}
  ): Promise<{
    success: boolean;
    flow?: LiquidDataContainer;
    error?: string;
  }> {
    const response = await this.startFlow({
      dataId,
      priority: options.priority || "normal",
      pipelineId: options.pipelineId,
    });

    if (!response.success || !response.flowId) {
      return { success: false, error: response.error };
    }

    const flowId = response.flowId;
    const timeout = options.timeoutMs || 300000; // 5 minutes default

    return new Promise((resolve) => {
      const startTime = Date.now();

      // Set up event listener
      const unsubscribe = this.onFlowEvent(flowId, (event) => {
        if (event.type === "flow:completed") {
          unsubscribe();
          this.getFlow(flowId).then((flow) => {
            resolve({ success: true, flow: flow || undefined });
          });
        } else if (event.type === "flow:failed") {
          unsubscribe();
          this.getFlow(flowId).then((flow) => {
            resolve({
              success: false,
              flow: flow || undefined,
              error: flow?.error?.message,
            });
          });
        } else if (event.type === "flow:cancelled") {
          unsubscribe();
          resolve({ success: false, error: "Flow cancelled" });
        }
      });

      // Set up timeout
      const checkTimeout = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(checkTimeout);
          unsubscribe();
          resolve({ success: false, error: "Flow timed out" });
        }
      }, 1000);
    });
  }

  /**
   * Stream data with progress tracking
   */
  streamData(
    dataId: string,
    callbacks: {
      onProgress?: ProgressCallback;
      onComplete?: (flow: LiquidDataContainer) => void;
      onError?: (error: string) => void;
    },
    options: {
      priority?: FlowPriority;
      pipelineId?: string;
    } = {}
  ): {
    cancel: () => Promise<void>;
    promise: Promise<LiquidDataContainer>;
  } {
    let flowId: string | undefined;
    let unsubscribeProgress: (() => void) | undefined;
    let unsubscribeEvent: (() => void) | undefined;

    const promise = new Promise<LiquidDataContainer>(async (resolve, reject) => {
      try {
        const response = await this.startFlow({
          dataId,
          priority: options.priority || "normal",
          pipelineId: options.pipelineId,
        });

        if (!response.success || !response.flowId) {
          const error = response.error || "Failed to start flow";
          callbacks.onError?.(error);
          reject(new Error(error));
          return;
        }

        flowId = response.flowId;

        // Subscribe to progress
        if (callbacks.onProgress) {
          unsubscribeProgress = this.onFlowProgress(flowId, callbacks.onProgress);
        }

        // Subscribe to events
        unsubscribeEvent = this.onFlowEvent(flowId, (event) => {
          if (event.type === "flow:completed") {
            this.getFlow(flowId!).then((flow) => {
              if (flow) {
                callbacks.onComplete?.(flow);
                resolve(flow);
              }
            });
          } else if (event.type === "flow:failed") {
            this.getFlow(flowId!).then((flow) => {
              const error = flow?.error?.message || "Flow failed";
              callbacks.onError?.(error);
              reject(new Error(error));
            });
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        callbacks.onError?.(message);
        reject(error);
      }
    });

    // Cleanup on completion
    promise.finally(() => {
      unsubscribeProgress?.();
      unsubscribeEvent?.();
    });

    return {
      cancel: async () => {
        if (flowId) {
          await this.cancelFlow(flowId);
        }
        unsubscribeProgress?.();
        unsubscribeEvent?.();
      },
      promise,
    };
  }

  /**
   * Bulk upload with batching
   */
  async bulkUpload(
    dataIds: string[],
    options: {
      batchSize?: number;
      priority?: FlowPriority;
      pipelineId?: string;
      onBatchComplete?: (batchIndex: number, total: number) => void;
    } = {}
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: Map<string, { success: boolean; error?: string }>;
  }> {
    const batchSize = options.batchSize || 10;
    const results = new Map<string, { success: boolean; error?: string }>();
    let successful = 0;
    let failed = 0;

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < dataIds.length; i += batchSize) {
      batches.push(dataIds.slice(i, i + batchSize));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const response = await this.batchFlow({
        dataIds: batch,
        priority: options.priority,
        pipelineId: options.pipelineId,
      });

      if (response.success) {
        // Wait for all flows in batch to complete
        if (response.flowIds) {
          for (const flowId of response.flowIds) {
            // Poll for completion
            let attempts = 0;
            while (attempts < 300) { // 5 minute timeout per item
              const flow = await this.getFlow(flowId);
              if (!flow) break;

              if (flow.status === "completed") {
                successful++;
                results.set(flow.dataId, { success: true });
                break;
              } else if (flow.status === "failed" || flow.status === "cancelled") {
                failed++;
                results.set(flow.dataId, {
                  success: false,
                  error: flow.error?.message,
                });
                break;
              }

              await new Promise((r) => setTimeout(r, 1000));
              attempts++;
            }
          }
        }
      } else {
        // Mark all in batch as failed
        for (const dataId of batch) {
          failed++;
          results.set(dataId, { success: false, error: response.error });
        }
      }

      options.onBatchComplete?.(i + 1, batches.length);
    }

    return {
      total: dataIds.length,
      successful,
      failed,
      results,
    };
  }
}

// Export singleton instance
export const hyperLiquidClient = HyperLiquidClient.getInstance();
export type { HyperLiquidClient };
