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
  InferenceConversation,
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
  private conversations: Map<string, InferenceConversation> = new Map();

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
  // Conversation Operations
  // ============================================================================

  createConversation(params: {
    provider: LocalModelProvider;
    modelId: string;
    systemPrompt?: string;
    title?: string;
  }): InferenceConversation {
    const now = Date.now();
    const conversation: InferenceConversation = {
      id: uuidv4(),
      title: params.title || "New Conversation",
      provider: params.provider,
      modelId: params.modelId,
      systemPrompt: params.systemPrompt,
      messages: [],
      recordIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    logger.info("Created conversation", { id: conversation.id, title: conversation.title });
    return conversation;
  }

  getConversation(conversationId: string): InferenceConversation | null {
    return this.conversations.get(conversationId) ?? null;
  }

  listConversations(): InferenceConversation[] {
    return Array.from(this.conversations.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  deleteConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId)) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.conversations.delete(conversationId);
    logger.info("Deleted conversation", { id: conversationId });
  }

  updateConversation(
    conversationId: string,
    updates: { title?: string; systemPrompt?: string; provider?: LocalModelProvider; modelId?: string }
  ): InferenceConversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    if (updates.title !== undefined) conversation.title = updates.title;
    if (updates.systemPrompt !== undefined) conversation.systemPrompt = updates.systemPrompt;
    if (updates.provider !== undefined) conversation.provider = updates.provider;
    if (updates.modelId !== undefined) conversation.modelId = updates.modelId;
    conversation.updatedAt = Date.now();
    return conversation;
  }

  async sendMessage(
    conversationId: string,
    userMessage: string,
    config?: { temperature?: number; maxTokens?: number },
    skipVerification?: boolean
  ): Promise<{
    output: string;
    recordId?: string;
    cid?: string;
    verified?: boolean;
    tokens: number;
    timeMs: number;
  }> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Add user message to conversation
    conversation.messages.push({ role: "user", content: userMessage });
    conversation.updatedAt = Date.now();

    // Auto-title from first user message
    if (conversation.messages.filter((m) => m.role === "user").length === 1) {
      conversation.title = userMessage.slice(0, 60) + (userMessage.length > 60 ? "..." : "");
    }

    // Build full messages array including system prompt
    const allMessages: InferenceMessage[] = [];
    if (conversation.systemPrompt) {
      allMessages.push({ role: "system", content: conversation.systemPrompt });
    }
    allMessages.push(...conversation.messages);

    // Run inference with full conversation history
    const result = await this.runVerifiedInference(
      conversation.provider,
      conversation.modelId,
      userMessage,
      {
        systemPrompt: conversation.systemPrompt,
        messages: allMessages,
        config: config ? { options: config } : undefined,
        skipVerification,
      }
    );

    // Add assistant response
    conversation.messages.push({ role: "assistant", content: result.response.output });
    conversation.updatedAt = Date.now();

    if (result.record?.id) {
      conversation.recordIds.push(result.record.id);
    }

    return {
      output: result.response.output,
      recordId: result.record?.id,
      cid: result.record?.cid,
      verified: result.verification?.valid,
      tokens: result.response.totalTokens,
      timeMs: result.response.generationTimeMs,
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
