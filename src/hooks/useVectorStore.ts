// =============================================================================
// Vector Store React Hooks — TanStack Query wrappers for sqlite-vec IPC calls
// =============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IpcClient } from "../ipc/ipc_client";
import type {
  VectorCollection,
  VectorDocument,
  VectorSearchRequest,
  VectorSearchResult,
  RAGRequest,
  RAGResponse,
  VectorBackend,
  DistanceMetric,
  ChunkingConfig,
} from "../types/sovereign_stack_types";

const ipc = IpcClient.getInstance();

// ---- Query Keys ----

export const vectorKeys = {
  all: ["vector-store"] as const,
  collections: () => [...vectorKeys.all, "collections"] as const,
  collection: (id: string) => [...vectorKeys.all, "collection", id] as const,
  documents: (collectionId: string) =>
    [...vectorKeys.all, "documents", collectionId] as const,
  stats: (collectionId: string) =>
    [...vectorKeys.all, "stats", collectionId] as const,
  search: (collectionId: string, query: string) =>
    [...vectorKeys.all, "search", collectionId, query] as const,
};

// ---- Init ----

/** Initialize the vector store backend (sqlite-vec) */
export function useVectorInit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.vectorInit(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vectorKeys.all });
      toast.success("Vector store initialized");
    },
    onError: (err: Error) =>
      toast.error(`Failed to initialize vector store: ${err.message}`),
  });
}

// ---- Collections ----

/** List all vector collections */
export function useVectorCollections() {
  return useQuery({
    queryKey: vectorKeys.collections(),
    queryFn: () => ipc.vectorListCollections(),
  });
}

/** Get a single vector collection */
export function useVectorCollection(id: string | undefined) {
  return useQuery({
    queryKey: vectorKeys.collection(id ?? ""),
    queryFn: () => ipc.vectorGetCollection(id!),
    enabled: !!id,
  });
}

/** Create a new vector collection */
export function useCreateVectorCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      name: string;
      description?: string;
      embeddingModel?: string;
      dimension?: number;
      distanceMetric?: DistanceMetric;
      backend?: VectorBackend;
      chunkingConfig?: ChunkingConfig;
    }) => ipc.vectorCreateCollection(params),
    onSuccess: (collection) => {
      qc.invalidateQueries({ queryKey: vectorKeys.collections() });
      toast.success(`Collection "${collection.name}" created`);
    },
    onError: (err: Error) =>
      toast.error(`Failed to create collection: ${err.message}`),
  });
}

/** Delete a vector collection */
export function useDeleteVectorCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.vectorDeleteCollection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vectorKeys.collections() });
      toast.success("Collection deleted");
    },
    onError: (err: Error) =>
      toast.error(`Failed to delete collection: ${err.message}`),
  });
}

// ---- Documents ----

/** List documents in a collection */
export function useVectorDocuments(collectionId: string | undefined) {
  return useQuery({
    queryKey: vectorKeys.documents(collectionId ?? ""),
    queryFn: () => ipc.vectorListDocuments(collectionId!),
    enabled: !!collectionId,
  });
}

/** Add documents to a collection */
export function useAddVectorDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      collectionId: string;
      documents: Array<{
        content: string;
        title?: string;
        metadata?: Record<string, unknown>;
        source?: string;
      }>;
    }) => ipc.vectorAddDocuments(args),
    onSuccess: (result, variables) => {
      qc.invalidateQueries({
        queryKey: vectorKeys.documents(variables.collectionId),
      });
      qc.invalidateQueries({
        queryKey: vectorKeys.stats(variables.collectionId),
      });
      qc.invalidateQueries({ queryKey: vectorKeys.collections() });
      toast.success(`Added ${result.added} document(s)`);
    },
    onError: (err: Error) =>
      toast.error(`Failed to add documents: ${err.message}`),
  });
}

/** Delete a document from a collection */
export function useDeleteVectorDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { collectionId: string; documentId: string }) =>
      ipc.vectorDeleteDocument(args),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({
        queryKey: vectorKeys.documents(variables.collectionId),
      });
      qc.invalidateQueries({
        queryKey: vectorKeys.stats(variables.collectionId),
      });
      qc.invalidateQueries({ queryKey: vectorKeys.collections() });
      toast.success("Document deleted");
    },
    onError: (err: Error) =>
      toast.error(`Failed to delete document: ${err.message}`),
  });
}

// ---- Search & RAG ----

/** Search vectors in a collection (mutation — user-triggered) */
export function useVectorSearch() {
  return useMutation({
    mutationFn: (request: VectorSearchRequest) => ipc.vectorSearch(request),
    onError: (err: Error) =>
      toast.error(`Vector search failed: ${err.message}`),
  });
}

/** Perform RAG query (mutation — user-triggered) */
export function useVectorRag() {
  return useMutation({
    mutationFn: (request: RAGRequest) => ipc.vectorRag(request),
    onError: (err: Error) =>
      toast.error(`RAG query failed: ${err.message}`),
  });
}

// ---- Stats ----

/** Get stats for a vector collection */
export function useVectorStats(collectionId: string | undefined) {
  return useQuery({
    queryKey: vectorKeys.stats(collectionId ?? ""),
    queryFn: () => ipc.vectorGetStats(collectionId!),
    enabled: !!collectionId,
    refetchInterval: 10_000,
  });
}

// ---- Embedding Model ----

/** Set the embedding model used by the vector store */
export function useSetEmbeddingModel() {
  return useMutation({
    mutationFn: (modelId: string) => ipc.vectorSetEmbeddingModel(modelId),
    onSuccess: () => toast.success("Embedding model updated"),
    onError: (err: Error) =>
      toast.error(`Failed to set embedding model: ${err.message}`),
  });
}
