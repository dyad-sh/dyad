/**
 * Embedding Generation Utility
 *
 * Provides text embedding generation using @huggingface/transformers with the
 * Xenova/all-MiniLM-L6-v2 model. Features:
 * - 384-dimensional embedding vectors
 * - Mean pooling with L2 normalization
 * - Model caching for performance
 * - Graceful handling of first-run model download (~22MB)
 * - Batch embedding support
 */

import { pipeline, type FeatureExtractionPipeline, type Tensor } from "@huggingface/transformers";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for the embedding generator
 */
export interface EmbeddingConfig {
  /** Model identifier (default: Xenova/all-MiniLM-L6-v2) */
  modelId?: string;
  /** Pooling strategy (default: mean) */
  pooling?: "mean" | "cls" | "none";
  /** Whether to normalize embeddings (default: true) */
  normalize?: boolean;
  /** Callback for model loading progress */
  onProgress?: (progress: EmbeddingProgress) => void;
}

/**
 * Progress information during model loading
 */
export interface EmbeddingProgress {
  /** Current status */
  status: "downloading" | "loading" | "ready" | "error";
  /** Progress percentage (0-100) during download */
  progress?: number;
  /** Current file being downloaded */
  file?: string;
  /** Total size in bytes */
  totalBytes?: number;
  /** Downloaded bytes */
  loadedBytes?: number;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  /** The embedding vector (384 dimensions for all-MiniLM-L6-v2) */
  embedding: number[];
  /** Original text that was embedded */
  text: string;
  /** Time taken to generate embedding in milliseconds */
  durationMs: number;
}

/**
 * Result of a batch embedding operation
 */
export interface BatchEmbeddingResult {
  /** Array of embeddings in same order as input texts */
  embeddings: number[][];
  /** Total time taken in milliseconds */
  durationMs: number;
  /** Number of texts processed */
  count: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default model: Xenova/all-MiniLM-L6-v2 produces 384-dimensional embeddings */
const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Expected embedding dimension for the default model */
const EMBEDDING_DIMENSION = 384;

/** Maximum text length in characters (model context limit) */
const MAX_TEXT_LENGTH = 512 * 4; // ~512 tokens

// ============================================================================
// Embedding Generator Class
// ============================================================================

/**
 * Embedding generator using Hugging Face Transformers
 *
 * Handles model loading, caching, and embedding generation with
 * support for single and batch operations.
 */
export class EmbeddingGenerator {
  private config: {
    modelId: string;
    pooling: "mean" | "cls" | "none";
    normalize: boolean;
  };
  private extractor: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<void> | null = null;
  private isReady: boolean = false;
  private onProgress?: (progress: EmbeddingProgress) => void;

  constructor(config?: EmbeddingConfig) {
    this.config = {
      modelId: config?.modelId ?? DEFAULT_MODEL_ID,
      pooling: config?.pooling ?? "mean",
      normalize: config?.normalize ?? true,
    };
    this.onProgress = config?.onProgress;
  }

  /**
   * Initialize the embedding model
   * Downloads the model on first use (~22MB)
   */
  async initialize(): Promise<void> {
    if (this.isReady) {
      return;
    }

    // Prevent concurrent initialization
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadModel();
    await this.loadingPromise;
    this.loadingPromise = null;
  }

