/**
 * Memory System IPC Client
 * Renderer-side API for persistent memory functionality
 */

import type { IpcRenderer } from "electron";

// =============================================================================
// TYPES (mirrored from memory_system.ts)
// =============================================================================

export type MemoryId = string & { __brand: "MemoryId" };
export type MemoryType = "fact" | "preference" | "code_pattern" | "project" | "conversation" | "skill" | "entity" | "relationship";
export type MemorySource = "user" | "assistant" | "system" | "observation" | "inference";
export type MemoryImportance = "critical" | "high" | "medium" | "low" | "trivial";

export interface Memory {
  id: MemoryId;
  type: MemoryType;
  content: string;
  summary?: string;
  source: MemorySource;
  importance: MemoryImportance;
  confidence: number;
  accessCount: number;
  lastAccessedAt: number;
  relatedMemories?: MemoryId[];
  tags: string[];
  entities: string[];
  appId?: number;
  chatId?: string;
  messageId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface MemoryQuery {
  query?: string;
  types?: MemoryType[];
  sources?: MemorySource[];
  tags?: string[];
  entities?: string[];
  appId?: number;
  minImportance?: MemoryImportance;
  minConfidence?: number;
  limit?: number;
  includeEmbeddings?: boolean;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  matchType: "semantic" | "keyword" | "exact" | "tag";
}

export interface MemoryStats {
  totalMemories: number;
  byType: Record<MemoryType, number>;
  byImportance: Record<MemoryImportance, number>;
  oldestMemory: number;
  newestMemory: number;
  totalAccessCount: number;
  storageSize: number;
}

export interface ConversationContext {
  id: string;
  messages: ContextMessage[];
  activeMemories: MemoryId[];
  workingContext: string;
  summary?: string;
}

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  memoryIds?: MemoryId[];
}

export interface UserProfile {
  id: string;
  name?: string;
  preferences: Record<string, unknown>;
  skills: string[];
  interests: string[];
  codeStyle: CodeStylePreferences;
  communicationStyle: CommunicationPreferences;
  createdAt: number;
  updatedAt: number;
}

export interface CodeStylePreferences {
  preferredLanguages: string[];
  frameworkPreferences: Record<string, string>;
  namingConventions: "camelCase" | "snake_case" | "PascalCase" | "kebab-case";
  indentStyle: "spaces" | "tabs";
  indentSize: number;
  preferredPatterns: string[];
}

export interface CommunicationPreferences {
  verbosity: "concise" | "detailed" | "balanced";
  technicalLevel: "beginner" | "intermediate" | "advanced" | "expert";
  preferredExamples: boolean;
  showReasoning: boolean;
}

export type MemoryEventType =
  | "memory:created"
  | "memory:updated"
  | "memory:deleted"
  | "context:updated"
  | "profile:updated"
  | "consolidation:complete";

export interface MemoryEvent {
  type: MemoryEventType;
  data?: any;
}

// =============================================================================
// CLIENT
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC Renderer not available");
    }
  }
  return ipcRenderer;
}

export const MemorySystemClient = {
  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:initialize");
  },

  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:shutdown");
  },

  // ---------------------------------------------------------------------------
  // MEMORY CRUD
  // ---------------------------------------------------------------------------

  async createMemory(params: {
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
  }): Promise<Memory> {
    return getIpcRenderer().invoke("memory:create", params);
  },

  async getMemory(id: MemoryId): Promise<Memory | null> {
    return getIpcRenderer().invoke("memory:get", id);
  },

  async updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<Memory | null> {
    return getIpcRenderer().invoke("memory:update", id, updates);
  },

  async deleteMemory(id: MemoryId): Promise<boolean> {
    return getIpcRenderer().invoke("memory:delete", id);
  },

  // ---------------------------------------------------------------------------
  // MEMORY SEARCH
  // ---------------------------------------------------------------------------

  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    return getIpcRenderer().invoke("memory:search", query);
  },

  async fullTextSearch(query: string, limit?: number): Promise<MemorySearchResult[]> {
    return getIpcRenderer().invoke("memory:fulltext-search", query, limit);
  },

  // ---------------------------------------------------------------------------
  // CONTEXT MANAGEMENT
  // ---------------------------------------------------------------------------

  async getContext(chatId: string): Promise<ConversationContext> {
    return getIpcRenderer().invoke("memory:get-context", chatId);
  },

  async addToContext(chatId: string, message: ContextMessage): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:add-to-context", chatId, message);
  },

  async clearContext(chatId: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:clear-context", chatId);
  },

  // ---------------------------------------------------------------------------
  // USER PROFILE
  // ---------------------------------------------------------------------------

  async getProfile(): Promise<UserProfile> {
    return getIpcRenderer().invoke("memory:get-profile");
  },

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    return getIpcRenderer().invoke("memory:update-profile", updates);
  },

  async learnPreference(key: string, value: unknown): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:learn-preference", key, value);
  },

  // ---------------------------------------------------------------------------
  // RELATIONSHIPS
  // ---------------------------------------------------------------------------

  async createRelationship(
    sourceId: MemoryId,
    targetId: MemoryId,
    type: string,
    strength?: number
  ): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:create-relationship", sourceId, targetId, type, strength);
  },

  async getRelatedMemories(id: MemoryId): Promise<Array<{ memory: Memory; relationship: string; strength: number }>> {
    return getIpcRenderer().invoke("memory:get-related", id);
  },

  // ---------------------------------------------------------------------------
  // MAINTENANCE
  // ---------------------------------------------------------------------------

  async consolidate(): Promise<{ merged: number; deleted: number }> {
    return getIpcRenderer().invoke("memory:consolidate");
  },

  async getStats(): Promise<MemoryStats> {
    return getIpcRenderer().invoke("memory:stats");
  },

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("memory:subscribe");
  },

  onEvent(callback: (event: MemoryEvent) => void): () => void {
    const handler = (_: unknown, event: MemoryEvent) => callback(event);
    getIpcRenderer().on("memory:event" as any, handler);
    return () => {
      getIpcRenderer().removeListener("memory:event" as any, handler);
    };
  },
};

export default MemorySystemClient;
