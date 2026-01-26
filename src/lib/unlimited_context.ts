/**
 * Unlimited Context Manager for JoyCreate
 * 
 * Unlike competitors who limit context windows, JoyCreate offers:
 * - Unlimited context with local models
 * - Smart chunking for long conversations
 * - Intelligent summarization to fit cloud model limits
 * - Rolling context windows with memory
 * - Semantic compression for efficiency
 * 
 * ALL FREE!
 */

import log from "electron-log";
import { EventEmitter } from "events";

const logger = log.scope("unlimited_context");

// =============================================================================
// TYPES
// =============================================================================

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: number;
  tokens?: number;
  metadata?: {
    summarized?: boolean;
    originalTokens?: number;
    importance?: number;
  };
}

export interface ContextChunk {
  id: string;
  messages: Message[];
  tokens: number;
  summary?: string;
  summaryTokens?: number;
  timestamp: number;
}

export interface ContextConfig {
  mode: "unlimited" | "fixed" | "rolling" | "smart";
  maxTokens?: number;               // Only for fixed/cloud modes
  targetTokens?: number;            // Target context size for compression
  preserveRecentMessages?: number;  // Always keep N recent messages
  enableSummarization?: boolean;    // Summarize old context
  enableSemanticCompression?: boolean;
  localModelContextSize?: number;   // For unlimited local mode
}

export interface ContextStats {
  totalMessages: number;
  totalTokens: number;
  chunksCount: number;
  summarizedChunks: number;
  compressionRatio: number;
  memoryUsageMB: number;
}

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

export function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token for English
  // This is faster than calling tokenizer for every message
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Message): number {
  // Include role overhead (~4 tokens) plus content
  return 4 + estimateTokens(message.content);
}

// =============================================================================
// UNLIMITED CONTEXT MANAGER
// =============================================================================

export class UnlimitedContextManager extends EventEmitter {
  private chunks: ContextChunk[] = [];
  private config: ContextConfig;
  private conversationMemory: Map<string, string> = new Map();

  constructor(config: Partial<ContextConfig> = {}) {
    super();
    this.config = {
      mode: "unlimited",
      maxTokens: 128000,
      targetTokens: 100000,
      preserveRecentMessages: 10,
      enableSummarization: true,
      enableSemanticCompression: true,
      localModelContextSize: 1000000, // 1M tokens - virtually unlimited
      ...config,
    };
  }

  // ============================================================================
  // CORE METHODS
  // ============================================================================

