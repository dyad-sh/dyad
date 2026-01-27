/**
 * Offline Docs Hub React Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  OfflineDocsClient,
  type CollectionId,
  type DocId,
  type DocCategory,
  type DocSource,
  type DocsEvent,
} from "../ipc/offline_docs_client";

const QUERY_KEYS = {
  stats: ["offline-docs", "stats"],
  bundled: ["offline-docs", "bundled"],
  collections: (filters?: any) => ["offline-docs", "collections", filters],
  collection: (id: CollectionId) => ["offline-docs", "collection", id],
  documents: (collectionId: CollectionId, options?: any) => [
    "offline-docs",
    "documents",
    collectionId,
    options,
  ],
  document: (id: DocId) => ["offline-docs", "document", id],
  search: (query: string, options?: any) => ["offline-docs", "search", query, options],
};

// =============================================================================
// INITIALIZATION HOOK
// =============================================================================

export function useOfflineDocs() {
  const queryClient = useQueryClient();
  const [docsEvent, setDocsEvent] = useState<DocsEvent | null>(null);

  useEffect(() => {
    OfflineDocsClient.initialize();
    OfflineDocsClient.subscribe();

    const unsubscribe = OfflineDocsClient.onEvent((event) => {
      setDocsEvent(event);

      // Invalidate relevant queries based on event type
      switch (event.type) {
        case "collection:created":
        case "collection:updated":
        case "collection:deleted":
          queryClient.invalidateQueries({ queryKey: ["offline-docs", "collections"] });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
          if (event.collectionId) {
            queryClient.invalidateQueries({
              queryKey: QUERY_KEYS.collection(event.collectionId),
            });
          }
          break;
        case "document:added":
        case "document:updated":
        case "document:deleted":
          if (event.collectionId) {
            queryClient.invalidateQueries({
              queryKey: ["offline-docs", "documents", event.collectionId],
            });
            queryClient.invalidateQueries({
              queryKey: QUERY_KEYS.collection(event.collectionId),
            });
          }
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
          break;
        case "import:complete":
          if (event.collectionId) {
            queryClient.invalidateQueries({
              queryKey: ["offline-docs", "documents", event.collectionId],
            });
            queryClient.invalidateQueries({
              queryKey: QUERY_KEYS.collection(event.collectionId),
            });
          }
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
          break;
      }
    });

    return () => {
      unsubscribe();
      OfflineDocsClient.unsubscribe();
    };
  }, [queryClient]);

  return { docsEvent };
}

// =============================================================================
// STATS HOOK
// =============================================================================

export function useDocsStats() {
  return useQuery({
    queryKey: QUERY_KEYS.stats,
    queryFn: () => OfflineDocsClient.getStats(),
  });
}

// =============================================================================
// BUNDLED DOCS HOOK
// =============================================================================

export function useBundledDocs() {
  return useQuery({
    queryKey: QUERY_KEYS.bundled,
    queryFn: () => OfflineDocsClient.getBundledDocs(),
  });
}

// =============================================================================
// COLLECTION HOOKS
// =============================================================================

export function useCollections(filters?: {
  category?: DocCategory;
  source?: DocSource;
  search?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.collections(filters),
    queryFn: () => OfflineDocsClient.listCollections(filters),
  });
}

export function useCollection(collectionId: CollectionId | null) {
  return useQuery({
    queryKey: QUERY_KEYS.collection(collectionId!),
    queryFn: () => OfflineDocsClient.getCollection(collectionId!),
    enabled: !!collectionId,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      name: string;
      description?: string;
      category: DocCategory;
      source: DocSource;
      sourceUrl?: string;
      version?: string;
      icon?: string;
      tags?: string[];
    }) => OfflineDocsClient.createCollection(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offline-docs", "collections"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

export function useUpdateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      collectionId,
      updates,
    }: {
      collectionId: CollectionId;
      updates: Partial<{
        name: string;
        description: string;
        version: string;
        icon: string;
        tags: string[];
      }>;
    }) => OfflineDocsClient.updateCollection(collectionId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["offline-docs", "collections"] });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.collection(variables.collectionId),
      });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (collectionId: CollectionId) =>
      OfflineDocsClient.deleteCollection(collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offline-docs", "collections"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

// =============================================================================
// DOCUMENT HOOKS
// =============================================================================

export function useDocuments(
  collectionId: CollectionId | null,
  options?: { limit?: number; offset?: number }
) {
  return useQuery({
    queryKey: QUERY_KEYS.documents(collectionId!, options),
    queryFn: () => OfflineDocsClient.listDocuments(collectionId!, options),
    enabled: !!collectionId,
  });
}

export function useDocument(docId: DocId | null) {
  return useQuery({
    queryKey: QUERY_KEYS.document(docId!),
    queryFn: () => OfflineDocsClient.getDocument(docId!),
    enabled: !!docId,
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (docId: DocId) => OfflineDocsClient.deleteDocument(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offline-docs", "documents"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

// =============================================================================
// SEARCH HOOK
// =============================================================================

export function useDocsSearch(
  query: string,
  options?: {
    collectionId?: CollectionId;
    category?: DocCategory;
    limit?: number;
  }
) {
  return useQuery({
    queryKey: QUERY_KEYS.search(query, options),
    queryFn: () => OfflineDocsClient.search(query, options),
    enabled: query.length >= 2,
  });
}

// =============================================================================
// IMPORT HOOKS
// =============================================================================

export function useImportFromFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      collectionId,
      folderPath,
      options,
    }: {
      collectionId: CollectionId;
      folderPath: string;
      options?: { extensions?: string[]; recursive?: boolean };
    }) => OfflineDocsClient.importFromFolder(collectionId, folderPath, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["offline-docs", "documents", variables.collectionId],
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.collection(variables.collectionId),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

export function useImportFromUrl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      collectionId,
      url,
    }: {
      collectionId: CollectionId;
      url: string;
    }) => OfflineDocsClient.importFromUrl(collectionId, url),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["offline-docs", "documents", variables.collectionId],
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.collection(variables.collectionId),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

// =============================================================================
// COMBINED MANAGER HOOK
// =============================================================================

export function useOfflineDocsManager() {
  const { docsEvent } = useOfflineDocs();
  const { data: stats } = useDocsStats();
  const { data: bundledDocs } = useBundledDocs();
  
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const deleteDocument = useDeleteDocument();
  const importFromFolder = useImportFromFolder();
  const importFromUrl = useImportFromUrl();

  return {
    // State
    docsEvent,
    stats,
    bundledDocs: bundledDocs || [],

    // Collection operations
    createCollection: createCollection.mutateAsync,
    updateCollection: updateCollection.mutateAsync,
    deleteCollection: deleteCollection.mutateAsync,

    // Document operations
    deleteDocument: deleteDocument.mutateAsync,

    // Import operations
    importFromFolder: importFromFolder.mutateAsync,
    importFromUrl: importFromUrl.mutateAsync,

    // Mutation states
    isCreatingCollection: createCollection.isPending,
    isUpdatingCollection: updateCollection.isPending,
    isDeletingCollection: deleteCollection.isPending,
    isDeletingDocument: deleteDocument.isPending,
    isImporting: importFromFolder.isPending || importFromUrl.isPending,
  };
}
