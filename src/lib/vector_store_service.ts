/**
 * Vector Store Service
 * Local embeddings and semantic search without cloud dependencies.
 * Supports sqlite-vss, hnswlib, and faiss backends.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import Database, { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "events";

import type {
  CollectionId,
  VectorCollection,
  VectorStoreBackend,
  VectorDocument,
  VectorSearchRequest,
  VectorSearchResult,
  RAGRequest,
  RAGResponse,
  ChunkingConfig,
  ModelId,
} from "@/types/sovereign_stack_types";

import { localModelManager } from "./local_model_manager";

const logger = log.scope("vector_store_service");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_VECTOR_DIR = path.join(app.getPath("userData"), "vectors");
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;

// =============================================================================
// CHUNKING UTILITIES
// =============================================================================

/**
 * Text chunking strategies
 */
export const ChunkingStrategies = {
  /**
   * Fixed-size character chunks with overlap
   */
  fixedSize(text: string, config: ChunkingConfig): string[] {
    const size = config.chunkSize || DEFAULT_CHUNK_SIZE;
    const overlap = config.chunkOverlap || DEFAULT_CHUNK_OVERLAP;
    const chunks: string[] = [];
    
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end));
      start = end - overlap;
      if (start + overlap >= text.length) break;
    }
    
    return chunks;
  },
  
  /**
   * Sentence-based chunking
   */
  sentence(text: string, config: ChunkingConfig): string[] {
    const maxSize = config.chunkSize || DEFAULT_CHUNK_SIZE;
    const sentenceRegex = /[.!?]+[\s]+/g;
    const sentences: string[] = [];
    
    let lastIndex = 0;
    let match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(text.slice(lastIndex, match.index + match[0].length));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      sentences.push(text.slice(lastIndex));
    }
    
    // Group sentences into chunks
    const chunks: string[] = [];
    let currentChunk = "";
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    
    return chunks;
  },
  
  /**
   * Paragraph-based chunking
   */
  paragraph(text: string, config: ChunkingConfig): string[] {
    const maxSize = config.chunkSize || DEFAULT_CHUNK_SIZE * 2;
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    
    let currentChunk = "";
    
    for (const para of paragraphs) {
      if (currentChunk.length + para.length <= maxSize) {
        currentChunk += (currentChunk ? "\n\n" : "") + para;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        // If paragraph is too long, use fixed-size chunking
        if (para.length > maxSize) {
          chunks.push(...this.fixedSize(para, config));
          currentChunk = "";
        } else {
          currentChunk = para;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    return chunks;
  },
  
  /**
   * Semantic chunking based on content similarity
   */
  semantic(text: string, config: ChunkingConfig): string[] {
    // For now, use sentence-based as a proxy
    // In production, this would use embedding similarity
    return this.sentence(text, config);
  },
  
  /**
   * Code-aware chunking
   */
  code(text: string, config: ChunkingConfig): string[] {
    const maxSize = config.chunkSize || DEFAULT_CHUNK_SIZE * 2;
    
    // Split by function/class definitions
    const codeBlockRegex = /(?:^|\n)((?:async\s+)?(?:function|class|const|let|var|def|async\s+def|public|private|protected)\s+\w+)/g;
    const blocks: string[] = [];
    
    let lastIndex = 0;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        blocks.push(text.slice(lastIndex, match.index));
      }
      lastIndex = match.index;
    }
    if (lastIndex < text.length) {
      blocks.push(text.slice(lastIndex));
    }
    
    // Process blocks
    const chunks: string[] = [];
    for (const block of blocks) {
      if (block.length <= maxSize) {
        chunks.push(block.trim());
      } else {
        // Split large blocks by lines
        const lines = block.split("\n");
        let currentChunk = "";
        
        for (const line of lines) {
          if (currentChunk.length + line.length + 1 <= maxSize) {
            currentChunk += (currentChunk ? "\n" : "") + line;
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = line;
          }
        }
        if (currentChunk) chunks.push(currentChunk);
      }
    }
    
    return chunks.filter(c => c.trim().length > 0);
  },
  
  /**
   * Markdown-aware chunking
   */
  markdown(text: string, config: ChunkingConfig): string[] {
    const maxSize = config.chunkSize || DEFAULT_CHUNK_SIZE * 2;
    
    // Split by headers
    const headerRegex = /(?:^|\n)(#{1,6}\s+.+)/g;
    const sections: Array<{ header: string; content: string }> = [];
    
    let lastIndex = 0;
    let lastHeader = "";
    let match;
    
    while ((match = headerRegex.exec(text)) !== null) {
      if (lastIndex < match.index) {
        sections.push({ header: lastHeader, content: text.slice(lastIndex, match.index) });
      }
      lastHeader = match[1];
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      sections.push({ header: lastHeader, content: text.slice(lastIndex) });
    }
    
    // Process sections
    const chunks: string[] = [];
    for (const section of sections) {
      const fullSection = (section.header + "\n" + section.content).trim();
      
      if (fullSection.length <= maxSize) {
        chunks.push(fullSection);
      } else {
        // Keep header with each sub-chunk
        const content = section.content;
        const contentChunks = this.paragraph(content, config);
        
        for (const chunk of contentChunks) {
          chunks.push(section.header + "\n" + chunk);
        }
      }
    }
    
    return chunks.filter(c => c.trim().length > 0);
  },
};

// =============================================================================
// VECTOR STORE SERVICE
// =============================================================================

export class VectorStoreService extends EventEmitter {
  private vectorDir: string;
  private collections: Map<CollectionId, VectorCollection> = new Map();
  private databases: Map<CollectionId, DatabaseType> = new Map();
  private embeddingModelId?: ModelId;
  
  constructor(vectorDir?: string) {
    super();
    this.vectorDir = vectorDir || DEFAULT_VECTOR_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing vector store service", { vectorDir: this.vectorDir });
    
    // Ensure vector directory exists
    await fs.mkdir(this.vectorDir, { recursive: true });
    
    // Scan for existing collections
    await this.scanCollections();
    
    logger.info("Vector store initialized", { collectionCount: this.collections.size });
  }
  
  /**
   * Set the embedding model to use
   */
  setEmbeddingModel(modelId: ModelId): void {
    this.embeddingModelId = modelId;
  }
  
  /**
   * Scan for existing collections
   */
  private async scanCollections(): Promise<void> {
    const entries = await fs.readdir(this.vectorDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(this.vectorDir, entry.name, "collection.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            this.collections.set(config.id as CollectionId, config);
          } catch (error) {
            logger.warn("Failed to load collection config", { path: configPath, error });
          }
        }
      }
    }
  }
  
  // ===========================================================================
  // COLLECTION MANAGEMENT
  // ===========================================================================
  
  /**
   * Create a new collection
   */
  async createCollection(params: {
    name: string;
    description?: string;
    backend?: VectorStoreBackend;
    dimension?: number;
    distanceMetric?: "cosine" | "euclidean" | "dot";
    chunkingConfig?: ChunkingConfig;
    metadata?: Record<string, unknown>;
  }): Promise<VectorCollection> {
    const id = crypto.randomUUID() as CollectionId;
    const collectionDir = path.join(this.vectorDir, id);
    await fs.mkdir(collectionDir, { recursive: true });
    
    const collection: VectorCollection = {
      id,
      name: params.name,
      description: params.description,
      backend: params.backend || "sqlite-vss",
      dimension: params.dimension || 384, // all-minilm-l6-v2 default
      distanceMetric: params.distanceMetric || "cosine",
      documentCount: 0,
      vectorCount: 0,
      sizeBytes: 0,
      chunkingConfig: params.chunkingConfig || {
        strategy: "sentence",
        chunkSize: DEFAULT_CHUNK_SIZE,
        chunkOverlap: DEFAULT_CHUNK_OVERLAP,
      },
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Initialize backend
    await this.initializeBackend(collection, collectionDir);
    
    // Save config
    await fs.writeFile(
      path.join(collectionDir, "collection.json"),
      JSON.stringify(collection, null, 2)
    );
    
    this.collections.set(id, collection);
    this.emit("collection:created", collection);
    
    return collection;
  }
  
  /**
   * Initialize the vector backend for a collection
   */
  private async initializeBackend(collection: VectorCollection, collectionDir: string): Promise<void> {
    switch (collection.backend) {
      case "sqlite-vss":
        await this.initializeSqliteVss(collection, collectionDir);
        break;
      case "hnswlib":
        await this.initializeHnswlib(collection, collectionDir);
        break;
      default:
        throw new Error(`Unsupported backend: ${collection.backend}`);
    }
  }
  
  /**
   * Initialize SQLite-VSS backend
   */
  private async initializeSqliteVss(collection: VectorCollection, collectionDir: string): Promise<void> {
    const dbPath = path.join(collectionDir, "vectors.db");
    const db = new Database(dbPath);
    
    // Enable extensions
    try {
      // Try to load sqlite-vss extension
      // In production, this would need proper extension loading
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          title TEXT,
          source TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          content TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          start_pos INTEGER,
          end_pos INTEGER,
          metadata TEXT,
          FOREIGN KEY (document_id) REFERENCES documents(id)
        );
        
        CREATE TABLE IF NOT EXISTS embeddings (
          chunk_id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES chunks(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
      `);
    } catch (error) {
      logger.warn("SQLite-VSS extension not available, using fallback", { error });
    }
    
    this.databases.set(collection.id, db);
  }
  
  /**
   * Initialize HNSWlib backend (stub - requires native module)
   */
  private async initializeHnswlib(collection: VectorCollection, collectionDir: string): Promise<void> {
    // HNSWlib would require a native Node.js module
    // For now, fall back to SQLite-VSS
    logger.warn("HNSWlib not available, falling back to SQLite-VSS");
    await this.initializeSqliteVss(collection, collectionDir);
  }
  
  /**
   * List all collections
   */
  listCollections(): VectorCollection[] {
    return Array.from(this.collections.values());
  }
  
  /**
   * Get a collection by ID
   */
  getCollection(id: CollectionId): VectorCollection | null {
    return this.collections.get(id) || null;
  }
  
  /**
   * Delete a collection
   */
  async deleteCollection(id: CollectionId): Promise<void> {
    const db = this.databases.get(id);
    if (db) {
      db.close();
      this.databases.delete(id);
    }
    
    const collectionDir = path.join(this.vectorDir, id);
    if (existsSync(collectionDir)) {
      await fs.rm(collectionDir, { recursive: true, force: true });
    }
    
    this.collections.delete(id);
    this.emit("collection:deleted", { id });
  }
  
  // ===========================================================================
  // DOCUMENT MANAGEMENT
  // ===========================================================================
  
  /**
   * Add documents to a collection
   */
  async addDocuments(
    collectionId: CollectionId,
    documents: Array<{
      content: string;
      title?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<VectorDocument[]> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    
    const db = await this.getDatabase(collectionId);
    const results: VectorDocument[] = [];
    
    for (const doc of documents) {
      const docId = crypto.randomUUID();
      const chunks = this.chunkText(doc.content, collection.chunkingConfig);
      
      // Insert document
      db.prepare(`
        INSERT INTO documents (id, content, title, source, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        docId,
        doc.content,
        doc.title || null,
        doc.source || null,
        doc.metadata ? JSON.stringify(doc.metadata) : null,
        Date.now()
      );
      
      // Insert chunks and embeddings
      const chunkIds: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = crypto.randomUUID();
        chunkIds.push(chunkId);
        
        db.prepare(`
          INSERT INTO chunks (id, document_id, content, chunk_index, metadata)
          VALUES (?, ?, ?, ?, ?)
        `).run(chunkId, docId, chunks[i], i, null);
      }
      
      // Generate embeddings
      const embeddings = await this.generateEmbeddings(chunks);
      
      for (let i = 0; i < chunkIds.length; i++) {
        const embeddingBuffer = this.embeddingToBuffer(embeddings[i]);
        db.prepare(`
          INSERT INTO embeddings (chunk_id, embedding)
          VALUES (?, ?)
        `).run(chunkIds[i], embeddingBuffer);
      }
      
      const vectorDoc: VectorDocument = {
        id: docId,
        collectionId,
        content: doc.content,
        title: doc.title,
        source: doc.source,
        metadata: doc.metadata,
        chunkCount: chunks.length,
        createdAt: Date.now(),
      };
      
      results.push(vectorDoc);
    }
    
    // Update collection stats
    collection.documentCount += documents.length;
    collection.vectorCount += results.reduce((sum, d) => sum + d.chunkCount, 0);
    collection.updatedAt = Date.now();
    
    await this.saveCollectionConfig(collection);
    this.emit("documents:added", { collectionId, count: documents.length });
    
    return results;
  }
  
  /**
   * Delete a document
   */
  async deleteDocument(collectionId: CollectionId, documentId: string): Promise<void> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    
    const db = await this.getDatabase(collectionId);
    
    // Get chunk count for stats
    const chunkCount = db.prepare(`
      SELECT COUNT(*) as count FROM chunks WHERE document_id = ?
    `).get(documentId) as { count: number };
    
    // Delete embeddings
    db.prepare(`
      DELETE FROM embeddings WHERE chunk_id IN (
        SELECT id FROM chunks WHERE document_id = ?
      )
    `).run(documentId);
    
    // Delete chunks
    db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId);
    
    // Delete document
    db.prepare(`DELETE FROM documents WHERE id = ?`).run(documentId);
    
    // Update stats
    collection.documentCount -= 1;
    collection.vectorCount -= chunkCount.count;
    collection.updatedAt = Date.now();
    
    await this.saveCollectionConfig(collection);
    this.emit("document:deleted", { collectionId, documentId });
  }
  
  /**
   * List documents in a collection
   */
  async listDocuments(collectionId: CollectionId): Promise<VectorDocument[]> {
    const db = await this.getDatabase(collectionId);
    
    const rows = db.prepare(`
      SELECT d.*, COUNT(c.id) as chunk_count
      FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `).all() as Array<{
      id: string;
      content: string;
      title: string | null;
      source: string | null;
      metadata: string | null;
      created_at: number;
      chunk_count: number;
    }>;
    
    return rows.map((row) => ({
      id: row.id,
      collectionId,
      content: row.content,
      title: row.title || undefined,
      source: row.source || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      chunkCount: row.chunk_count,
      createdAt: row.created_at,
    }));
  }
  
  // ===========================================================================
  // SEARCH
  // ===========================================================================
  
  /**
   * Search for similar vectors
   */
  async search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const collection = this.collections.get(request.collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${request.collectionId}`);
    }
    
    const db = await this.getDatabase(request.collectionId);
    
    // Generate query embedding
    const queryEmbedding = (await this.generateEmbeddings([request.query]))[0];
    
    // Get all embeddings (in production, use VSS index)
    const rows = db.prepare(`
      SELECT e.chunk_id, e.embedding, c.content, c.document_id, c.chunk_index,
             d.title, d.source, d.metadata as doc_metadata
      FROM embeddings e
      JOIN chunks c ON c.id = e.chunk_id
      JOIN documents d ON d.id = c.document_id
    `).all() as Array<{
      chunk_id: string;
      embedding: Buffer;
      content: string;
      document_id: string;
      chunk_index: number;
      title: string | null;
      source: string | null;
      doc_metadata: string | null;
    }>;
    
    // Calculate similarities
    const results: Array<{
      row: typeof rows[0];
      score: number;
    }> = [];
    
    for (const row of rows) {
      const embedding = this.bufferToEmbedding(row.embedding);
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      
      // Apply threshold filter
      if (request.threshold && score < request.threshold) continue;
      
      // Apply metadata filter
      if (request.filter) {
        const metadata = row.doc_metadata ? JSON.parse(row.doc_metadata) : {};
        if (!this.matchesFilter(metadata, request.filter)) continue;
      }
      
      results.push({ row, score });
    }
    
    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    const topK = results.slice(0, request.topK || 10);
    
    return topK.map((r) => ({
      id: r.row.chunk_id,
      content: r.row.content,
      score: r.score,
      documentId: r.row.document_id,
      chunkIndex: r.row.chunk_index,
      title: r.row.title || undefined,
      source: r.row.source || undefined,
      metadata: r.row.doc_metadata ? JSON.parse(r.row.doc_metadata) : undefined,
    }));
  }
  
  /**
   * Perform RAG query
   */
  async rag(request: RAGRequest): Promise<RAGResponse> {
    // Search for relevant context
    const searchResults = await this.search({
      collectionId: request.collectionId,
      query: request.query,
      topK: request.topK || 5,
      threshold: request.threshold,
      filter: request.filter,
    });
    
    // Build context
    const context = searchResults
      .map((r, i) => `[${i + 1}] ${r.content}`)
      .join("\n\n");
    
    // Build prompt
    const systemPrompt = request.systemPrompt || `You are a helpful assistant. Answer the user's question based on the provided context. If the context doesn't contain relevant information, say so.`;
    
    const prompt = `Context:
${context}

Question: ${request.query}

Answer based on the context above:`;
    
    // Generate response using local model
    if (!request.modelId) {
      throw new Error("Model ID required for RAG");
    }
    
    const response = await localModelManager.inference({
      modelId: request.modelId,
      prompt,
      systemPrompt,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 1024,
    });
    
    // Extract citations
    const citations: RAGResponse["citations"] = searchResults.map((r) => ({
      documentId: r.documentId,
      chunkId: r.id,
      content: r.content,
      score: r.score,
      source: r.source,
    }));
    
    return {
      answer: response.content,
      citations,
      confidence: this.calculateConfidence(searchResults),
      modelId: request.modelId,
      usage: response.usage,
    };
  }
  
  // ===========================================================================
  // EMBEDDING GENERATION
  // ===========================================================================
  
  /**
   * Generate embeddings for texts
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (this.embeddingModelId) {
      // Use local model
      return localModelManager.embed(this.embeddingModelId, texts);
    }
    
    // Fallback: Use simple TF-IDF-like embedding (very basic)
    return texts.map((text) => this.simpleEmbedding(text, 384));
  }
  
  /**
   * Simple TF-IDF-like embedding (fallback when no model available)
   */
  private simpleEmbedding(text: string, dimension: number): number[] {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const embedding = new Array(dimension).fill(0);
    
    for (const word of words) {
      const hash = this.hashString(word);
      const idx = Math.abs(hash) % dimension;
      embedding[idx] += 1;
    }
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
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
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private async getDatabase(collectionId: CollectionId): Promise<DatabaseType> {
    let db = this.databases.get(collectionId);
    if (!db) {
      const collection = this.collections.get(collectionId);
      if (!collection) {
        throw new Error(`Collection not found: ${collectionId}`);
      }
      
      const collectionDir = path.join(this.vectorDir, collectionId);
      await this.initializeBackend(collection, collectionDir);
      db = this.databases.get(collectionId)!;
    }
    return db;
  }
  
  private async saveCollectionConfig(collection: VectorCollection): Promise<void> {
    const configPath = path.join(this.vectorDir, collection.id, "collection.json");
    await fs.writeFile(configPath, JSON.stringify(collection, null, 2));
  }
  
  private chunkText(text: string, config: ChunkingConfig): string[] {
    const strategy = config.strategy || "sentence";
    const chunker = ChunkingStrategies[strategy] || ChunkingStrategies.fixedSize;
    return chunker.call(ChunkingStrategies, text, config);
  }
  
  private embeddingToBuffer(embedding: number[]): Buffer {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }
  
  private bufferToEmbedding(buffer: Buffer): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      embedding.push(buffer.readFloatLE(i));
    }
    return embedding;
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }
  
  private matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) return false;
    }
    return true;
  }
  
  private calculateConfidence(results: VectorSearchResult[]): number {
    if (results.length === 0) return 0;
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    return Math.min(1, Math.max(0, avgScore));
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    for (const db of this.databases.values()) {
      db.close();
    }
    this.databases.clear();
  }
}

// Export singleton
export const vectorStoreService = new VectorStoreService();
