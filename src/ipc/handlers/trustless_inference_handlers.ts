/**
 * Trustless Inference IPC Handlers
 * Content-addressed verification for local AI inference using Helia/IPFS
 */

import { ipcMain } from "electron";
import log from "electron-log";

import { trustlessInferenceService } from "@/lib/trustless_inference_service";

import type {
  LocalModelProvider,
  LocalModelInfo,
  InferenceRecord,
  VerificationResult,
  HeliaNodeStatus,
  InferenceStats,
  InferenceMessage,
} from "@/types/trustless_inference";

const logger = log.scope("trustless_inference_handlers");

export function registerTrustlessInferenceHandlers(): void {
  // ============================================================================
  // Service Lifecycle
  // ============================================================================

  ipcMain.handle("trustless:initialize", async () => {
    logger.info("Initializing trustless inference service");
    await trustlessInferenceService.initialize();
    return { success: true };
  });

  ipcMain.handle("trustless:shutdown", async () => {
    logger.info("Shutting down trustless inference service");
    await trustlessInferenceService.shutdown();
    return { success: true };
  });

  // ============================================================================
  // Provider Management
  // ============================================================================

  ipcMain.handle(
    "trustless:check-providers",
    async (): Promise<Record<LocalModelProvider, boolean>> => {
      return trustlessInferenceService.checkProviders();
    }
  );

  ipcMain.handle(
    "trustless:list-models",
    async (): Promise<LocalModelInfo[]> => {
      return trustlessInferenceService.listModels();
    }
  );

  ipcMain.handle(
    "trustless:get-model-info",
    async (
      _,
      provider: LocalModelProvider,
      modelId: string
    ): Promise<LocalModelInfo | null> => {
      return trustlessInferenceService.getModelInfo(provider, modelId);
    }
  );

  // ============================================================================
  // Verified Inference
  // ============================================================================

  ipcMain.handle(
    "trustless:run-inference",
    async (
      _,
      params: {
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
      }
    ): Promise<{
      output: string;
      recordId?: string;
      cid?: string;
      verified?: boolean;
      tokens: number;
      timeMs: number;
    }> => {
      const { provider, modelId, prompt, systemPrompt, messages, config, skipVerification } =
        params;

      const result = await trustlessInferenceService.runVerifiedInference(
        provider,
        modelId,
        prompt,
        {
          systemPrompt,
          messages,
          config: config ? { options: config } : undefined,
          skipVerification,
        }
      );

      return {
        output: result.response.output,
        recordId: result.record?.id,
        cid: result.record?.cid,
        verified: result.verification?.valid,
        tokens: result.response.totalTokens,
        timeMs: result.response.generationTimeMs,
      };
    }
  );

  // Streaming inference (returns stream identifier)
  ipcMain.handle(
    "trustless:start-stream",
    async (
      event,
      params: {
        provider: LocalModelProvider;
        modelId: string;
        messages: InferenceMessage[];
        systemPrompt?: string;
        config?: {
          temperature?: number;
          maxTokens?: number;
        };
      }
    ): Promise<{ streamId: string }> => {
      const { provider, modelId, messages, systemPrompt, config } = params;
      const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Run streaming in background, send tokens via events
      (async () => {
        try {
          const stream = trustlessInferenceService.streamVerifiedInference(
            provider,
            modelId,
            messages,
            {
              systemPrompt,
              config: config ? { options: config } : undefined,
            }
          );

          for await (const chunk of stream) {
            if (chunk.type === "token") {
              event.sender.send(`trustless:stream-token:${streamId}`, {
                content: chunk.content,
              });
            } else if (chunk.type === "done") {
              event.sender.send(`trustless:stream-done:${streamId}`, {
                recordId: chunk.record?.id,
                cid: chunk.record?.cid,
              });
            }
          }
        } catch (error) {
          logger.error("Stream error:", error);
          event.sender.send(`trustless:stream-error:${streamId}`, {
            error: String(error),
          });
        }
      })();

      return { streamId };
    }
  );

  // ============================================================================
  // Verification Operations
  // ============================================================================

  ipcMain.handle(
    "trustless:verify-record",
    async (_, recordId: string): Promise<VerificationResult> => {
      return trustlessInferenceService.verifyRecord(recordId);
    }
  );

  ipcMain.handle(
    "trustless:get-record",
    async (_, recordId: string): Promise<InferenceRecord | null> => {
      return trustlessInferenceService.getRecord(recordId);
    }
  );

  ipcMain.handle(
    "trustless:list-records",
    async (_, limit?: number): Promise<InferenceRecord[]> => {
      return trustlessInferenceService.listRecords(limit);
    }
  );

  ipcMain.handle(
    "trustless:export-proof",
    async (_, recordId: string): Promise<string> => {
      return trustlessInferenceService.exportProof(recordId);
    }
  );

  ipcMain.handle(
    "trustless:import-proof",
    async (_, proofJson: string): Promise<InferenceRecord> => {
      return trustlessInferenceService.importProof(proofJson);
    }
  );

  ipcMain.handle("trustless:pin-record", async (_, recordId: string): Promise<void> => {
    await trustlessInferenceService.pinRecord(recordId);
  });

  ipcMain.handle("trustless:unpin-record", async (_, recordId: string): Promise<void> => {
    await trustlessInferenceService.unpinRecord(recordId);
  });

  // ============================================================================
  // Batch Operations
  // ============================================================================

  ipcMain.handle(
    "trustless:create-batch-proof",
    async (_, recordIds: string[]): Promise<string> => {
      return trustlessInferenceService.createBatchProof(recordIds);
    }
  );

  ipcMain.handle(
    "trustless:verify-batch-proof",
    async (
      _,
      batchProofJson: string
    ): Promise<{ valid: boolean; verifiedCount: number; failedIds: string[] }> => {
      return trustlessInferenceService.verifyBatchProof(batchProofJson);
    }
  );

  // ============================================================================
  // Helia Node Status
  // ============================================================================

  ipcMain.handle(
    "trustless:helia-status",
    async (): Promise<HeliaNodeStatus> => {
      return trustlessInferenceService.getHeliaStatus();
    }
  );

  // ============================================================================
  // Statistics
  // ============================================================================

  ipcMain.handle(
    "trustless:get-stats",
    async (): Promise<InferenceStats> => {
      return trustlessInferenceService.getStats();
    }
  );

  logger.info("Trustless inference handlers registered");
}
