/**
 * Compute Network IPC Client
 * Renderer-side client for decentralized compute network
 */

import type {
  ComputeNetworkConfig,
  NetworkStatus,
  PeerInfo,
  ConnectionInfo,
  FetchRequest,
  FetchProgress,
  FetchResult,
  InferenceJob,
  ValidationRequest,
  JobStats,
  SystemMetrics,
  NetworkMetrics,
  ComputeNetworkEvent,
} from "@/types/compute_network_types";

// Extend Window interface
declare global {
  interface Window {
    electron: {
      ipcRenderer: Electron.IpcRenderer;
    };
  }
}

class ComputeNetworkClient {
  private static instance: ComputeNetworkClient;
  private eventListeners: Map<string, Set<(event: ComputeNetworkEvent) => void>> =
    new Map();
  private ipcRenderer: Electron.IpcRenderer;

  private constructor() {
    this.ipcRenderer = window.electron.ipcRenderer;

    // Set up event listener from main process
    this.ipcRenderer.on(
      "compute-network:event",
      (networkEvent: ComputeNetworkEvent) => {
        this.dispatchEvent(networkEvent);
      }
    );
  }

  public static getInstance(): ComputeNetworkClient {
    if (!ComputeNetworkClient.instance) {
      ComputeNetworkClient.instance = new ComputeNetworkClient();
    }
    return ComputeNetworkClient.instance;
  }

  // ============================================================================
  // Event System
  // ============================================================================

  private dispatchEvent(event: ComputeNetworkEvent): void {
    const listeners = this.eventListeners.get("*") || new Set();
    const typeListeners = this.eventListeners.get(event.type) || new Set();

    for (const listener of [...listeners, ...typeListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("Event listener error:", error);
      }
    }
  }

  public on(
    eventType: ComputeNetworkEvent["type"] | "*",
    listener: (event: ComputeNetworkEvent) => void
  ): () => void {
    const listeners = this.eventListeners.get(eventType) || new Set();
    listeners.add(listener);
    this.eventListeners.set(eventType, listeners);

    return () => {
      listeners.delete(listener);
    };
  }

  public once(
    eventType: ComputeNetworkEvent["type"] | "*",
    listener: (event: ComputeNetworkEvent) => void
  ): () => void {
    const wrappedListener = (event: ComputeNetworkEvent) => {
      listener(event);
      this.off(eventType, wrappedListener);
    };
    return this.on(eventType, wrappedListener);
  }

