/**
 * Persistent AI Memory System
 * Long-term memory that persists across sessions
 * 
 * Features:
 * - Short-term memory (conversation context)
 * - Long-term memory (facts, preferences, code patterns)
 * - Episodic memory (past interactions/projects)
 * - Working memory (current task context)
 * - Memory consolidation (sleep/merge)
 * - Memory search and retrieval
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import Database, { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "events";

const logger = log.scope("memory_system");

// =============================================================================
// TYPES
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
  embedding?: number[];
  
  // Metadata
  source: MemorySource;
  importance: MemoryImportance;
  confidence: number;        // 0-1
  accessCount: number;
  lastAccessedAt: number;
  
  // Relationships
  relatedMemories?: MemoryId[];
  tags: string[];
  entities: string[];        // Named entities (people, projects, etc.)
  
  // Context
  appId?: number;
  chatId?: string;
  messageId?: string;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;        // For temporary memories
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

// =============================================================================
// CONSTANTS
// =============================================================================

const MEMORY_DIR = path.join(app.getPath("userData"), "memory");
const DB_PATH = path.join(MEMORY_DIR, "memory.db");
const EMBEDDINGS_DIMENSION = 384;

const IMPORTANCE_WEIGHTS: Record<MemoryImportance, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  trivial: 0.1,
};

const DEFAULT_USER_PROFILE: UserProfile = {
  id: "default",
  preferences: {},
  skills: [],
  interests: [],
  codeStyle: {
    preferredLanguages: ["typescript", "javascript"],
    frameworkPreferences: {},
    namingConventions: "camelCase",
    indentStyle: "spaces",
    indentSize: 2,
    preferredPatterns: [],
  },
  communicationStyle: {
    verbosity: "balanced",
    technicalLevel: "intermediate",
    preferredExamples: true,
    showReasoning: true,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// =============================================================================
// MEMORY SYSTEM
// =============================================================================

export class MemorySystem extends EventEmitter {
  private static instance: MemorySystem;
  
  private db: DatabaseType | null = null;
  private isInitialized = false;
  private conversationContexts = new Map<string, ConversationContext>();
  private userProfile: UserProfile = DEFAULT_USER_PROFILE;
  
  private constructor() {
    super();
  }
  
  static getInstance(): MemorySystem {
    if (!MemorySystem.instance) {
      MemorySystem.instance = new MemorySystem();
    }
    return MemorySystem.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    logger.info("Initializing Memory System...");
    
    // Create directory
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    
    // Initialize database
    this.db = new Database(DB_PATH);
    await this.initializeSchema();
    
    // Load user profile
    await this.loadUserProfile();
    
    this.isInitialized = true;
    logger.info("Memory System initialized");
    this.emit("initialized");
  }
  
  private async initializeSchema(): Promise<void> {
    if (!this.db) return;
    
    this.db.exec(`
      -- Main memories table
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        embedding BLOB,
        source TEXT NOT NULL,
        importance TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        tags TEXT,
        entities TEXT,
        related_memories TEXT,
        app_id INTEGER,
        chat_id TEXT,
        message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
      CREATE INDEX IF NOT EXISTS idx_memories_app_id ON memories(app_id);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      
      -- User profile table
      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      -- Conversation contexts (short-term)
      CREATE TABLE IF NOT EXISTS conversation_contexts (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      -- Memory relationships
      CREATE TABLE IF NOT EXISTS memory_relationships (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id, relationship_type),
        FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      
      -- Full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id,
        content,
        summary,
        tags,
        entities,
        content='memories',
        content_rowid='rowid'
      );
      
      -- Triggers for FTS sync
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(id, content, summary, tags, entities)
        VALUES (new.id, new.content, new.summary, new.tags, new.entities);
      END;
      
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, id, content, summary, tags, entities)
        VALUES ('delete', old.id, old.content, old.summary, old.tags, old.entities);
      END;
      
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, id, content, summary, tags, entities)
        VALUES ('delete', old.id, old.content, old.summary, old.tags, old.entities);
        INSERT INTO memories_fts(id, content, summary, tags, entities)
        VALUES (new.id, new.content, new.summary, new.tags, new.entities);
      END;
    `);
  }
  
  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
    logger.info("Memory System shut down");
  }
  
  // ===========================================================================
  // MEMORY CRUD
  // ===========================================================================
  
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
    if (!this.db) throw new Error("Memory system not initialized");
    
    const id = crypto.randomUUID() as MemoryId;
    const now = Date.now();
    
    // Generate embedding for semantic search
    const embedding = await this.generateEmbedding(params.content);
    
    const memory: Memory = {
      id,
      type: params.type,
      content: params.content,
      summary: params.summary,
      embedding,
      source: params.source || "system",
      importance: params.importance || this.inferImportance(params.content, params.type),
      confidence: params.confidence ?? 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      tags: params.tags || [],
      entities: params.entities || this.extractEntities(params.content),
      relatedMemories: params.relatedMemories,
      appId: params.appId,
      chatId: params.chatId,
      messageId: params.messageId,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt,
    };
    
    // Insert into database
    this.db.prepare(`
      INSERT INTO memories (
        id, type, content, summary, embedding, source, importance, confidence,
        access_count, last_accessed_at, tags, entities, related_memories,
        app_id, chat_id, message_id, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.type,
      memory.content,
      memory.summary || null,
      embedding ? Buffer.from(new Float32Array(embedding).buffer) : null,
      memory.source,
      memory.importance,
      memory.confidence,
      memory.accessCount,
      memory.lastAccessedAt,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.entities),
      memory.relatedMemories ? JSON.stringify(memory.relatedMemories) : null,
      memory.appId || null,
      memory.chatId || null,
      memory.messageId || null,
      memory.createdAt,
      memory.updatedAt,
      memory.expiresAt || null
    );
    
    // Create relationships
    if (params.relatedMemories) {
      for (const relatedId of params.relatedMemories) {
        this.createRelationship(memory.id, relatedId, "related");
      }
    }
    
    this.emit("memory:created", memory);
    logger.debug("Memory created", { id: memory.id, type: memory.type });
    
    return memory;
  }
  
  async getMemory(id: MemoryId): Promise<Memory | null> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(id) as any;
    
    if (!row) return null;
    
    // Update access count
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?
    `).run(Date.now(), id);
    
    return this.rowToMemory(row);
  }
  
  async updateMemory(id: MemoryId, updates: Partial<Pick<Memory, 
    "content" | "summary" | "importance" | "confidence" | "tags" | "entities" | "expiresAt"
  >>): Promise<Memory | null> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const memory = await this.getMemory(id);
    if (!memory) return null;
    
    const updatedMemory = {
      ...memory,
      ...updates,
      updatedAt: Date.now(),
    };
    
    // Regenerate embedding if content changed
    if (updates.content) {
      updatedMemory.embedding = await this.generateEmbedding(updates.content);
    }
    
    this.db.prepare(`
      UPDATE memories SET
        content = ?, summary = ?, embedding = ?, importance = ?,
        confidence = ?, tags = ?, entities = ?, updated_at = ?, expires_at = ?
      WHERE id = ?
    `).run(
      updatedMemory.content,
      updatedMemory.summary || null,
      updatedMemory.embedding ? Buffer.from(new Float32Array(updatedMemory.embedding).buffer) : null,
      updatedMemory.importance,
      updatedMemory.confidence,
      JSON.stringify(updatedMemory.tags),
      JSON.stringify(updatedMemory.entities),
      updatedMemory.updatedAt,
      updatedMemory.expiresAt || null,
      id
    );
    
    this.emit("memory:updated", updatedMemory);
    return updatedMemory;
  }
  
  async deleteMemory(id: MemoryId): Promise<boolean> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    
    if (result.changes > 0) {
      this.emit("memory:deleted", { id });
      return true;
    }
    return false;
  }
  
  // ===========================================================================
  // MEMORY SEARCH
  // ===========================================================================
  
  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const results: MemorySearchResult[] = [];
    const limit = query.limit || 20;
    
    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (query.types?.length) {
      conditions.push(`type IN (${query.types.map(() => "?").join(", ")})`);
      params.push(...query.types);
    }
    
    if (query.sources?.length) {
      conditions.push(`source IN (${query.sources.map(() => "?").join(", ")})`);
      params.push(...query.sources);
    }
    
    if (query.appId !== undefined) {
      conditions.push("app_id = ?");
      params.push(query.appId);
    }
    
    if (query.minConfidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(query.minConfidence);
    }
    
    // Semantic search if query text provided
    if (query.query) {
      const queryEmbedding = await this.generateEmbedding(query.query);
      
      // Get all candidates
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = this.db.prepare(`
        SELECT * FROM memories ${whereClause}
        ORDER BY created_at DESC
        LIMIT 100
      `).all(...params) as any[];
      
      // Calculate similarity scores
      for (const row of rows) {
        const memory = this.rowToMemory(row, query.includeEmbeddings);
        
        let score = 0;
        
        // Semantic similarity
        if (memory.embedding && queryEmbedding) {
          score = this.cosineSimilarity(queryEmbedding, memory.embedding);
        }
        
        // Keyword boost
        const queryLower = query.query!.toLowerCase();
        if (memory.content.toLowerCase().includes(queryLower)) {
          score += 0.2;
        }
        
        // Tag match boost
        if (query.tags?.some(tag => memory.tags.includes(tag))) {
          score += 0.1;
        }
        
        // Importance weight
        score *= IMPORTANCE_WEIGHTS[memory.importance];
        
        // Recency boost
        const ageHours = (Date.now() - memory.createdAt) / (1000 * 60 * 60);
        score *= Math.exp(-ageHours / 720); // Decay over 30 days
        
        results.push({
          memory,
          score,
          matchType: score > 0.5 ? "semantic" : "keyword",
        });
      }
      
      // Sort by score and limit
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    }
    
    // Regular search without semantic
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT * FROM memories ${whereClause}
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `).all(...params, limit) as any[];
    
    return rows.map(row => ({
      memory: this.rowToMemory(row, query.includeEmbeddings),
      score: 1.0,
      matchType: "exact" as const,
    }));
  }
  
  async fullTextSearch(query: string, limit = 20): Promise<MemorySearchResult[]> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const rows = this.db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON fts.id = m.id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as any[];
    
    return rows.map(row => ({
      memory: this.rowToMemory(row),
      score: Math.abs(row.rank) / 100, // Normalize rank
      matchType: "keyword" as const,
    }));
  }
  
  // ===========================================================================
  // CONTEXT MANAGEMENT
  // ===========================================================================
  
  async getOrCreateContext(chatId: string): Promise<ConversationContext> {
    let context = this.conversationContexts.get(chatId);
    
    if (!context) {
      // Try loading from database
      context = await this.loadContext(chatId);
      
      if (!context) {
        context = {
          id: chatId,
          messages: [],
          activeMemories: [],
          workingContext: "",
        };
      }
      
      this.conversationContexts.set(chatId, context);
    }
    
    return context;
  }
  
  async addToContext(chatId: string, message: ContextMessage): Promise<void> {
    const context = await this.getOrCreateContext(chatId);
    
    context.messages.push(message);
    
    // Keep only recent messages
    if (context.messages.length > 50) {
      // Summarize old messages before removing
      const oldMessages = context.messages.slice(0, 25);
      context.summary = await this.summarizeMessages(oldMessages, context.summary);
      context.messages = context.messages.slice(25);
    }
    
    // Extract and link relevant memories
    const relevantMemories = await this.search({
      query: message.content,
      limit: 5,
      minConfidence: 0.3,
    });
    
    context.activeMemories = relevantMemories.map(r => r.memory.id);
    
    // Update working context
    context.workingContext = this.buildWorkingContext(context);
    
    await this.saveContext(context);
    this.emit("context:updated", { chatId, context });
  }
  
  private buildWorkingContext(context: ConversationContext): string {
    const parts: string[] = [];
    
    if (context.summary) {
      parts.push(`Previous context: ${context.summary}`);
    }
    
    // Add recent messages
    const recentMessages = context.messages.slice(-10);
    if (recentMessages.length > 0) {
      parts.push("Recent conversation:");
      for (const msg of recentMessages) {
        parts.push(`${msg.role}: ${msg.content.substring(0, 200)}...`);
      }
    }
    
    return parts.join("\n\n");
  }
  
  async clearContext(chatId: string): Promise<void> {
    this.conversationContexts.delete(chatId);
    
    if (this.db) {
      this.db.prepare(`DELETE FROM conversation_contexts WHERE id = ?`).run(chatId);
    }
    
    this.emit("context:cleared", { chatId });
  }
  
  private async loadContext(chatId: string): Promise<ConversationContext | null> {
    if (!this.db) return null;
    
    const row = this.db.prepare(`
      SELECT data FROM conversation_contexts WHERE id = ?
    `).get(chatId) as any;
    
    if (!row) return null;
    return JSON.parse(row.data);
  }
  
  private async saveContext(context: ConversationContext): Promise<void> {
    if (!this.db) return;
    
    const now = Date.now();
    
    this.db.prepare(`
      INSERT OR REPLACE INTO conversation_contexts (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(context.id, JSON.stringify(context), now, now);
  }
  
  // ===========================================================================
  // USER PROFILE
  // ===========================================================================
  
  async getUserProfile(): Promise<UserProfile> {
    return { ...this.userProfile };
  }
  
  async updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    this.userProfile = {
      ...this.userProfile,
      ...updates,
      updatedAt: Date.now(),
    };
    
    await this.saveUserProfile();
    this.emit("profile:updated", this.userProfile);
    
    return this.userProfile;
  }
  
  async learnPreference(key: string, value: unknown): Promise<void> {
    const preferences = { ...this.userProfile.preferences, [key]: value };
    await this.updateUserProfile({ preferences });
    
    // Also create a memory for this preference
    await this.createMemory({
      type: "preference",
      content: `User prefers ${key}: ${JSON.stringify(value)}`,
      importance: "medium",
      source: "observation",
      tags: ["preference", key],
    });
  }
  
  private async loadUserProfile(): Promise<void> {
    if (!this.db) return;
    
    const row = this.db.prepare(`
      SELECT data FROM user_profile WHERE id = 'default'
    `).get() as any;
    
    if (row) {
      this.userProfile = { ...DEFAULT_USER_PROFILE, ...JSON.parse(row.data) };
    }
  }
  
  private async saveUserProfile(): Promise<void> {
    if (!this.db) return;
    
    const now = Date.now();
    
    this.db.prepare(`
      INSERT OR REPLACE INTO user_profile (id, data, created_at, updated_at)
      VALUES ('default', ?, ?, ?)
    `).run(JSON.stringify(this.userProfile), now, now);
  }
  
  // ===========================================================================
  // MEMORY RELATIONSHIPS
  // ===========================================================================
  
  async createRelationship(
    sourceId: MemoryId,
    targetId: MemoryId,
    type: string,
    strength = 1.0
  ): Promise<void> {
    if (!this.db) return;
    
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_relationships (source_id, target_id, relationship_type, strength, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourceId, targetId, type, strength, Date.now());
  }
  
  async getRelatedMemories(id: MemoryId): Promise<Array<{ memory: Memory; relationship: string; strength: number }>> {
    if (!this.db) return [];
    
    const rows = this.db.prepare(`
      SELECT m.*, r.relationship_type, r.strength
      FROM memory_relationships r
      JOIN memories m ON m.id = r.target_id
      WHERE r.source_id = ?
      ORDER BY r.strength DESC
    `).all(id) as any[];
    
    return rows.map(row => ({
      memory: this.rowToMemory(row),
      relationship: row.relationship_type,
      strength: row.strength,
    }));
  }
  
  // ===========================================================================
  // MEMORY CONSOLIDATION
  // ===========================================================================
  
  async consolidate(): Promise<{ merged: number; deleted: number }> {
    logger.info("Starting memory consolidation...");
    
    let merged = 0;
    let deleted = 0;
    
    // Delete expired memories
    if (this.db) {
      const result = this.db.prepare(`
        DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?
      `).run(Date.now());
      deleted = result.changes;
    }
    
    // Find and merge similar memories
    const duplicates = await this.findDuplicates();
    for (const group of duplicates) {
      if (group.length > 1) {
        await this.mergeMemories(group);
        merged += group.length - 1;
      }
    }
    
    // Decay old, low-access memories
    if (this.db) {
      const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
      this.db.prepare(`
        UPDATE memories
        SET confidence = confidence * 0.9
        WHERE last_accessed_at < ? AND importance IN ('low', 'trivial')
      `).run(threshold);
    }
    
    logger.info("Memory consolidation complete", { merged, deleted });
    this.emit("consolidation:complete", { merged, deleted });
    
    return { merged, deleted };
  }
  
  private async findDuplicates(): Promise<MemoryId[][]> {
    // Find memories with high semantic similarity
    const groups: MemoryId[][] = [];
    
    const allMemories = await this.search({ limit: 1000 });
    const processed = new Set<MemoryId>();
    
    for (const { memory } of allMemories) {
      if (processed.has(memory.id)) continue;
      
      const similar = await this.search({
        query: memory.content,
        types: [memory.type],
        limit: 5,
      });
      
      const group = similar
        .filter(s => s.score > 0.9 && s.memory.id !== memory.id)
        .map(s => s.memory.id);
      
      if (group.length > 0) {
        groups.push([memory.id, ...group]);
        group.forEach(id => processed.add(id));
      }
      
      processed.add(memory.id);
    }
    
    return groups;
  }
  
  private async mergeMemories(ids: MemoryId[]): Promise<MemoryId> {
    const memories = await Promise.all(ids.map(id => this.getMemory(id)));
    const validMemories = memories.filter(Boolean) as Memory[];
    
    if (validMemories.length === 0) {
      throw new Error("No valid memories to merge");
    }
    
    // Keep the most important/recent one as base
    validMemories.sort((a, b) => {
      const importanceA = IMPORTANCE_WEIGHTS[a.importance];
      const importanceB = IMPORTANCE_WEIGHTS[b.importance];
      return importanceB - importanceA || b.createdAt - a.createdAt;
    });
    
    const base = validMemories[0];
    const others = validMemories.slice(1);
    
    // Merge content and metadata
    const mergedTags = [...new Set(validMemories.flatMap(m => m.tags))];
    const mergedEntities = [...new Set(validMemories.flatMap(m => m.entities))];
    const maxConfidence = Math.max(...validMemories.map(m => m.confidence));
    
    // Update base memory
    await this.updateMemory(base.id, {
      tags: mergedTags,
      entities: mergedEntities,
      confidence: maxConfidence,
    });
    
    // Delete others
    for (const other of others) {
      await this.deleteMemory(other.id);
    }
    
    return base.id;
  }
  
  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  
  async getStats(): Promise<MemoryStats> {
    if (!this.db) throw new Error("Memory system not initialized");
    
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        MIN(created_at) as oldest,
        MAX(created_at) as newest,
        SUM(access_count) as total_access
      FROM memories
    `).get() as any;
    
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memories GROUP BY type
    `).all() as any[];
    
    const byImportance = this.db.prepare(`
      SELECT importance, COUNT(*) as count FROM memories GROUP BY importance
    `).all() as any[];
    
    const fileStats = await fs.stat(DB_PATH).catch(() => ({ size: 0 }));
    
    return {
      totalMemories: stats.total || 0,
      byType: Object.fromEntries(byType.map(r => [r.type, r.count])) as Record<MemoryType, number>,
      byImportance: Object.fromEntries(byImportance.map(r => [r.importance, r.count])) as Record<MemoryImportance, number>,
      oldestMemory: stats.oldest || 0,
      newestMemory: stats.newest || 0,
      totalAccessCount: stats.total_access || 0,
      storageSize: fileStats.size,
    };
  }
  
  private rowToMemory(row: any, includeEmbeddings = false): Memory {
    return {
      id: row.id as MemoryId,
      type: row.type as MemoryType,
      content: row.content,
      summary: row.summary || undefined,
      embedding: includeEmbeddings && row.embedding
        ? Array.from(new Float32Array(row.embedding.buffer))
        : undefined,
      source: row.source as MemorySource,
      importance: row.importance as MemoryImportance,
      confidence: row.confidence,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      tags: JSON.parse(row.tags || "[]"),
      entities: JSON.parse(row.entities || "[]"),
      relatedMemories: row.related_memories ? JSON.parse(row.related_memories) : undefined,
      appId: row.app_id || undefined,
      chatId: row.chat_id || undefined,
      messageId: row.message_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at || undefined,
    };
  }
  
  private async generateEmbedding(text: string): Promise<number[]> {
    // Simple TF-IDF-like embedding (in production, use a proper embedding model)
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(EMBEDDINGS_DIMENSION).fill(0);
    
    for (const word of words) {
      const hash = this.hashString(word);
      embedding[Math.abs(hash) % EMBEDDINGS_DIMENSION] += 1;
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }
  
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }
  
  private inferImportance(content: string, type: MemoryType): MemoryImportance {
    // Heuristics for importance
    if (type === "preference" || type === "skill") return "high";
    if (type === "code_pattern") return "medium";
    if (content.length > 500) return "medium";
    if (content.length < 50) return "low";
    return "medium";
  }
  
  private extractEntities(content: string): string[] {
    // Simple entity extraction (proper NER would be better)
    const entities: string[] = [];
    
    // Extract capitalized words (potential names)
    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const matches = content.match(capitalizedPattern) || [];
    entities.push(...matches);
    
    // Extract code-like identifiers
    const codePattern = /\b[a-zA-Z_][a-zA-Z0-9_]*(?:Component|Service|Handler|Manager|Controller)\b/g;
    const codeMatches = content.match(codePattern) || [];
    entities.push(...codeMatches);
    
    return [...new Set(entities)].slice(0, 10);
  }
  
  private async summarizeMessages(messages: ContextMessage[], existingSummary?: string): Promise<string> {
    // Simple summarization (in production, use LLM)
    const parts: string[] = [];
    
    if (existingSummary) {
      parts.push(`Previous: ${existingSummary}`);
    }
    
    const topics = new Set<string>();
    for (const msg of messages) {
      // Extract key phrases
      const words = msg.content.split(/\s+/).filter(w => w.length > 5);
      words.slice(0, 3).forEach(w => topics.add(w));
    }
    
    parts.push(`Topics discussed: ${[...topics].join(", ")}`);
    parts.push(`${messages.length} messages exchanged`);
    
    return parts.join(". ");
  }
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const memorySystem = MemorySystem.getInstance();
