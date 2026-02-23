/**
 * Embedding Pipeline — Orchestrates: chunk → embed (Ollama) → store (sqlite-vec) → retrieve for RAG
 *
 * This is the core ingestion + retrieval engine that ties together:
 *   1. Document loading (text, files, URLs)
 *   2. Chunking (via VectorStoreService chunking strategies)
 *   3. Embedding generation (Ollama → nomic-embed-text / all-minilm)
 *   4. Vector storage (sqlite-vec backend)
 *   5. Retrieval for RAG context injection into chat
 *
 * The pipeline supports:
 *   - Batch embedding with configurable concurrency
 *   - Progress events for UI feedback
 *   - Cancellation of long-running ingestion
 *   - Automatic Ollama model detection and fallback
 *   - Integration with agentKnowledgeBases for agent-specific knowledge
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { vectorStoreService } from "./vector_store_service";
import { openClawOllamaBridge } from "./openclaw_ollama_bridge";
import type {
  CollectionId,
  ModelId,
  VectorCollection,
  VectorSearchResult,
  ChunkingConfig,
} from "@/types/sovereign_stack_types";

const logger = log.scope("embedding_pipeline");

// =============================================================================
// TYPES
// =============================================================================

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimension: number;
  maxTokens: number;
  provider: "ollama" | "builtin";
  available: boolean;
}

export interface IngestDocumentRequest {
  collectionId: string;
  content: string;
  title?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  chunkingConfig?: ChunkingConfig;
}

export interface IngestFileRequest {
  collectionId: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  chunkingConfig?: ChunkingConfig;
}

export interface IngestUrlRequest {
  collectionId: string;
  url: string;
  metadata?: Record<string, unknown>;
  chunkingConfig?: ChunkingConfig;
  /** Extract clean text from HTML (default: true) */
  extractText?: boolean;
}

export interface IngestBatchRequest {
  collectionId: string;
  documents: Array<{
    content: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }>;
  chunkingConfig?: ChunkingConfig;
  /** Max concurrent embedding requests (default: 4) */
  concurrency?: number;
}

export interface IngestResult {
  documentId: string;
  chunkCount: number;
  embeddingDimension: number;
  durationMs: number;
}

export interface IngestBatchResult {
  total: number;
  successful: number;
  failed: number;
  results: IngestResult[];
  errors: Array<{ index: number; error: string }>;
  durationMs: number;
}

export interface PipelineProgress {
  stage: "chunking" | "embedding" | "storing" | "complete" | "error";
  current: number;
  total: number;
  documentTitle?: string;
  message?: string;
}

export interface RetrievalRequest {
  collectionIds: string[];
  query: string;
  topK?: number;
  minScore?: number;
  /** If provided, skip embedding the query and use this directly */
  queryEmbedding?: number[];
}

export interface RetrievalResult {
  chunks: Array<{
    content: string;
    score: number;
    documentId: string;
    documentTitle?: string;
    source?: string;
    chunkIndex: number;
    metadata?: Record<string, unknown>;
  }>;
  /** Pre-formatted context string for injection into prompts */
  contextString: string;
  totalChunks: number;
  queryDurationMs: number;
}

export interface PipelineStatus {
  initialized: boolean;
  embeddingModel: EmbeddingModelInfo | null;
  ollamaAvailable: boolean;
  collectionCount: number;
  totalDocuments: number;
  activeIngestions: number;
}

// =============================================================================
// KNOWN EMBEDDING MODELS
// =============================================================================

const KNOWN_EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: "nomic-embed-text:latest",
    name: "Nomic Embed Text",
    dimension: 768,
    maxTokens: 8192,
    provider: "ollama",
    available: false,
  },
  {
    id: "all-minilm:latest",
    name: "All-MiniLM-L6-v2",
    dimension: 384,
    maxTokens: 512,
    provider: "ollama",
    available: false,
  },
  {
    id: "mxbai-embed-large:latest",
    name: "MxBAI Embed Large",
    dimension: 1024,
    maxTokens: 512,
    provider: "ollama",
    available: false,
  },
  {
    id: "bge-m3:latest",
    name: "BGE-M3",
    dimension: 1024,
    maxTokens: 8192,
    provider: "ollama",
    available: false,
  },
  {
    id: "snowflake-arctic-embed:latest",
    name: "Snowflake Arctic Embed",
    dimension: 1024,
    maxTokens: 512,
    provider: "ollama",
    available: false,
  },
];