  /**
   * Add messages to context
   */
  addMessages(messages: Message[]): void {
    const chunk: ContextChunk = {
      id: `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      messages: messages.map(m => ({
        ...m,
        timestamp: m.timestamp || Date.now(),
        tokens: m.tokens || estimateMessageTokens(m),
      })),
      tokens: messages.reduce((sum, m) => sum + (m.tokens || estimateMessageTokens(m)), 0),
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit("messagesAdded", chunk);

    // Auto-compress if needed (for cloud mode)
    if (this.config.mode !== "unlimited") {
      this.maybeCompress();
    }
  }

  /**
   * Get messages for context window
   */
  getContextMessages(targetTokens?: number): Message[] {
    const maxTokens = targetTokens || this.getMaxTokens();

    if (this.config.mode === "unlimited") {
      // Return everything for local models
      return this.getAllMessages();
    }

    return this.getCompressedMessages(maxTokens);
  }

  /**
   * Get all messages without compression (for local models)
   */
  getAllMessages(): Message[] {
    const messages: Message[] = [];
    for (const chunk of this.chunks) {
      messages.push(...chunk.messages);
    }
    return messages;
  }

  /**
   * Get compressed messages to fit token limit
   */
  getCompressedMessages(maxTokens: number): Message[] {
    const allMessages = this.getAllMessages();
    const totalTokens = allMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);

    // If within limit, return all
    if (totalTokens <= maxTokens) {
      return allMessages;
    }

    // Need to compress
    return this.compressMessages(allMessages, maxTokens);
  }

  // ============================================================================
  // COMPRESSION STRATEGIES
  // ============================================================================

  /**
   * Compress messages to fit within token limit
   */
  private compressMessages(messages: Message[], maxTokens: number): Message[] {
    const preserveCount = this.config.preserveRecentMessages || 10;
    const recentMessages = messages.slice(-preserveCount);
    const recentTokens = recentMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);

    const availableForOld = maxTokens - recentTokens;
    const oldMessages = messages.slice(0, -preserveCount);

    if (oldMessages.length === 0 || availableForOld <= 0) {
      return recentMessages;
    }

    // Summarize old messages if enabled
    if (this.config.enableSummarization) {
      const summary = this.summarizeMessages(oldMessages);
      const summaryMessage: Message = {
        role: "system",
        content: `[Previous conversation summary: ${summary}]`,
        tokens: estimateTokens(summary) + 10,
        metadata: { summarized: true },
      };

      if ((summaryMessage.tokens || 0) <= availableForOld) {
        return [summaryMessage, ...recentMessages];
      }
    }

    // Fall back to truncation with importance scoring
    return this.truncateByImportance(oldMessages, availableForOld, recentMessages);
  }

  /**
   * Create a summary of messages
   */
  private summarizeMessages(messages: Message[]): string {
    // Simple extractive summary - in production would use AI
    const keyPoints: string[] = [];
    
    // Extract key information
    for (const msg of messages) {
      // Look for code blocks
      const codeBlocks = msg.content.match(/```[\s\S]*?```/g);
      if (codeBlocks) {
        keyPoints.push(`Code discussed: ${codeBlocks.length} blocks`);
      }

      // Look for questions
      if (msg.role === "user" && msg.content.includes("?")) {
        const shortQuestion = msg.content.split("?")[0].slice(0, 100) + "?";
        keyPoints.push(`User asked: ${shortQuestion}`);
      }

      // Look for decisions/conclusions
      if (msg.content.toLowerCase().includes("decision") || 
          msg.content.toLowerCase().includes("conclusion") ||
          msg.content.toLowerCase().includes("solution")) {
        const sentence = msg.content.split(".")[0].slice(0, 150);
        keyPoints.push(sentence);
      }
    }

    // Deduplicate and limit
    const unique = [...new Set(keyPoints)].slice(0, 10);
    return unique.join(". ");
  }

  /**
   * Truncate messages by importance score
   */
  private truncateByImportance(
    oldMessages: Message[],
    maxTokens: number,
    recentMessages: Message[]
  ): Message[] {
    // Score messages by importance
    const scored = oldMessages.map((msg, idx) => ({
      message: msg,
      score: this.scoreImportance(msg, idx, oldMessages.length),
    }));

    // Sort by importance (highest first)
    scored.sort((a, b) => b.score - a.score);

    // Take messages until we hit token limit
    const selected: Message[] = [];
    let tokens = 0;

    for (const { message } of scored) {
      const msgTokens = message.tokens || estimateMessageTokens(message);
      if (tokens + msgTokens > maxTokens) break;
      selected.push(message);
      tokens += msgTokens;
    }

    // Re-sort by original order (timestamp)
    selected.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return [...selected, ...recentMessages];
  }

  /**
   * Score message importance (0-1)
   */
  private scoreImportance(message: Message, index: number, total: number): number {
    let score = 0.5;

    // Recent messages are more important
    score += (index / total) * 0.2;

    // Code is important
    if (message.content.includes("```")) {
      score += 0.2;
    }

    // Questions are important
    if (message.content.includes("?")) {
      score += 0.1;
    }

    // Long messages may be more substantial
    const length = message.content.length;
    if (length > 500) score += 0.1;
    if (length > 1000) score += 0.1;

    // System messages are important
    if (message.role === "system") {
      score += 0.2;
    }

    // User custom importance
    if (message.metadata?.importance) {
      score = message.metadata.importance;
    }

    return Math.min(1, score);
  }

  // ============================================================================
  // SEMANTIC COMPRESSION
  // ============================================================================

  /**
   * Semantically compress content while preserving meaning
   */
  compressContent(content: string, targetRatio: number = 0.5): string {
    if (!this.config.enableSemanticCompression) {
      return content;
    }

    const lines = content.split("\n");
    const targetLines = Math.ceil(lines.length * targetRatio);

    // Score each line
    const scored = lines.map((line, idx) => ({
      line,
      score: this.scoreLineImportance(line, idx, lines),
    }));

    // Take top scoring lines in original order
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const selected = sorted.slice(0, targetLines);
    const indices = new Set(selected.map(s => scored.indexOf(s)));

    return lines.filter((_, idx) => indices.has(idx)).join("\n");
  }

