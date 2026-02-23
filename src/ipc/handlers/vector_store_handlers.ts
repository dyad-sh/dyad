/**
 * Vector Store IPC Handlers
 *
 * Exposes the VectorStoreService + sqlite-vec backend over IPC channels.
 * Channels:
 *   vector:init              — initialize the vector store service
 *   vector:create-collection — create a new vector collection
 *   vector:list-collections  — list all collections
 *   vector:get-collection    — get a collection by ID
 *   vector:delete-collection — delete a collection
 *   vector:add-documents     — add documents (auto-chunks + embeds)
 *   vector:delete-document   — remove a document from a collection
 *   vector:list-documents    — list documents in a collection
 *   vector:search            — KNN similarity search
 *   vector:rag               — full RAG query (retrieve + generate)
 *   vector:get-stats         — index stats for a collection
 *   vector:set-embedding-model — set the embedding model
 */

import { ipcMain } from "electron";
import log from "electron-log";

import { vectorStoreService } from "../../lib/vector_store_service";

import type {
  CollectionId,
  VectorSearchRequest,
  RAGRequest,
  ModelId,
  ChunkingConfig,
} from "@/types/sovereign_stack_types";

const logger = log.scope("vector_handlers");

export function registerVectorStoreHandlers(): void {
  // ── Initialize ──────────────────────────────────────────────────────────
  ipcMain.handle("vector:init", async () => {
    await vectorStoreService.initialize();
    return { success: true };
  });

  // ── Collections ─────────────────────────────────────────────────────────
  ipcMain.handle(
    "vector:create-collection",
    async (
      _event,
      params: {
        name: string;
        description?: string;
        dimension?: number;
        distanceMetric?: "cosine" | "euclidean" | "dot";
        chunkingConfig?: ChunkingConfig;
        metadata?: Record<string, unknown>;
      },
    ) => {
      return vectorStoreService.createCollection({
        ...params,
        backend: "sqlite-vec" as any,
      });
    },
  );

  ipcMain.handle("vector:list-collections", async () => {
    return vectorStoreService.listCollections();
  });

  ipcMain.handle("vector:get-collection", async (_event, id: string) => {
    return vectorStoreService.getCollection(id as CollectionId);
  });

  ipcMain.handle("vector:delete-collection", async (_event, id: string) => {
    await vectorStoreService.deleteCollection(id as CollectionId);
    return { success: true };
  });

  // ── Documents ───────────────────────────────────────────────────────────
  ipcMain.handle(
    "vector:add-documents",
    async (
      _event,
      args: {
        collectionId: string;
        documents: Array<{
          content: string;
          title?: string;
          source?: string;
          metadata?: Record<string, unknown>;
        }>;
      },
    ) => {
      return vectorStoreService.addDocuments(
        args.collectionId as CollectionId,
        args.documents,
      );
    },
  );

  ipcMain.handle(
    "vector:delete-document",
    async (_event, args: { collectionId: string; documentId: string }) => {
      await vectorStoreService.deleteDocument(
        args.collectionId as CollectionId,
        args.documentId,
      );
      return { success: true };
    },
  );

  ipcMain.handle(
    "vector:list-documents",
    async (_event, collectionId: string) => {
      return vectorStoreService.listDocuments(collectionId as CollectionId);
    },
  );

  // ── Search ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    "vector:search",
    async (
      _event,
      request: {
        collectionId: string;
        query: string;
        topK?: number;
        threshold?: number;
        filter?: Record<string, unknown>;
        includeMetadata?: boolean;
      },
    ) => {
      return vectorStoreService.search({
        collectionId: request.collectionId as CollectionId,
        query: request.query,
        topK: request.topK ?? 10,
        threshold: request.threshold,
        filter: request.filter,
        includeMetadata: request.includeMetadata,
      });
    },
  );

  // ── RAG ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "vector:rag",
    async (
      _event,
      request: {
        collectionId: string;
        query: string;
        modelId: string;
        topK?: number;
        threshold?: number;
        systemPrompt?: string;
        maxTokens?: number;
        temperature?: number;
      },
    ) => {
      return vectorStoreService.rag({
        collectionId: request.collectionId as CollectionId,
        collectionIds: [request.collectionId as CollectionId],
        query: request.query,
        modelId: request.modelId as ModelId,
        topK: request.topK,
        threshold: request.threshold,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      });
    },
  );

  // ── Stats ───────────────────────────────────────────────────────────────
  ipcMain.handle("vector:get-stats", async (_event, collectionId: string) => {
    const collection = vectorStoreService.getCollection(collectionId as CollectionId);
    if (!collection) throw new Error(`Collection not found: ${collectionId}`);
    return {
      documentCount: collection.documentCount,
      chunkCount: collection.chunkCount,
      vectorCount: collection.vectorCount ?? 0,
      dimension: collection.dimension,
      backend: collection.backend,
      distanceMetric: collection.distanceMetric,
    };
  });

  // ── Embedding model ─────────────────────────────────────────────────────
  ipcMain.handle("vector:set-embedding-model", async (_event, modelId: string) => {
    vectorStoreService.setEmbeddingModel(modelId as ModelId);
    return { success: true };
  });

  logger.info("Vector store IPC handlers registered");
}