/** TF-IDF fallback dimension when no model is available */
const FALLBACK_DIMENSION = 384;

// =============================================================================
// EMBEDDING PIPELINE
// =============================================================================

export class EmbeddingPipeline extends EventEmitter {
  private static instance: EmbeddingPipeline;

  private initialized = false;
  private activeModel: EmbeddingModelInfo | null = null;
  private activeIngestions = 0;
  private abortControllers = new Map<string, AbortController>();

  static getInstance(): EmbeddingPipeline {
    if (!EmbeddingPipeline.instance) {
      EmbeddingPipeline.instance = new EmbeddingPipeline();
    }
    return EmbeddingPipeline.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initialize the pipeline — detect Ollama, find available embedding models
   */
  async initialize(): Promise<PipelineStatus> {
    if (this.initialized) return this.getStatus();

    logger.info("Initializing embedding pipeline...");

    // Initialize vector store
    await vectorStoreService.initialize();

    // Detect available embedding models via Ollama
    await this.detectEmbeddingModels();

    this.initialized = true;
    logger.info("Embedding pipeline initialized", {
      model: this.activeModel?.id ?? "fallback",
      ollamaAvailable: !!this.activeModel,
    });

    return this.getStatus();
  }

  /**
   * Detect which embedding models are available via Ollama
   */
  async detectEmbeddingModels(): Promise<EmbeddingModelInfo[]> {
    const models = [...KNOWN_EMBEDDING_MODELS];

    try {
      // Check if Ollama is running
      const ollamaModels = await openClawOllamaBridge.listModels();
      const ollamaModelNames = ollamaModels.map((m: { name: string }) =>
        m.name.toLowerCase(),
      );

      for (const model of models) {
        // Check if this model (or a variant) is pulled in Ollama
        const baseId = model.id.split(":")[0].toLowerCase();
        model.available = ollamaModelNames.some(
          (n: string) =>
            n.startsWith(baseId) || n.includes(baseId),
        );
      }

      // Auto-select the best available model (prefer nomic > all-minilm > mxbai > bge)
      const available = models.filter((m) => m.available);
      if (available.length > 0) {
        this.activeModel = available[0]; // Already sorted by priority
        vectorStoreService.setEmbeddingModel(
          this.activeModel.id as ModelId,
        );
        logger.info("Selected embedding model", { model: this.activeModel.id });
      } else {
        logger.warn(
          "No Ollama embedding models available — using TF-IDF fallback",
        );
        this.activeModel = null;
      }
    } catch (error) {
      logger.warn("Ollama not available for embeddings", { error });
      this.activeModel = null;
    }

    return models;
  }

  /**
   * Set a specific embedding model
   */
  async setEmbeddingModel(modelId: string): Promise<EmbeddingModelInfo> {
    const known = KNOWN_EMBEDDING_MODELS.find((m) => m.id === modelId);
    if (known) {
      this.activeModel = { ...known, available: true };
    } else {
      // Custom model — probe its dimension
      const dim = await this.probeModelDimension(modelId);
      this.activeModel = {
        id: modelId,
        name: modelId,
        dimension: dim,
        maxTokens: 512,
        provider: "ollama",
        available: true,
      };
    }

    vectorStoreService.setEmbeddingModel(modelId as ModelId);
    logger.info("Embedding model set", { modelId, dimension: this.activeModel.dimension });
    return this.activeModel;
  }

  /**
   * Probe a model's embedding dimension by sending a test input
   */
  private async probeModelDimension(modelId: string): Promise<number> {
    try {
      const result = await openClawOllamaBridge.embed(modelId, "test");
      if (result.embeddings && result.embeddings.length > 0) {
        return result.embeddings[0].length;
      }
    } catch (error) {
      logger.warn("Failed to probe model dimension", { modelId, error });
    }
    return FALLBACK_DIMENSION;
  }

  // ===========================================================================
  // EMBEDDING GENERATION
  // ===========================================================================

  /**
   * Generate embeddings for an array of texts
   * Uses Ollama if available, falls back to TF-IDF hashing
   */
  async generateEmbeddings(
    texts: string[],
    options?: { batchSize?: number; signal?: AbortSignal },
  ): Promise<number[][]> {
    const batchSize = options?.batchSize ?? 32;

    if (!this.activeModel) {
      // Fallback: TF-IDF hash embeddings
      return texts.map((t) => this.tfidfEmbedding(t, FALLBACK_DIMENSION));
    }

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      if (options?.signal?.aborted) {
        throw new Error("Embedding generation cancelled");
      }

      const batch = texts.slice(i, i + batchSize);
      try {
        const result = await openClawOllamaBridge.embed(
          this.activeModel.id,
          batch,
        );
        allEmbeddings.push(...result.embeddings);
      } catch (error) {
        // If Ollama fails mid-batch, fall back for remaining texts
        logger.warn("Ollama embed failed, falling back to TF-IDF for batch", {
          batchStart: i,
          error,
        });
        for (const text of batch) {
          allEmbeddings.push(
            this.tfidfEmbedding(text, this.activeModel?.dimension ?? FALLBACK_DIMENSION),
          );
        }
      }
    }

    return allEmbeddings;
  }