  public off(
    eventType: ComputeNetworkEvent["type"] | "*",
    listener: (event: ComputeNetworkEvent) => void
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  // ============================================================================
  // Network Lifecycle
  // ============================================================================

  public async initialize(
    config: Partial<ComputeNetworkConfig>
  ): Promise<NetworkStatus> {
    return this.ipcRenderer.invoke("compute-network:initialize", config);
  }

  public async shutdown(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("compute-network:shutdown");
  }

  public async getStatus(): Promise<NetworkStatus> {
    return this.ipcRenderer.invoke("compute-network:get-status");
  }

  public async getConfig(): Promise<ComputeNetworkConfig> {
    return this.ipcRenderer.invoke("compute-network:get-config");
  }

  public async updateConfig(
    config: Partial<ComputeNetworkConfig>
  ): Promise<ComputeNetworkConfig> {
    return this.ipcRenderer.invoke("compute-network:update-config", config);
  }

  // ============================================================================
  // Peer Management
  // ============================================================================

  public async getPeers(): Promise<PeerInfo[]> {
    return this.ipcRenderer.invoke("compute-network:get-peers");
  }

  public async getPeer(peerId: string): Promise<PeerInfo | null> {
    return this.ipcRenderer.invoke("compute-network:get-peer", peerId);
  }

  public async getConnections(): Promise<ConnectionInfo[]> {
    return this.ipcRenderer.invoke("compute-network:get-connections");
  }

  public async connectPeer(multiaddr: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("compute-network:connect-peer", multiaddr);
  }

  public async disconnectPeer(peerId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("compute-network:disconnect-peer", peerId);
  }

  // ============================================================================
  // Content Management
  // ============================================================================

  public async fetchContent(request: FetchRequest): Promise<FetchResult> {
    return this.ipcRenderer.invoke("compute-network:fetch-content", request);
  }

  public async pinContent(cid: string): Promise<boolean> {
    return this.ipcRenderer.invoke("compute-network:pin-content", cid);
  }

  public async unpinContent(cid: string): Promise<boolean> {
    return this.ipcRenderer.invoke("compute-network:unpin-content", cid);
  }

  public async storeContent(
    data: Uint8Array,
    options?: { pin?: boolean }
  ): Promise<string> {
    return this.ipcRenderer.invoke("compute-network:store-content", data, options);
  }

  public async getFetchProgress(): Promise<FetchProgress[]> {
    return this.ipcRenderer.invoke("compute-network:get-fetch-progress");
  }

  // Convenience methods
  public async fetchModel(
    cid: string,
    priority: number = 5
  ): Promise<FetchResult> {
    return this.fetchContent({
      id: crypto.randomUUID(),
      cid,
      expectedType: "model-weights",
      priority,
      maxProviders: 5,
      chunkTimeoutMs: 60000,
      verifyChunks: true,
      requester: "",
      requestedAt: Date.now(),
    });
  }

  public async storeJSON(data: unknown, pin: boolean = true): Promise<string> {
    const jsonStr = JSON.stringify(data);
    const bytes = new TextEncoder().encode(jsonStr);
    return this.storeContent(bytes, { pin });
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  public async createJob(
    params: Omit<InferenceJob, "id" | "status" | "createdAt">
  ): Promise<InferenceJob> {
    return this.ipcRenderer.invoke("compute-network:create-job", params);
  }

  public async acceptJob(jobId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("compute-network:accept-job", jobId);
  }

  public async cancelJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("compute-network:cancel-job", jobId);
  }

  public async getJobs(): Promise<InferenceJob[]> {
    return this.ipcRenderer.invoke("compute-network:get-jobs");
  }

  public async getJob(jobId: string): Promise<InferenceJob | null> {
    return this.ipcRenderer.invoke("compute-network:get-job", jobId);
  }

  public async getActiveJobs(): Promise<InferenceJob[]> {
    return this.ipcRenderer.invoke("compute-network:get-active-jobs");
  }

  public async getPendingJobs(): Promise<InferenceJob[]> {
    return this.ipcRenderer.invoke("compute-network:get-pending-jobs");
  }

  // Convenience method for text generation
  public async createTextGenerationJob(options: {
    modelCid: string;
    modelName: string;
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    payment?: bigint;
  }): Promise<InferenceJob> {
    const inputData = {
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
    };
    const inputCid = await this.storeJSON(inputData);

    return this.createJob({
      type: "text-generation",
      modelCid: options.modelCid,
      modelName: options.modelName,
      inputCid,
      params: {
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        maxTokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
      },
      requester: "",
      validators: [],
      priority: 5,
      maxExecutionTimeMs: 300000,
      paymentOffered: options.payment ?? BigInt(0),
      requiredStake: BigInt(0),
      redundancy: 1,
      consensusThreshold: 1.0,
    });
  }

  // ============================================================================
  // Validation
  // ============================================================================

  public async requestValidation(
    jobId: string,
    resultIndex: number = 0
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke(
      "compute-network:request-validation",
      jobId,
      resultIndex
    );
  }

  public async getValidationRequests(): Promise<ValidationRequest[]> {
    return this.ipcRenderer.invoke("compute-network:get-validation-requests");
  }

  // ============================================================================
  // Telemetry
  // ============================================================================

  public async getJobStats(): Promise<JobStats> {
    return this.ipcRenderer.invoke("compute-network:get-job-stats");
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    return this.ipcRenderer.invoke("compute-network:get-system-metrics");
  }

  public async getNetworkMetrics(): Promise<NetworkMetrics> {
    return this.ipcRenderer.invoke("compute-network:get-network-metrics");
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  public async waitForJob(
    jobId: string,
    timeoutMs: number = 300000
  ): Promise<InferenceJob> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkJob = async () => {
        const job = await this.getJob(jobId);

        if (!job) {
          reject(new Error(`Job not found: ${jobId}`));
          return;
        }

        if (job.status === "completed" || job.status === "failed") {
          resolve(job);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Job timed out: ${jobId}`));
          return;
        }

        // Check again in 1 second
        setTimeout(checkJob, 1000);
      };

      checkJob();
    });
  }

  public async waitForContent(
    requestId: string,
    timeoutMs: number = 60000
  ): Promise<FetchProgress> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkProgress = async () => {
        const progressList = await this.getFetchProgress();
        const progress = progressList.find((p) => p.requestId === requestId);

        if (!progress) {
          reject(new Error(`Fetch request not found: ${requestId}`));
          return;
        }

        if (progress.status === "completed" || progress.status === "failed") {
          resolve(progress);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Content fetch timed out: ${requestId}`));
          return;
        }

        setTimeout(checkProgress, 500);
      };

      checkProgress();
    });
  }
}

export const computeNetworkClient = ComputeNetworkClient.getInstance();
export default ComputeNetworkClient;
