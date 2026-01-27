/**
 * Memory System IPC Handlers
 * Connect renderer to persistent memory functionality
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  memorySystem,
  type MemoryId,
  type MemoryType,
  type MemorySource,
  type MemoryImportance,
  type MemoryQuery,
  type Memory,
  type ContextMessage,
  type UserProfile,
} from "@/lib/memory_system";

const logger = log.scope("memory_handlers");

// =============================================================================
// IPC HANDLER REGISTRATION
// =============================================================================

export function registerMemorySystemHandlers(): void {
  logger.info("Registering Memory System IPC handlers");

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:initialize", async () => {
    await memorySystem.initialize();
    return { success: true };
  });

  ipcMain.handle("memory:shutdown", async () => {
    await memorySystem.shutdown();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // MEMORY CRUD
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:create", async (_, params: {
    type: MemoryType;
    content: string;
    summary?: string;
    source?: MemorySource;
    importance?: MemoryImportance;
    confidence?: number;
    tags?: string[];
    entities?: string[];
    appId?: number;
    chatId?: string;
    messageId?: string;
    relatedMemories?: MemoryId[];
    expiresAt?: number;
  }) => {
    return memorySystem.createMemory(params);
  });

  ipcMain.handle("memory:get", async (_, id: MemoryId) => {
    return memorySystem.getMemory(id);
  });

  ipcMain.handle("memory:update", async (_, id: MemoryId, updates: Partial<Memory>) => {
    return memorySystem.updateMemory(id, updates);
  });

  ipcMain.handle("memory:delete", async (_, id: MemoryId) => {
    return memorySystem.deleteMemory(id);
  });

  // ---------------------------------------------------------------------------
  // MEMORY SEARCH
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:search", async (_, query: MemoryQuery) => {
    return memorySystem.search(query);
  });

  ipcMain.handle("memory:fulltext-search", async (_, query: string, limit?: number) => {
    return memorySystem.fullTextSearch(query, limit);
  });

  // ---------------------------------------------------------------------------
  // CONTEXT MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:get-context", async (_, chatId: string) => {
    return memorySystem.getOrCreateContext(chatId);
  });

  ipcMain.handle("memory:add-to-context", async (_, chatId: string, message: ContextMessage) => {
    await memorySystem.addToContext(chatId, message);
    return { success: true };
  });

  ipcMain.handle("memory:clear-context", async (_, chatId: string) => {
    await memorySystem.clearContext(chatId);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // USER PROFILE
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:get-profile", async () => {
    return memorySystem.getUserProfile();
  });

  ipcMain.handle("memory:update-profile", async (_, updates: Partial<UserProfile>) => {
    return memorySystem.updateUserProfile(updates);
  });

  ipcMain.handle("memory:learn-preference", async (_, key: string, value: unknown) => {
    await memorySystem.learnPreference(key, value);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // RELATIONSHIPS
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:create-relationship", async (_, 
    sourceId: MemoryId, 
    targetId: MemoryId, 
    type: string, 
    strength?: number
  ) => {
    await memorySystem.createRelationship(sourceId, targetId, type, strength);
    return { success: true };
  });

  ipcMain.handle("memory:get-related", async (_, id: MemoryId) => {
    return memorySystem.getRelatedMemories(id);
  });

  // ---------------------------------------------------------------------------
  // MAINTENANCE
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:consolidate", async () => {
    return memorySystem.consolidate();
  });

  ipcMain.handle("memory:stats", async () => {
    return memorySystem.getStats();
  });

  // ---------------------------------------------------------------------------
  // EVENT FORWARDING
  // ---------------------------------------------------------------------------

  ipcMain.handle("memory:subscribe", async (event) => {
    const sender = event.sender;
    
    memorySystem.on("memory:created", (data) => {
      sender.send("memory:event", { type: "memory:created", data });
    });
    
    memorySystem.on("memory:updated", (data) => {
      sender.send("memory:event", { type: "memory:updated", data });
    });
    
    memorySystem.on("memory:deleted", (data) => {
      sender.send("memory:event", { type: "memory:deleted", data });
    });
    
    memorySystem.on("context:updated", (data) => {
      sender.send("memory:event", { type: "context:updated", data });
    });
    
    memorySystem.on("profile:updated", (data) => {
      sender.send("memory:event", { type: "profile:updated", data });
    });
    
    memorySystem.on("consolidation:complete", (data) => {
      sender.send("memory:event", { type: "consolidation:complete", data });
    });
    
    return { success: true };
  });

  logger.info("Memory System IPC handlers registered");
}

export default registerMemorySystemHandlers;
