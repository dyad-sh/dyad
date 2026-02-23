// =============================================================================
// Embedding Pipeline React Hooks — TanStack Query wrappers for embedding IPC
// =============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IpcClient } from "../ipc/ipc_client";
import type { ChunkingConfig } from "../types/sovereign_stack_types";

const ipc = IpcClient.getInstance();

// ---- Query Keys ----

export const embeddingKeys = {
  all: ["embedding-pipeline"] as const,
  status: () => [...embeddingKeys.all, "status"] as const,
  models: () => [...embeddingKeys.all, "models"] as const,
};

// ---- Init & Status ----

/** Initialize the embedding pipeline */
export function useEmbeddingInit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.embeddingInit(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: embeddingKeys.all });
      toast.success("Embedding pipeline initialized");
    },
    onError: (err: Error) =>
      toast.error(`Failed to initialize embedding pipeline: ${err.message}`),
  });
}

/** Get embedding pipeline status */
export function useEmbeddingStatus() {
  return useQuery({
    queryKey: embeddingKeys.status(),
    queryFn: () => ipc.embeddingGetStatus(),
    refetchInterval: 5_000,
  });
}

// ---- Models ----

/** Detect available embedding models */
export function useEmbeddingDetectModels() {
  return useQuery({
    queryKey: embeddingKeys.models(),
    queryFn: () => ipc.embeddingDetectModels(),
  });
}

/** Set the active embedding model */
export function useEmbeddingSetModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => ipc.embeddingSetModel(modelId),
    onSuccess: (model) => {
      qc.invalidateQueries({ queryKey: embeddingKeys.status() });
      toast.success(`Embedding model set: ${model.name}`);
    },
    onError: (err: Error) =>
      toast.error(`Failed to set embedding model: ${err.message}`),
  });
}

// ---- Ingestion ----

/** Ingest a single text document */
export function useIngestDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: {
      collectionId: string;
      content: string;
      title?: string;
      source?: string;
      metadata?: Record<string, unknown>;
      chunkingConfig?: ChunkingConfig;
    }) => ipc.embeddingIngestDocument(request),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: embeddingKeys.status() });
      toast.success(
        `Document ingested: ${result.chunkCount} chunks in ${result.durationMs}ms`,
      );
    },
    onError: (err: Error) =>
      toast.error(`Ingestion failed: ${err.message}`),
  });
}

/** Ingest a local file */
export function useIngestFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: {
      collectionId: string;
      filePath: string;
      metadata?: Record<string, unknown>;
      chunkingConfig?: ChunkingConfig;
    }) => ipc.embeddingIngestFile(request),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: embeddingKeys.status() });
      toast.success(
        `File ingested: ${result.chunkCount} chunks in ${result.durationMs}ms`,
      );
    },
    onError: (err: Error) =>
      toast.error(`File ingestion failed: ${err.message}`),
  });
}

/** Ingest from a URL */
export function useIngestUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: {
      collectionId: string;
      url: string;
      metadata?: Record<string, unknown>;
      chunkingConfig?: ChunkingConfig;
      extractText?: boolean;
    }) => ipc.embeddingIngestUrl(request),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: embeddingKeys.status() });
      toast.success(
        `URL ingested: ${result.chunkCount} chunks in ${result.durationMs}ms`,
      );
    },
    onError: (err: Error) =>
      toast.error(`URL ingestion failed: ${err.message}`),
  });
}

/** Batch ingest multiple documents */
export function useIngestBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: {
      collectionId: string;
      documents: Array<{
        content: string;
        title?: string;
        source?: string;
        metadata?: Record<string, unknown>;
      }>;
      chunkingConfig?: ChunkingConfig;
      concurrency?: number;
    }) => ipc.embeddingIngestBatch(request),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: embeddingKeys.status() });
      toast.success(
        `Batch complete: ${result.successful}/${result.total} documents, ${result.failed} failed`,
      );
    },
    onError: (err: Error) =>
      toast.error(`Batch ingestion failed: ${err.message}`),
  });
}

// ---- Retrieval ----

/** Retrieve relevant chunks for a query (mutation — user-triggered) */
export function useEmbeddingRetrieve() {
  return useMutation({
    mutationFn: (request: {
      collectionIds: string[];
      query: string;
      topK?: number;
      minScore?: number;
    }) => ipc.embeddingRetrieve(request),
    onError: (err: Error) =>
      toast.error(`Retrieval failed: ${err.message}`),
  });
}

/** Retrieve formatted context for chat (mutation — called per-message) */
export function useEmbeddingRetrieveForChat() {
  return useMutation({
    mutationFn: (args: {
      query: string;
      collectionIds: string[];
      topK?: number;
      minScore?: number;
    }) => ipc.embeddingRetrieveForChat(args),
  });
}

/** Generate embedding for a single text */
export function useEmbedQuery() {
  return useMutation({
    mutationFn: (query: string) => ipc.embeddingEmbedQuery(query),
  });
}

// ---- Control ----

/** Cancel all active ingestion operations */
export function useCancelAllIngestions() {
  return useMutation({
    mutationFn: () => ipc.embeddingCancelAll(),
    onSuccess: () => toast.info("All ingestion operations cancelled"),
  });
}
