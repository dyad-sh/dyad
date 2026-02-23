/**
 * Embedding Pipeline IPC Handlers
 *
 * Exposes the EmbeddingPipeline over IPC channels:
 *   embedding:init              — initialize the pipeline + detect models
 *   embedding:detect-models     — re-scan for available embedding models
 *   embedding:set-model         — choose an embedding model
 *   embedding:get-status        — pipeline status (active model, ingestion count, etc.)
 *   embedding:ingest-document   — ingest a single text document
 *   embedding:ingest-file       — ingest a file from local filesystem
 *   embedding:ingest-url        — fetch + ingest a URL
 *   embedding:ingest-batch      — batch ingest multiple documents
 *   embedding:retrieve          — retrieve relevant chunks for a query
 *   embedding:retrieve-for-chat — retrieve formatted context for chat injection
 *   embedding:embed-query       — generate embedding for a single query
 *   embedding:cancel-all        — cancel all active ingestion operations
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  embeddingPipeline,
  type IngestDocumentRequest,
  type IngestFileRequest,
  type IngestUrlRequest,
  type IngestBatchRequest,
  type RetrievalRequest,
} from "../../lib/embedding_pipeline";

const logger = log.scope("embedding_pipeline_handlers");

export function registerEmbeddingPipelineHandlers(): void {
  logger.info("Registering embedding pipeline IPC handlers");

  // --- Init & Status ---

  ipcMain.handle("embedding:init", async () => {
    return embeddingPipeline.initialize();
  });

  ipcMain.handle("embedding:detect-models", async () => {
    return embeddingPipeline.detectEmbeddingModels();
  });

  ipcMain.handle("embedding:set-model", async (_event, modelId: string) => {
    return embeddingPipeline.setEmbeddingModel(modelId);
  });

  ipcMain.handle("embedding:get-status", async () => {
    return embeddingPipeline.getStatus();
  });

  // --- Ingestion ---

  ipcMain.handle(
    "embedding:ingest-document",
    async (_event, request: IngestDocumentRequest) => {
      return embeddingPipeline.ingestDocument(request);
    },
  );

  ipcMain.handle(
    "embedding:ingest-file",
    async (_event, request: IngestFileRequest) => {
      return embeddingPipeline.ingestFile(request);
    },
  );

  ipcMain.handle(
    "embedding:ingest-url",
    async (_event, request: IngestUrlRequest) => {
      return embeddingPipeline.ingestUrl(request);
    },
  );

  ipcMain.handle(
    "embedding:ingest-batch",
    async (_event, request: IngestBatchRequest) => {
      return embeddingPipeline.ingestBatch(request);
    },
  );

  // --- Retrieval ---

  ipcMain.handle(
    "embedding:retrieve",
    async (_event, request: RetrievalRequest) => {
      return embeddingPipeline.retrieve(request);
    },
  );

  ipcMain.handle(
    "embedding:retrieve-for-chat",
    async (
      _event,
      args: {
        query: string;
        collectionIds: string[];
        topK?: number;
        minScore?: number;
      },
    ) => {
      return embeddingPipeline.retrieveForChat(args.query, args.collectionIds, {
        topK: args.topK,
        minScore: args.minScore,
      });
    },
  );

  // --- Embedding ---

  ipcMain.handle("embedding:embed-query", async (_event, query: string) => {
    return embeddingPipeline.embedQuery(query);
  });

  // --- Control ---

  ipcMain.handle("embedding:cancel-all", async () => {
    embeddingPipeline.cancelAll();
    return { cancelled: true };
  });
}
