/**
 * IPC Handlers for Offline Documentation Hub
 */

import { ipcMain } from "electron";
import {
  getOfflineDocsHub,
  type CollectionId,
  type DocId,
  type DocCategory,
  type DocSource,
} from "../../lib/offline_docs_hub";

export function registerOfflineDocsHandlers(): void {
  const docsHub = getOfflineDocsHub();

  // Initialize
  ipcMain.handle("offline-docs:initialize", async () => {
    await docsHub.initialize();
    return { success: true };
  });

  // Shutdown
  ipcMain.handle("offline-docs:shutdown", async () => {
    await docsHub.shutdown();
    return { success: true };
  });

  // Get bundled docs list
  ipcMain.handle("offline-docs:get-bundled", async () => {
    return docsHub.getBundledDocs();
  });

  // Create collection
  ipcMain.handle(
    "offline-docs:create-collection",
    async (
      _,
      params: {
        name: string;
        description?: string;
        category: DocCategory;
        source: DocSource;
        sourceUrl?: string;
        version?: string;
        icon?: string;
        tags?: string[];
        metadata?: Record<string, any>;
      }
    ) => {
      return docsHub.createCollection(params);
    }
  );

  // Get collection
  ipcMain.handle(
    "offline-docs:get-collection",
    async (_, params: { collectionId: CollectionId }) => {
      return docsHub.getCollection(params.collectionId);
    }
  );

  // List collections
  ipcMain.handle(
    "offline-docs:list-collections",
    async (
      _,
      params?: {
        category?: DocCategory;
        source?: DocSource;
        search?: string;
      }
    ) => {
      return docsHub.listCollections(params);
    }
  );

  // Update collection
  ipcMain.handle(
    "offline-docs:update-collection",
    async (
      _,
      params: {
        collectionId: CollectionId;
        updates: Partial<{
          name: string;
          description: string;
          version: string;
          icon: string;
          tags: string[];
          metadata: Record<string, any>;
        }>;
      }
    ) => {
      return docsHub.updateCollection(params.collectionId, params.updates);
    }
  );

  // Delete collection
  ipcMain.handle(
    "offline-docs:delete-collection",
    async (_, params: { collectionId: CollectionId }) => {
      return docsHub.deleteCollection(params.collectionId);
    }
  );

  // Get document
  ipcMain.handle(
    "offline-docs:get-document",
    async (_, params: { docId: DocId }) => {
      return docsHub.getDocument(params.docId);
    }
  );

  // List documents
  ipcMain.handle(
    "offline-docs:list-documents",
    async (
      _,
      params: {
        collectionId: CollectionId;
        limit?: number;
        offset?: number;
      }
    ) => {
      return docsHub.listDocuments(params.collectionId, {
        limit: params.limit,
        offset: params.offset,
      });
    }
  );

  // Delete document
  ipcMain.handle(
    "offline-docs:delete-document",
    async (_, params: { docId: DocId }) => {
      return docsHub.deleteDocument(params.docId);
    }
  );

  // Search
  ipcMain.handle(
    "offline-docs:search",
    async (
      _,
      params: {
        query: string;
        collectionId?: CollectionId;
        category?: DocCategory;
        limit?: number;
      }
    ) => {
      return docsHub.search(params.query, {
        collectionId: params.collectionId,
        category: params.category,
        limit: params.limit,
      });
    }
  );

  // Import from local folder
  ipcMain.handle(
    "offline-docs:import-folder",
    async (
      _,
      params: {
        collectionId: CollectionId;
        folderPath: string;
        extensions?: string[];
        recursive?: boolean;
      }
    ) => {
      return docsHub.importFromLocalFolder(params.collectionId, params.folderPath, {
        extensions: params.extensions,
        recursive: params.recursive,
      });
    }
  );

  // Import from URL
  ipcMain.handle(
    "offline-docs:import-url",
    async (
      _,
      params: {
        collectionId: CollectionId;
        url: string;
      }
    ) => {
      return docsHub.importFromUrl(params.collectionId, params.url);
    }
  );

  // Get import progress
  ipcMain.handle(
    "offline-docs:get-import-progress",
    async (_, params: { collectionId: CollectionId }) => {
      return docsHub.getImportProgress(params.collectionId);
    }
  );

  // Get stats
  ipcMain.handle("offline-docs:get-stats", async () => {
    return docsHub.getStats();
  });

  // Subscribe to events
  const subscriptions = new Map<string, () => void>();

  ipcMain.handle("offline-docs:subscribe", (event) => {
    const webContentsId = event.sender.id.toString();

    // Cleanup existing subscription
    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
    }

    const unsubscribe = docsHub.subscribe((docsEvent) => {
      try {
        event.sender.send("offline-docs:event", docsEvent);
      } catch {
        // Window closed
        unsubscribe();
        subscriptions.delete(webContentsId);
      }
    });

    subscriptions.set(webContentsId, unsubscribe);
    return { success: true };
  });

  ipcMain.handle("offline-docs:unsubscribe", (event) => {
    const webContentsId = event.sender.id.toString();
    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
      subscriptions.delete(webContentsId);
    }
    return { success: true };
  });
}
