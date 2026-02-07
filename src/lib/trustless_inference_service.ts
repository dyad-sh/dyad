/**
 * Trustless Inference Service
 * Combines local model inference with content-addressed verification
 */

import { v4 as uuidv4 } from "uuid";
import log from "electron-log";

import { localModelService } from "@/lib/local_model_service";
import { heliaVerificationService } from "@/lib/helia_verification_service";

import type {
  LocalModelProvider,
  LocalModelInfo,
  LocalModelConfig,
  InferenceRequest,
  InferenceResponse,
  InferenceRecord,
  VerificationResult,
  InferenceStats,
  InferenceMessage,
  HeliaNodeStatus,
} from "@/types/trustless_inference";

const logger = log.scope("trustless_inference");

// Extended config for trustless service
interface TrustlessServiceConfig {
  enableVerification: boolean;
  autoPin: boolean;
  maxRecordsInMemory: number;
  providers: LocalModelProvider[];
}

// ============================================================================
// Trustless Inference Service
// ============================================================================

class TrustlessInferenceService {
  private config: TrustlessServiceConfig;
  private inferenceHistory: InferenceRecord[] = [];

  constructor(config?: Partial<TrustlessServiceConfig>) {
    this.config = {
      enableVerification: true,
      autoPin: false,
      maxRecordsInMemory: 1000,
      providers: ["ollama", "lmstudio"],
      ...config,
    };
  }

  // ============================================================================
  // Service Lifecycle
  // ============================================================================