  /**
   * Generate embedding for a single query text
   */
  async embedQuery(query: string): Promise<number[]> {
    const [embedding] = await this.generateEmbeddings([query]);
    return embedding;
  }

  /**
   * Simple TF-IDF hash embedding (fallback)
   */
  private tfidfEmbedding(text: string, dimension: number): number[] {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const embedding = new Array(dimension).fill(0);

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        const char = word.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const idx = Math.abs(hash) % dimension;
      embedding[idx] += 1;
    }

    // L2 normalize
    const norm = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  // ===========================================================================
  // DOCUMENT INGESTION
  // ===========================================================================

  /**
   * Ingest a single document: chunk → embed → store
   */
  async ingestDocument(request: IngestDocumentRequest): Promise<IngestResult> {
    const start = Date.now();
    const abort = new AbortController();
    const opId = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.abortControllers.set(opId, abort);
    this.activeIngestions++;

    try {
      if (!this.initialized) await this.initialize();

      const collectionId = request.collectionId as CollectionId;
      const collection = await vectorStoreService.getCollection(collectionId);
      if (!collection) {
        throw new Error(`Collection not found: ${request.collectionId}`);
      }

      this.emitProgress({ stage: "chunking", current: 0, total: 1, documentTitle: request.title });

      // 1. Chunk the document
      const chunkingConfig = request.chunkingConfig ?? collection.chunkingConfig ?? {
        strategy: "paragraph" as const,
        chunkSize: 512,
        chunkOverlap: 50,
      };
      const chunks = this.chunkText(request.content, chunkingConfig);

      this.emitProgress({ stage: "embedding", current: 0, total: chunks.length, documentTitle: request.title });

      // 2. Generate embeddings for all chunks
      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = await this.generateEmbeddings(chunkTexts, { signal: abort.signal });

      this.emitProgress({ stage: "storing", current: 0, total: 1, documentTitle: request.title });

      // 3. Store via VectorStoreService (which delegates to sqlite-vec)
      const result = await vectorStoreService.addDocuments(collectionId, [
        {
          content: request.content,
          title: request.title,
          metadata: request.metadata,
          source: request.source,
          chunks: chunks.map((c, i) => ({
            content: c.content,
            embedding: embeddings[i],
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            chunkIndex: i,
          })),
        },
      ]);

      const docId = result.documentIds?.[0] ?? opId;

      this.emitProgress({ stage: "complete", current: 1, total: 1, documentTitle: request.title });

      return {
        documentId: docId,
        chunkCount: chunks.length,
        embeddingDimension: embeddings[0]?.length ?? FALLBACK_DIMENSION,
        durationMs: Date.now() - start,
      };
    } finally {
      this.activeIngestions--;
      this.abortControllers.delete(opId);
    }
  }