  private scoreLineImportance(line: string, index: number, allLines: string[]): number {
    let score = 0.5;

    // Headers are important
    if (line.match(/^#+\s/) || line.match(/^[A-Z][A-Z\s]+:?$/)) {
      score += 0.3;
    }

    // Code-related lines
    if (line.includes("function") || line.includes("class") || 
        line.includes("export") || line.includes("import")) {
      score += 0.2;
    }

    // First and last lines of sections
    if (index === 0 || index === allLines.length - 1) {
      score += 0.1;
    }

    // Empty lines are less important
    if (line.trim().length === 0) {
      score -= 0.3;
    }

    // Comments can be compressed
    if (line.trim().startsWith("//") || line.trim().startsWith("#")) {
      score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  // ============================================================================
  // ROLLING CONTEXT
  // ============================================================================

  /**
   * Rolling context window with memory
   * Keeps recent context + stored memories of important info
   */
  getRollingContext(maxTokens: number): Message[] {
    const messages = this.getAllMessages();
    const preserveCount = this.config.preserveRecentMessages || 10;
    const recent = messages.slice(-preserveCount);

    // Build memory context
    const memories = this.buildMemoryContext();
    const memoryMessage: Message | null = memories.length > 0 ? {
      role: "system",
      content: `[Remembered from conversation: ${memories.join("; ")}]`,
      tokens: estimateTokens(memories.join("; ")) + 10,
    } : null;

    const result: Message[] = [];
    if (memoryMessage) {
      result.push(memoryMessage);
    }
    result.push(...recent);

    return result;
  }

  /**
   * Store important information in memory
   */
  remember(key: string, value: string): void {
    this.conversationMemory.set(key, value);
    this.emit("memoryUpdated", { key, value });
  }

  /**
   * Retrieve from memory
   */
  recall(key: string): string | undefined {
    return this.conversationMemory.get(key);
  }

  /**
   * Build context from memories
   */
  private buildMemoryContext(): string[] {
    return Array.from(this.conversationMemory.entries())
      .map(([key, value]) => `${key}: ${value}`);
  }

  // ============================================================================
  // AUTO-COMPRESSION
  // ============================================================================

  private maybeCompress(): void {
    const totalTokens = this.getTotalTokens();
    const maxTokens = this.getMaxTokens();

    if (totalTokens > maxTokens * 0.9) {
      this.compressOldChunks();
    }
  }

  private compressOldChunks(): void {
    if (this.chunks.length <= 1) return;

    // Summarize and merge old chunks
    const oldChunks = this.chunks.slice(0, -1);
    const recentChunk = this.chunks[this.chunks.length - 1];

    const allOldMessages = oldChunks.flatMap(c => c.messages);
    const summary = this.summarizeMessages(allOldMessages);

    const compressedChunk: ContextChunk = {
      id: `compressed_${Date.now()}`,
      messages: [{
        role: "system",
        content: `[Conversation history summary: ${summary}]`,
        tokens: estimateTokens(summary) + 10,
        metadata: { summarized: true, originalTokens: allOldMessages.reduce((s, m) => s + (m.tokens || 0), 0) },
      }],
      tokens: estimateTokens(summary) + 10,
      summary,
      timestamp: Date.now(),
    };

    this.chunks = [compressedChunk, recentChunk];
    this.emit("contextCompressed", this.getStats());
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  getMaxTokens(): number {
    if (this.config.mode === "unlimited") {
      return this.config.localModelContextSize || 1000000;
    }
    return this.config.maxTokens || 128000;
  }

  getTotalTokens(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
  }

  getStats(): ContextStats {
    const allMessages = this.getAllMessages();
    const totalTokens = this.getTotalTokens();
    const originalTokens = allMessages.reduce(
      (sum, m) => sum + (m.metadata?.originalTokens || m.tokens || 0), 
      0
    );

    return {
      totalMessages: allMessages.length,
      totalTokens,
      chunksCount: this.chunks.length,
      summarizedChunks: this.chunks.filter(c => c.summary).length,
      compressionRatio: originalTokens > 0 ? totalTokens / originalTokens : 1,
      memoryUsageMB: this.estimateMemoryUsage(),
    };
  }

  private estimateMemoryUsage(): number {
    const jsonSize = JSON.stringify(this.chunks).length;
    return jsonSize / (1024 * 1024);
  }

  clear(): void {
    this.chunks = [];
    this.conversationMemory.clear();
    this.emit("contextCleared");
  }

  setMode(mode: ContextConfig["mode"]): void {
    this.config.mode = mode;
    this.emit("modeChanged", mode);
  }

  getMode(): ContextConfig["mode"] {
    return this.config.mode;
  }

  // ============================================================================
  // EXPORT/IMPORT
  // ============================================================================

  export(): { chunks: ContextChunk[]; memory: Record<string, string>; config: ContextConfig } {
    return {
      chunks: this.chunks,
      memory: Object.fromEntries(this.conversationMemory),
      config: this.config,
    };
  }

  import(data: { chunks: ContextChunk[]; memory: Record<string, string>; config?: Partial<ContextConfig> }): void {
    this.chunks = data.chunks;
    this.conversationMemory = new Map(Object.entries(data.memory));
    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }
    this.emit("contextImported", this.getStats());
  }
}

// Export factory function
export function createUnlimitedContext(config?: Partial<ContextConfig>): UnlimitedContextManager {
  return new UnlimitedContextManager(config);
}

// Export singleton for global use
let globalContext: UnlimitedContextManager | null = null;

export function getGlobalContext(): UnlimitedContextManager {
  if (!globalContext) {
    globalContext = new UnlimitedContextManager();
  }
  return globalContext;
}