  async initialize(): Promise<void> {
    logger.info("Initializing trustless inference service");

    if (this.config.enableVerification) {
      try {
        await heliaVerificationService.start();
      } catch (error) {
        logger.warn("Helia failed to start — verification features disabled", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Load existing records (best-effort)
    try {
      this.inferenceHistory = await heliaVerificationService.listInferenceRecords();
    } catch {
      this.inferenceHistory = [];
    }
    
    logger.info("Trustless inference service initialized", {
      verification: this.config.enableVerification,
      historySize: this.inferenceHistory.length,
    });
  }

  async shutdown(): Promise<void> {
    if (this.config.enableVerification) {
      await heliaVerificationService.stop();
    }
    logger.info("Trustless inference service shut down");
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  async checkProviders(): Promise<Record<LocalModelProvider, boolean>> {
    const status: Record<LocalModelProvider, boolean> = {
      ollama: false,
      lmstudio: false,
      llamacpp: false,
      vllm: false,
    };

    const available = await localModelService.getAvailableProviders();
    for (const provider of available) {
      status[provider] = true;
    }

    return status;
  }

  async listModels(): Promise<LocalModelInfo[]> {
    return localModelService.listAllModels();
  }

  async getModelInfo(
    provider: LocalModelProvider,
    modelId: string
  ): Promise<LocalModelInfo | null> {
    return localModelService.getModelInfo(provider, modelId);
  }

  // ============================================================================
  // Verified Inference
  // ============================================================================

  async runVerifiedInference(
    provider: LocalModelProvider,
    modelId: string,
    prompt: string,
    options?: {
      systemPrompt?: string;
      messages?: InferenceMessage[];
      config?: Partial<LocalModelConfig>;
      skipVerification?: boolean;
    }
  ): Promise<{
    response: InferenceResponse;
    record?: InferenceRecord;
    verification?: VerificationResult;
  }> {
    const requestId = uuidv4();
    const timestamp = Date.now();

    // Build model config
    // The handler sends { options: { temperature, maxTokens, ... } }
    // but Ollama uses numPredict, so map maxTokens → numPredict
    const opts = options?.config?.options as Record<string, unknown> | undefined;
    const modelConfig: LocalModelConfig = {
      modelId,
      provider,
      baseUrl: provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234",
      options: {
        temperature: (opts?.temperature as number) ?? 0.7,
        numPredict: (opts?.numPredict as number) ?? (opts?.maxTokens as number) ?? 2048,
        topP: opts?.topP as number | undefined,
        topK: opts?.topK as number | undefined,
        seed: opts?.seed as number | undefined,
        repeatPenalty: opts?.repeatPenalty as number | undefined,
        stop: opts?.stop as string[] | undefined,
      },
    };

    const request: InferenceRequest = {
      id: requestId,
      prompt,
      systemPrompt: options?.systemPrompt,
      messages: options?.messages,
      modelConfig,
      timestamp,
    };

    logger.info("Running verified inference", {
      id: requestId,
      provider,
      model: modelId,
    });

    // Get model info for verification
    const modelInfo = await this.getModelInfo(provider, modelId);
    if (!modelInfo) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }

    // Run inference using the service
    const response = await localModelService.chat(request);

    // Skip verification if requested or disabled
    if (options?.skipVerification || !this.config.enableVerification) {
      logger.info("Inference complete (unverified)", {
        id: requestId,
        tokens: response.totalTokens,
        timeMs: response.generationTimeMs,
      });

      return { response };
    }

    // Attempt Helia verification — best-effort, never blocks inference result
    let record: InferenceRecord | undefined;
    let verification: VerificationResult | undefined;

    try {
      const proof = await heliaVerificationService.createInferenceProof(
        request,
        response,
        modelInfo
      );

      record = await heliaVerificationService.storeInferenceRecord(
        request,
        response,
        proof
      );

      // Auto-pin if configured
      if (this.config.autoPin) {
        await heliaVerificationService.pinRecord(record.id);
      }

      // Verify the record
      verification = await heliaVerificationService.verifyInferenceRecord(record.id);

      // Update local history
      this.inferenceHistory.unshift(record);
      if (this.inferenceHistory.length > this.config.maxRecordsInMemory) {
        this.inferenceHistory = this.inferenceHistory.slice(0, this.config.maxRecordsInMemory);
      }

      logger.info("Verified inference complete", {
        id: requestId,
        cid: record.cid,
        valid: verification.valid,
        tokens: response.totalTokens,
        timeMs: response.generationTimeMs,
      });
    } catch (verificationError) {
      logger.warn("Helia verification unavailable — returning inference result without proof", {
        id: requestId,
        error: verificationError instanceof Error ? verificationError.message : String(verificationError),
      });
    }

    return { response, record, verification };
  }

  // ============================================================================
  // Streaming Inference with Verification
  // ============================================================================

  async *streamVerifiedInference(
    provider: LocalModelProvider,
    modelId: string,
    messages: InferenceMessage[],
    options?: {
      systemPrompt?: string;
      config?: Partial<LocalModelConfig>;
    }
  ): AsyncGenerator<
    { type: "token"; content: string } | { type: "done"; record?: InferenceRecord },
    void,
    unknown
  > {
    const requestId = uuidv4();
    const timestamp = Date.now();
    const collectedChunks: string[] = [];

    const streamOpts = options?.config?.options as Record<string, unknown> | undefined;
    const modelConfig: LocalModelConfig = {
      modelId,
      provider,
      baseUrl: provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234",
      options: {
        temperature: (streamOpts?.temperature as number) ?? 0.7,
        numPredict: (streamOpts?.numPredict as number) ?? (streamOpts?.maxTokens as number) ?? 2048,
      },
    };

    const request: InferenceRequest = {
      id: requestId,
      prompt: messages[messages.length - 1]?.content || "",
      systemPrompt: options?.systemPrompt,
      messages,
      modelConfig,
      timestamp,
    };

    // Stream tokens using callback-based API
    const streamPromise = localModelService.streamChat(request, (chunk: string) => {
      collectedChunks.push(chunk);
    });

    // Poll for new chunks and yield them
    let lastIndex = 0;
    const pollInterval = 10; // ms
    
    while (true) {
      // Check for new chunks
      while (lastIndex < collectedChunks.length) {
        yield { type: "token", content: collectedChunks[lastIndex] };
        lastIndex++;
      }

      // Check if stream is done by using Promise.race with a small delay
      const streamDone = await Promise.race([
        streamPromise.then(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), pollInterval))
      ]);

      if (streamDone) {
        // Yield any remaining chunks
        while (lastIndex < collectedChunks.length) {
          yield { type: "token", content: collectedChunks[lastIndex] };
          lastIndex++;
        }
        break;
      }
    }

    const response = await streamPromise;

    // Get model info for verification
    const modelInfo = await this.getModelInfo(provider, modelId);
    
    if (!this.config.enableVerification || !modelInfo) {
      yield { type: "done" };
      return;
    }

    // Attempt Helia verification — best-effort, never blocks stream result
    let record: InferenceRecord | undefined;
    try {
      const proof = await heliaVerificationService.createInferenceProof(
        request,
        response,
        modelInfo
      );

      record = await heliaVerificationService.storeInferenceRecord(
        request,
        response,
        proof
      );

      this.inferenceHistory.unshift(record);
    } catch (verificationError) {
      logger.warn("Helia verification unavailable after stream — returning result without proof", {
        error: verificationError instanceof Error ? verificationError.message : String(verificationError),
      });
    }

    yield { type: "done", record };
  }

  // ============================================================================
  // Verification Operations
  // ============================================================================

  async verifyRecord(recordId: string): Promise<VerificationResult> {
    return heliaVerificationService.verifyInferenceRecord(recordId);
  }

  async getRecord(recordId: string): Promise<InferenceRecord | null> {
    return heliaVerificationService.getInferenceRecord(recordId);
  }

  async listRecords(limit?: number): Promise<InferenceRecord[]> {
    const records = await heliaVerificationService.listInferenceRecords();
    return limit ? records.slice(0, limit) : records;
  }

  async exportProof(recordId: string): Promise<string> {
    return heliaVerificationService.exportProof(recordId);
  }

  async importProof(proofJson: string): Promise<InferenceRecord> {
    const record = await heliaVerificationService.importProof(proofJson);
    this.inferenceHistory.unshift(record);
    return record;
  }

  async pinRecord(recordId: string): Promise<void> {
    await heliaVerificationService.pinRecord(recordId);
  }

  async unpinRecord(recordId: string): Promise<void> {
    await heliaVerificationService.unpinRecord(recordId);
  }

  // ============================================================================
  // Helia Node Status
  // ============================================================================

  async getHeliaStatus(): Promise<HeliaNodeStatus> {
    return heliaVerificationService.getStatus();
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  async getStats(): Promise<InferenceStats> {
    const heliaStats = await heliaVerificationService.getStats();

    return {
      totalInferences: heliaStats.totalRecords,
      verifiedInferences: heliaStats.verifiedRecords,
      pinnedRecords: heliaStats.pinnedRecords,
      storageUsedBytes: 0,
      modelUsage: heliaStats.modelUsage,
      averageGenerationTimeMs: heliaStats.averageGenerationTimeMs,
    };
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async createBatchProof(recordIds: string[]): Promise<string> {
    const merkleRoot = await heliaVerificationService.createMerkleRoot(recordIds);
    
    const batchProof = {
      type: "batch-inference-proof",
      version: "1.0.0",
      recordIds,
      merkleRoot,
      recordCount: recordIds.length,
      createdAt: Date.now(),
    };

    return JSON.stringify(batchProof, null, 2);
  }

  async verifyBatchProof(batchProofJson: string): Promise<{
    valid: boolean;
    verifiedCount: number;
    failedIds: string[];
  }> {
    const batchProof = JSON.parse(batchProofJson);
    const { recordIds, merkleRoot } = batchProof;

    // Verify merkle root
    const computedRoot = await heliaVerificationService.createMerkleRoot(recordIds);
    if (computedRoot !== merkleRoot) {
      return { valid: false, verifiedCount: 0, failedIds: recordIds };
    }

    // Verify each record
    const failedIds: string[] = [];
    for (const id of recordIds) {
      const result = await this.verifyRecord(id);
      if (!result.valid) {
        failedIds.push(id);
      }
    }

    return {
      valid: failedIds.length === 0,
      verifiedCount: recordIds.length - failedIds.length,
      failedIds,
    };
  }
}

// Export singleton
export const trustlessInferenceService = new TrustlessInferenceService();
