/**
 * Agent Memory Type Definitions
 * Long-Term Memory (cross-conversation) & Short-Term Memory (within-conversation)
 */

// ============================================================================
// Long-Term Memory — persists across conversations
// ============================================================================

export type LongTermMemoryCategory =
  | "fact"
  | "preference"
  | "instruction"
  | "context"
  | "skill"
  | "relationship";

export interface AgentMemoryConfig {
  /** Agent this config belongs to */
  agentId: number;

  /** Whether long-term memory is enabled */
  longTermEnabled: boolean;

  /** Maximum number of long-term memories to inject into context */
  longTermMaxContext: number;

  /** Whether short-term memory is enabled */
  shortTermEnabled: boolean;

  /** Maximum number of short-term entries per conversation */
  shortTermMaxEntries: number;

  /** Whether to auto-extract memories from conversations */
  autoExtract: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface LongTermMemory {
  id: number;
  agentId: number;
  category: LongTermMemoryCategory;
  content: string;
  /** Optional key for deduplication / lookup */
  key?: string;
  /** Relevance score 0-1 (higher = more contextually important) */
  importance: number;
  /** How many times this memory has been surfaced */
  accessCount: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Short-Term Memory — lives within a single conversation
// ============================================================================

export type ShortTermMemoryKind =
  | "scratchpad"
  | "variable"
  | "plan"
  | "note";

export interface ShortTermMemory {
  id: number;
  agentId: number;
  chatId: string;
  kind: ShortTermMemoryKind;
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// IPC Request / Response Types
// ============================================================================

export interface UpsertAgentMemoryConfigRequest {
  agentId: number;
  longTermEnabled?: boolean;
  longTermMaxContext?: number;
  shortTermEnabled?: boolean;
  shortTermMaxEntries?: number;
  autoExtract?: boolean;
}

export interface CreateLongTermMemoryRequest {
  agentId: number;
  category: LongTermMemoryCategory;
  content: string;
  key?: string;
  importance?: number;
}

export interface UpdateLongTermMemoryRequest {
  id: number;
  category?: LongTermMemoryCategory;
  content?: string;
  key?: string;
  importance?: number;
}

export interface SearchLongTermMemoryRequest {
  agentId: number;
  query: string;
  limit?: number;
  category?: LongTermMemoryCategory;
}

export interface SetShortTermMemoryRequest {
  agentId: number;
  chatId: string;
  kind: ShortTermMemoryKind;
  key: string;
  value: string;
}

export interface GetShortTermMemoriesRequest {
  agentId: number;
  chatId: string;
}

export interface DeleteShortTermMemoryRequest {
  agentId: number;
  chatId: string;
  key: string;
}

export interface ClearShortTermMemoryRequest {
  agentId: number;
  chatId: string;
}