  /**
   * Internal model loading logic
   */
  private async loadModel(): Promise<void> {
    try {
      this.notifyProgress({ status: "downloading" });

      // Cast pipeline function to avoid "union type too complex" error from overloads
      const pipelineFn = pipeline as (
        task: "feature-extraction",
        model: string,
        options?: { progress_callback?: (info: unknown) => void }
      ) => Promise<FeatureExtractionPipeline>;

      this.extractor = await pipelineFn(
        "feature-extraction",
        this.config.modelId,
        {
          progress_callback: (progressInfo: unknown) => {
            const info = progressInfo as { status: string; file?: string; progress?: number; loaded?: number; total?: number };
            if (info.status === "progress" && info.progress !== undefined) {
              this.notifyProgress({
                status: "downloading",
                progress: info.progress,
                file: info.file,
                loadedBytes: info.loaded,
                totalBytes: info.total,
              });
            }
          },
        }
      );

      this.isReady = true;
      this.notifyProgress({ status: "ready" });
    } catch (error) {
      this.notifyProgress({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to load embedding model: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Notify progress callback if registered
   */
  private notifyProgress(progress: EmbeddingProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Ensure the model is ready before operations
   */
  private ensureReady(): FeatureExtractionPipeline {
    if (!this.extractor || !this.isReady) {
      throw new Error(
        "Embedding model not initialized. Call initialize() first."
      );
    }
    return this.extractor;
  }

  /**
   * Truncate text to fit within model context limit
   */
  private truncateText(text: string): string {
    if (text.length <= MAX_TEXT_LENGTH) {
      return text;
    }
    return text.slice(0, MAX_TEXT_LENGTH);
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - The text to embed
   * @returns Embedding result with 384-dimensional vector
   */
  async embed(text: string): Promise<EmbeddingResult> {
    await this.initialize();
    const extractor = this.ensureReady();

    const startTime = Date.now();
    const truncatedText = this.truncateText(text);

    const output = await extractor(truncatedText, {
      pooling: this.config.pooling,
      normalize: this.config.normalize,
    });

    // Convert Tensor to plain JS array
    const embedding = this.tensorToArray(output);

    return {
      embedding,
      text: truncatedText,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Generate embeddings for multiple texts in batch
   *
   * @param texts - Array of texts to embed
   * @returns Batch embedding result with array of vectors
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    await this.initialize();
    const extractor = this.ensureReady();

    if (texts.length === 0) {
      return {
        embeddings: [],
        durationMs: 0,
        count: 0,
      };
    }

    const startTime = Date.now();
    const truncatedTexts = texts.map((t) => this.truncateText(t));

    const output = await extractor(truncatedTexts, {
      pooling: this.config.pooling,
      normalize: this.config.normalize,
    });

    // Convert Tensor to array of embeddings
    const embeddings = this.tensorToArrayBatch(output, texts.length);

    return {
      embeddings,
      durationMs: Date.now() - startTime,
      count: texts.length,
    };
  }

  /**
   * Convert Tensor output to plain JS array for single embedding
   */
  private tensorToArray(tensor: Tensor): number[] {
    // For single input, output shape is [1, sequence_length, hidden_size] or [1, hidden_size] after pooling
    // tolist() returns nested arrays, we need to flatten appropriately
    const data = tensor.tolist() as number[] | number[][];

    // If it's already a flat array
    if (typeof data[0] === "number") {
      return data as number[];
    }

    // If it's nested (e.g., [[...]])
    const nested = data as number[][];
    if (nested.length === 1 && Array.isArray(nested[0])) {
      return nested[0];
    }

    return nested.flat();
  }

  /**
   * Convert Tensor output to array of embeddings for batch
   */
  private tensorToArrayBatch(tensor: Tensor, batchSize: number): number[][] {
    const data = tensor.tolist() as number[] | number[][] | number[][][];

    // Handle different output shapes
    if (batchSize === 1) {
      return [this.tensorToArray(tensor)];
    }

    // For batch, output is typically [batch_size, hidden_size] after pooling
    if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") {
      return data as number[][];
    }

    // Handle nested structure
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      const item = (data as number[][][])[i];
      if (Array.isArray(item) && typeof item[0] === "number") {
        result.push(item as unknown as number[]);
      } else if (Array.isArray(item) && Array.isArray(item[0])) {
        result.push((item as number[][])[0]);
      }
    }

    return result;
  }

  /**
   * Check if the model is ready for use
   */
  isModelReady(): boolean {
    return this.isReady;
  }

  /**
   * Get the configured model ID
   */
  getModelId(): string {
    return this.config.modelId;
  }

  /**
   * Get the expected embedding dimension
   */
  getEmbeddingDimension(): number {
    return EMBEDDING_DIMENSION;
  }
}

// ============================================================================
// Singleton Instance & Factory Functions
// ============================================================================

/** Cached default embedding generator instance */
let defaultGenerator: EmbeddingGenerator | null = null;

/**
 * Get or create the default embedding generator
 * Uses singleton pattern for model caching
 *
 * @param config - Optional configuration (only used on first call)
 * @returns Shared EmbeddingGenerator instance
 */
export function getEmbeddingGenerator(config?: EmbeddingConfig): EmbeddingGenerator {
  if (!defaultGenerator) {
    defaultGenerator = new EmbeddingGenerator(config);
  }
  return defaultGenerator;
}

/**
 * Create a new embedding generator instance
 * Use this when you need a separate instance with different configuration
 *
 * @param config - Configuration options
 * @returns New EmbeddingGenerator instance
 */
export function createEmbeddingGenerator(config?: EmbeddingConfig): EmbeddingGenerator {
  return new EmbeddingGenerator(config);
}

/**
 * Generate embedding for a single text using the default generator
 * Convenience function for simple use cases
 *
 * @param text - The text to embed
 * @returns Promise resolving to 384-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const generator = getEmbeddingGenerator();
  const result = await generator.embed(text);
  return result.embedding;
}

/**
 * Generate embeddings for multiple texts using the default generator
 * Convenience function for batch processing
 *
 * @param texts - Array of texts to embed
 * @returns Promise resolving to array of 384-dimensional embedding vectors
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const generator = getEmbeddingGenerator();
  const result = await generator.embedBatch(texts);
  return result.embeddings;
}

/**
 * Preload the embedding model
 * Call this early to avoid latency on first embedding request
 *
 * @param onProgress - Optional callback for download progress
 */
export async function preloadModel(
  onProgress?: (progress: EmbeddingProgress) => void
): Promise<void> {
  const generator = onProgress
    ? createEmbeddingGenerator({ onProgress })
    : getEmbeddingGenerator();
  await generator.initialize();
}

/**
 * Check if the default model is ready
 */
export function isModelReady(): boolean {
  return defaultGenerator?.isModelReady() ?? false;
}

/**
 * Reset the default generator (useful for testing)
 */
export function resetDefaultGenerator(): void {
  defaultGenerator = null;
}
