/**
 * Trustless Inference IPC Client
 * Renderer-side client for trustless local AI inference with verification
 */

import type { IpcRenderer } from "electron";

import type {
  LocalModelProvider,
  LocalModelInfo,
  InferenceRecord,
  VerificationResult,
  HeliaNodeStatus,
  InferenceStats,
  InferenceMessage,
} from "@/types/trustless_inference";

// Type for the inference result
interface InferenceResult {
  output: string;
  recordId?: string;
  cid?: string;
  verified?: boolean;
  tokens: number;
  timeMs: number;
}

// Get typed IPC renderer
function getIpcRenderer(): IpcRenderer {
  return (window as unknown as { electron: { ipcRenderer: IpcRenderer } }).electron.ipcRenderer;
}

/**
 * Trustless Inference Client
 * Provides a clean API for verified local AI inference
 */
export class TrustlessInferenceClient {
  private static instance: TrustlessInferenceClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = getIpcRenderer();
  }

  static getInstance(): TrustlessInferenceClient {
    if (!TrustlessInferenceClient.instance) {
      TrustlessInferenceClient.instance = new TrustlessInferenceClient();
    }
    return TrustlessInferenceClient.instance;
  }

  // ============================================================================
  // Service Lifecycle
  // ============================================================================

  async initialize(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("trustless:initialize");
  }

  async shutdown(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("trustless:shutdown");
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  async checkProviders(): Promise<Record<LocalModelProvider, boolean>> {
    return this.ipcRenderer.invoke("trustless:check-providers");
  }

  async listModels(): Promise<LocalModelInfo[]> {
    return this.ipcRenderer.invoke("trustless:list-models");
  }

  async getModelInfo(
    provider: LocalModelProvider,
    modelId: string
  ): Promise<LocalModelInfo | null> {
    return this.ipcRenderer.invoke("trustless:get-model-info", provider, modelId);
  }

  // ============================================================================
  // Verified Inference
  // ============================================================================

  async runInference(params: {
    provider: LocalModelProvider;
    modelId: string;
    prompt: string;
    systemPrompt?: string;
    messages?: InferenceMessage[];
    config?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      seed?: number;
    };
    skipVerification?: boolean;
  }): Promise<InferenceResult> {
    return this.ipcRenderer.invoke("trustless:run-inference", params);
  }

  /**
   * Stream inference - Note: This uses polling since dynamic IPC channels
   * are not supported in the current architecture. For true streaming,
   * we'd need to implement WebSocket or SSE support.
   */
  async streamInference(
    params: {
      provider: LocalModelProvider;
      modelId: string;
      messages: InferenceMessage[];
      systemPrompt?: string;
      config?: {
        temperature?: number;
        maxTokens?: number;
      };
    },
    callbacks: {
      onToken: (content: string) => void;
      onDone?: (data: { recordId?: string; cid?: string }) => void;
      onError?: (error: string) => void;
    }
  ): Promise<void> {
    // For now, use non-streaming inference and simulate streaming
    try {
      const result = await this.runInference({
        ...params,
        prompt: params.messages[params.messages.length - 1]?.content || "",
      });

      // Simulate streaming by sending output in chunks
      const words = result.output.split(" ");
      for (const word of words) {
        callbacks.onToken(word + " ");
        // Small delay to simulate streaming
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      callbacks.onDone?.({
        recordId: result.recordId,
        cid: result.cid,
      });
    } catch (error) {
      callbacks.onError?.(String(error));
    }
  }

  // ============================================================================
  // Verification Operations
  // ============================================================================

  async verifyRecord(recordId: string): Promise<VerificationResult> {
    return this.ipcRenderer.invoke("trustless:verify-record", recordId);
  }

  async getRecord(recordId: string): Promise<InferenceRecord | null> {
    return this.ipcRenderer.invoke("trustless:get-record", recordId);
  }

  async listRecords(limit?: number): Promise<InferenceRecord[]> {
    return this.ipcRenderer.invoke("trustless:list-records", limit);
  }

  async exportProof(recordId: string): Promise<string> {
    return this.ipcRenderer.invoke("trustless:export-proof", recordId);
  }

  async importProof(proofJson: string): Promise<InferenceRecord> {
    return this.ipcRenderer.invoke("trustless:import-proof", proofJson);
  }

  async pinRecord(recordId: string): Promise<void> {
    return this.ipcRenderer.invoke("trustless:pin-record", recordId);
  }

  async unpinRecord(recordId: string): Promise<void> {
    return this.ipcRenderer.invoke("trustless:unpin-record", recordId);
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async createBatchProof(recordIds: string[]): Promise<string> {
    return this.ipcRenderer.invoke("trustless:create-batch-proof", recordIds);
  }

  async verifyBatchProof(batchProofJson: string): Promise<{
    valid: boolean;
    verifiedCount: number;
    failedIds: string[];
  }> {
    return this.ipcRenderer.invoke("trustless:verify-batch-proof", batchProofJson);
  }

  // ============================================================================
  // Helia Node Status
  // ============================================================================

  async getHeliaStatus(): Promise<HeliaNodeStatus> {
    return this.ipcRenderer.invoke("trustless:helia-status");
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  async getStats(): Promise<InferenceStats> {
    return this.ipcRenderer.invoke("trustless:get-stats");
  }
}

// Export singleton instance
export const trustlessInferenceClient = TrustlessInferenceClient.getInstance();