  /**
   * Ingest a local file: read → chunk → embed → store
   */
  async ingestFile(request: IngestFileRequest): Promise<IngestResult> {
    const { readFile } = await import("fs/promises");
    const content = await readFile(request.filePath, "utf-8");
    const title = request.filePath.split(/[\\/]/).pop() ?? request.filePath;

    // Auto-detect chunking strategy based on file extension
    const ext = request.filePath.split(".").pop()?.toLowerCase() ?? "";
    const autoStrategy = this.detectChunkingStrategy(ext);

    return this.ingestDocument({
      collectionId: request.collectionId,
      content,
      title,
      source: request.filePath,
      metadata: { ...request.metadata, fileExtension: ext },
      chunkingConfig: request.chunkingConfig ?? autoStrategy,
    });
  }

  /**
   * Ingest from URL: fetch → extract text → chunk → embed → store
   */
  async ingestUrl(request: IngestUrlRequest): Promise<IngestResult> {
    const response = await fetch(request.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    let content = await response.text();

    if (request.extractText !== false) {
      // Basic HTML text extraction
      content = this.extractTextFromHtml(content);
    }

    const title = new URL(request.url).hostname + new URL(request.url).pathname;

    return this.ingestDocument({
      collectionId: request.collectionId,
      content,
      title,
      source: request.url,
      metadata: { ...request.metadata, sourceUrl: request.url },
      chunkingConfig: request.chunkingConfig,
    });
  }

  /**
   * Batch ingest multiple documents with concurrency control
   */
  async ingestBatch(request: IngestBatchRequest): Promise<IngestBatchResult> {
    const start = Date.now();
    const concurrency = request.concurrency ?? 4;
    const results: IngestResult[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let completed = 0;

    const queue = request.documents.map((doc, index) => ({ doc, index }));

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        try {
          const result = await this.ingestDocument({
            collectionId: request.collectionId,
            content: item.doc.content,
            title: item.doc.title,
            source: item.doc.source,
            metadata: item.doc.metadata,
            chunkingConfig: request.chunkingConfig,
          });
          results.push(result);
        } catch (error) {
          errors.push({
            index: item.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        completed++;
        this.emitProgress({
          stage: "storing",
          current: completed,
          total: request.documents.length,
          message: `Ingested ${completed}/${request.documents.length} documents`,
        });
      }
    };

    // Run workers in parallel
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);

    return {
      total: request.documents.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors,
      durationMs: Date.now() - start,
    };
  }

  // ===========================================================================
  // RETRIEVAL
  // ===========================================================================

  /**
   * Retrieve relevant chunks from one or more collections for a query.
   * Returns both raw chunks and a pre-formatted context string.
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const start = Date.now();
    if (!this.initialized) await this.initialize();

    const topK = request.topK ?? 5;
    const minScore = request.minScore ?? 0.3;

    // Embed the query
    const queryEmbedding = request.queryEmbedding ?? await this.embedQuery(request.query);

    // Search across all specified collections
    const allResults: Array<VectorSearchResult & { collectionId: string }> = [];

    for (const collectionId of request.collectionIds) {
      try {
        const results = await vectorStoreService.search({
          collectionId: collectionId as CollectionId,
          query: request.query,
          queryEmbedding,
          topK,
          minScore,
          includeMetadata: true,
        });

        for (const r of results) {
          allResults.push({ ...r, collectionId });
        }
      } catch (error) {
        logger.warn("Search failed for collection", { collectionId, error });
      }
    }

    // Sort by score descending, take topK overall
    allResults.sort((a, b) => b.score - a.score);
    const topResults = allResults.slice(0, topK);

    // Build formatted context string
    const contextParts = topResults.map((r, i) => {
      const header = r.source
        ? `[${i + 1}] (source: ${r.source}, score: ${r.score.toFixed(3)})`
        : `[${i + 1}] (score: ${r.score.toFixed(3)})`;
      return `${header}\n${r.content}`;
    });

    const contextString =
      topResults.length > 0
        ? `<knowledge-base-context>\n${contextParts.join("\n\n---\n\n")}\n</knowledge-base-context>`
        : "";

    return {
      chunks: topResults.map((r, i) => ({
        content: r.content,
        score: r.score,
        documentId: r.documentId,
        documentTitle: r.metadata?.title as string | undefined,
        source: r.source,
        chunkIndex: i,
        metadata: r.metadata,
      })),
      contextString,
      totalChunks: topResults.length,
      queryDurationMs: Date.now() - start,
    };
  }

  /**
   * Retrieve context for injection into the chat system prompt.
   * Designed to be called from chat_stream_handlers.
   */
  async retrieveForChat(
    query: string,
    collectionIds: string[],
    options?: { topK?: number; minScore?: number },
  ): Promise<string> {
    if (collectionIds.length === 0) return "";

    try {
      const result = await this.retrieve({
        collectionIds,
        query,
        topK: options?.topK ?? 5,
        minScore: options?.minScore ?? 0.3,
      });

      if (result.chunks.length === 0) return "";
      return result.contextString;
    } catch (error) {
      logger.warn("RAG retrieval for chat failed", { error });
      return "";
    }
  }

  // ===========================================================================
  // CANCELLATION
  // ===========================================================================

  /**
   * Cancel all active ingestion operations
   */
  cancelAll(): void {
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    logger.info("Cancelled all active ingestion operations");
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  getStatus(): PipelineStatus {
    const collections = vectorStoreService.listCollections
      ? (vectorStoreService as any).collections?.size ?? 0
      : 0;

    return {
      initialized: this.initialized,
      embeddingModel: this.activeModel,
      ollamaAvailable: this.activeModel?.provider === "ollama" && this.activeModel.available,
      collectionCount: collections,
      totalDocuments: 0, // Computed lazily
      activeIngestions: this.activeIngestions,
    };
  }

  getActiveModel(): EmbeddingModelInfo | null {
    return this.activeModel;
  }

  getAvailableModels(): EmbeddingModelInfo[] {
    return KNOWN_EMBEDDING_MODELS;
  }

  // ===========================================================================
  // CHUNKING HELPERS
  // ===========================================================================

  /**
   * Chunk text using the configured strategy
   */
  private chunkText(
    text: string,
    config: ChunkingConfig,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    const { strategy, chunkSize, chunkOverlap } = config;
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];

    switch (strategy) {
      case "sentence":
        return this.chunkBySentence(text, chunkSize, chunkOverlap);
      case "paragraph":
        return this.chunkByParagraph(text, chunkSize, chunkOverlap);
      case "code":
        return this.chunkByCode(text, chunkSize);
      case "markdown":
        return this.chunkByMarkdown(text, chunkSize, chunkOverlap);
      case "semantic":
        // Semantic chunking delegates to sentence (same as VectorStoreService)
        return this.chunkBySentence(text, chunkSize, chunkOverlap);
      case "fixed":
      default:
        return this.chunkFixed(text, chunkSize, chunkOverlap);
    }
  }

  private chunkFixed(
    text: string,
    size: number,
    overlap: number,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
    const step = Math.max(1, size - overlap);

    for (let i = 0; i < text.length; i += step) {
      const end = Math.min(i + size, text.length);
      chunks.push({
        content: text.slice(i, end),
        startOffset: i,
        endOffset: end,
      });
      if (end >= text.length) break;
    }

    return chunks;
  }

  private chunkBySentence(
    text: string,
    maxSize: number,
    overlap: number,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
    let current = "";
    let startOffset = 0;
    let currentStart = 0;

    for (const sentence of sentences) {
      if (current.length + sentence.length > maxSize && current.length > 0) {
        chunks.push({
          content: current.trim(),
          startOffset: currentStart,
          endOffset: currentStart + current.length,
        });
        // Overlap: keep tail
        const overlapText = current.slice(-overlap);
        currentStart = currentStart + current.length - overlapText.length;
        current = overlapText;
      }
      current += (current ? " " : "") + sentence;
      if (chunks.length === 0 && current === sentence) {
        currentStart = startOffset;
      }
      startOffset += sentence.length + 1;
    }

    if (current.trim().length > 0) {
      chunks.push({
        content: current.trim(),
        startOffset: currentStart,
        endOffset: currentStart + current.length,
      });
    }

    return chunks;
  }

  private chunkByParagraph(
    text: string,
    maxSize: number,
    overlap: number,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    const paragraphs = text.split(/\n\n+/);
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
    let current = "";
    let currentStart = 0;
    let offset = 0;

    for (const para of paragraphs) {
      if (current.length + para.length > maxSize * 2 && current.length > 0) {
        chunks.push({
          content: current.trim(),
          startOffset: currentStart,
          endOffset: currentStart + current.length,
        });
        currentStart = offset;
        current = "";
      }
      current += (current ? "\n\n" : "") + para;
      if (current === para) currentStart = offset;
      offset += para.length + 2;
    }

    if (current.trim().length > 0) {
      chunks.push({
        content: current.trim(),
        startOffset: currentStart,
        endOffset: currentStart + current.length,
      });
    }

    // Split oversized chunks
    const result: typeof chunks = [];
    for (const chunk of chunks) {
      if (chunk.content.length > maxSize * 2) {
        result.push(...this.chunkFixed(chunk.content, maxSize, overlap).map((c) => ({
          ...c,
          startOffset: c.startOffset + chunk.startOffset,
          endOffset: c.endOffset + chunk.startOffset,
        })));
      } else {
        result.push(chunk);
      }
    }

    return result;
  }

  private chunkByCode(
    text: string,
    maxSize: number,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    // Split on function/class definitions
    const pattern = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|def|fn|pub)\s+/gm;
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
    const matches = [...text.matchAll(pattern)];

    if (matches.length === 0) {
      return this.chunkFixed(text, maxSize, 50);
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
      const content = text.slice(start, end).trim();

      if (content.length > maxSize) {
        // Split oversized code blocks by lines
        const lines = content.split("\n");
        let block = "";
        let blockStart = start;

        for (const line of lines) {
          if (block.length + line.length > maxSize && block.length > 0) {
            chunks.push({
              content: block.trim(),
              startOffset: blockStart,
              endOffset: blockStart + block.length,
            });
            blockStart += block.length;
            block = "";
          }
          block += line + "\n";
        }
        if (block.trim()) {
          chunks.push({ content: block.trim(), startOffset: blockStart, endOffset: blockStart + block.length });
        }
      } else {
        chunks.push({ content, startOffset: start, endOffset: end });
      }
    }

    return chunks;
  }

  private chunkByMarkdown(
    text: string,
    maxSize: number,
    overlap: number,
  ): Array<{ content: string; startOffset: number; endOffset: number }> {
    // Split by headers
    const headerPattern = /^#{1,6}\s+/gm;
    const matches = [...text.matchAll(headerPattern)];
    const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];

    if (matches.length === 0) {
      return this.chunkByParagraph(text, maxSize, overlap);
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
      const content = text.slice(start, end).trim();

      if (content.length > maxSize) {
        // Break large sections into paragraphs
        chunks.push(
          ...this.chunkByParagraph(content, maxSize, overlap).map((c) => ({
            ...c,
            startOffset: c.startOffset + start,
            endOffset: c.endOffset + start,
          })),
        );
      } else {
        chunks.push({ content, startOffset: start, endOffset: end });
      }
    }

    return chunks;
  }

  // ===========================================================================
  // TEXT EXTRACTION
  // ===========================================================================

  /**
   * Basic HTML to text extraction
   */
  private extractTextFromHtml(html: string): string {
    return html
      // Remove scripts and styles
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Replace block elements with newlines
      .replace(/<(?:p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n")
      // Remove all remaining tags
      .replace(/<[^>]+>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Auto-detect chunking strategy based on file extension
   */
  private detectChunkingStrategy(ext: string): ChunkingConfig {
    const codeExts = ["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "cs", "rb", "php"];
    const markdownExts = ["md", "mdx", "rst"];

    if (codeExts.includes(ext)) {
      return { strategy: "code", chunkSize: 1000, chunkOverlap: 100 };
    }
    if (markdownExts.includes(ext)) {
      return { strategy: "markdown", chunkSize: 800, chunkOverlap: 100 };
    }
    return { strategy: "paragraph", chunkSize: 512, chunkOverlap: 50 };
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  private emitProgress(progress: PipelineProgress): void {
    this.emit("progress", progress);
  }
}

// Singleton export
export const embeddingPipeline = EmbeddingPipeline.getInstance();
