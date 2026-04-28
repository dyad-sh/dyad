/**
 * Offline Docs Hub IPC Client
 * Renderer-side API for offline documentation
 */

import type {
  CollectionId,
  DocId,
  DocCategory,
  DocSource,
  DocCollection,
  Document,
  SearchResult,
  DocStats,
  ImportProgress,
  DocsEvent,
} from "../lib/offline_docs_hub";

function getIpcRenderer() {
  return (window as any).electron?.ipcRenderer;
}

export const OfflineDocsClient = {
  // Initialization
  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("offline-docs:initialize");
  },

  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("offline-docs:shutdown");
  },

  // Bundled docs
  async getBundledDocs(): Promise<
    Array<{
      id: string;
      name: string;
      category: DocCategory;
      description: string;
      source: DocSource;
      sourceUrl?: string;
      icon: string;
    }>
  > {
    return getIpcRenderer()?.invoke("offline-docs:get-bundled");
  },

  // Collection management
  async createCollection(params: {
    name: string;
    description?: string;
    category: DocCategory;
    source: DocSource;
    sourceUrl?: string;
    version?: string;
    icon?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): Promise<DocCollection> {
    return getIpcRenderer()?.invoke("offline-docs:create-collection", params);
  },

  async getCollection(collectionId: CollectionId): Promise<DocCollection | null> {
    return getIpcRenderer()?.invoke("offline-docs:get-collection", { collectionId });
  },

  async listCollections(filters?: {
    category?: DocCategory;
    source?: DocSource;
    search?: string;
  }): Promise<DocCollection[]> {
    return getIpcRenderer()?.invoke("offline-docs:list-collections", filters);
  },

  async updateCollection(
    collectionId: CollectionId,
    updates: Partial<{
      name: string;
      description: string;
      version: string;
      icon: string;
      tags: string[];
      metadata: Record<string, any>;
    }>
  ): Promise<DocCollection | null> {
    return getIpcRenderer()?.invoke("offline-docs:update-collection", {
      collectionId,
      updates,
    });
  },

  async deleteCollection(collectionId: CollectionId): Promise<boolean> {
    return getIpcRenderer()?.invoke("offline-docs:delete-collection", { collectionId });
  },

  // Document management
  async getDocument(docId: DocId): Promise<Document | null> {
    return getIpcRenderer()?.invoke("offline-docs:get-document", { docId });
  },

  async listDocuments(
    collectionId: CollectionId,
    options?: { limit?: number; offset?: number }
  ): Promise<Document[]> {
    return getIpcRenderer()?.invoke("offline-docs:list-documents", {
      collectionId,
      ...options,
    });
  },

  async deleteDocument(docId: DocId): Promise<boolean> {
    return getIpcRenderer()?.invoke("offline-docs:delete-document", { docId });
  },

  // Search
  async search(
    query: string,
    options?: {
      collectionId?: CollectionId;
      category?: DocCategory;
      limit?: number;
    }
  ): Promise<SearchResult[]> {
    return getIpcRenderer()?.invoke("offline-docs:search", { query, ...options });
  },

  // Import
  async importFromFolder(
    collectionId: CollectionId,
    folderPath: string,
    options?: { extensions?: string[]; recursive?: boolean }
  ): Promise<number> {
    return getIpcRenderer()?.invoke("offline-docs:import-folder", {
      collectionId,
      folderPath,
      ...options,
    });
  },

  async importFromUrl(collectionId: CollectionId, url: string): Promise<number> {
    return getIpcRenderer()?.invoke("offline-docs:import-url", { collectionId, url });
  },

  async getImportProgress(collectionId: CollectionId): Promise<ImportProgress | null> {
    return getIpcRenderer()?.invoke("offline-docs:get-import-progress", { collectionId });
  },

  // Stats
  async getStats(): Promise<DocStats> {
    return getIpcRenderer()?.invoke("offline-docs:get-stats");
  },

  // Event subscription
  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("offline-docs:subscribe");
  },

  async unsubscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("offline-docs:unsubscribe");
  },

  onEvent(callback: (event: DocsEvent) => void): () => void {
    const handler = (_: any, event: DocsEvent) => {
      if (!event) return;
      callback(event);
    };
    getIpcRenderer()?.on("offline-docs:event", handler);
    return () => getIpcRenderer()?.removeListener("offline-docs:event", handler);
  },
};

export type {
  CollectionId,
  DocId,
  DocCategory,
  DocSource,
  DocCollection,
  Document,
  SearchResult,
  DocStats,
  ImportProgress,
  DocsEvent,
};
