/**
 * Vector Store Service Layer
 * Provides an interface for vector-based document retrieval in the Electron main process.
 * Uses MCP tools (ingest-docs, search-docs) via IpcClient for actual operations.
 */

import { IpcClient } from "@/ipc/ipc_client";

// ============================================================================
// Types and Interfaces
// ============================================================================

/** Supported ecosystems for vector storage */
export type VectorEcosystem = "solana" | "sui";

/** Result from a vector search query */
export interface VectorSearchResult {
  text: string;
  section: string;
  source: string;
  similarity?: number;
}

/** Metadata about ingested documentation */
export interface VectorMetadata {
  ecosystem: VectorEcosystem;
  source: string;
  version: string;
  chunkCount: number;
  embeddingModel: string;
  ingestedAt: number;
}

/** Options for querying relevant context */
export interface QueryContextOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity threshold (0-1, default: 0.5) */
  minSimilarity?: number;
}

/** Result from context query with aggregated text */
export interface ContextResult {
  /** Aggregated context text from relevant chunks */
  context: string;
  /** Total size of context in bytes */
  size: number;
  /** Number of chunks used */
  chunkCount: number;
  /** Whether vector search was used (false = fallback to full docs) */
  usedVectorSearch: boolean;
  /** Retrieval time in milliseconds */
  retrievalTimeMs: number;
}

/** Ingestion result from MCP tool */
export interface IngestionResult {
  success: boolean;
  chunkCount?: number;
  durationSec?: number;
  error?: string;
}

// ============================================================================
// Vector Store Service Class
// ============================================================================

/**
 * VectorStore provides a high-level interface for vector-based document
 * retrieval. It wraps the MCP tools (ingest-docs, search-docs) and handles
 * caching, error handling, and graceful fallbacks.
 *
 * Usage:
 * ```typescript
 * const vectorStore = VectorStore.getInstance();
 * await vectorStore.ensureIngested("solana");
 * const context = await vectorStore.queryRelevantContext("solana", "how to create a PDA");
 * ```
 */
export class VectorStore {
  private static instance: VectorStore;
  private ipcClient: IpcClient;

  /** In-memory cache for metadata to avoid repeated MCP calls */
  private metadataCache = new Map<VectorEcosystem, VectorMetadata>();

  /** Track ecosystems that have been verified as ready */
  private readyEcosystems = new Set<VectorEcosystem>();

  private constructor() {
    this.ipcClient = IpcClient.getInstance();
  }

  /**
   * Get the singleton instance of VectorStore
   */
  public static getInstance(): VectorStore {
    if (!VectorStore.instance) {
      VectorStore.instance = new VectorStore();
    }
    return VectorStore.instance;
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Check if vector store is ready for a given ecosystem.
   * Returns true if docs have been ingested and are available for search.
   *
   * @param ecosystem - The blockchain ecosystem to check
   * @returns Promise resolving to true if ready, false otherwise
   */
  public async isReady(ecosystem: VectorEcosystem): Promise<boolean> {
    // Check cached state first
    if (this.readyEcosystems.has(ecosystem)) {
      return true;
    }

    try {
      // Try a simple search to verify the table exists and is queryable
      const result = await this.ipcClient.callMcpTool(
        "blockchain-guide",
        "search-docs",
        {
          query: "test",
          ecosystem,
          limit: 1,
        },
      );

      // Parse the result to check if docs are indexed
      const responseText = result?.content?.[0]?.text || "";

      // If the response mentions "No Documentation Indexed", it's not ready
      if (responseText.includes("No Documentation Indexed")) {
        return false;
      }

      // If we got results or empty results (but indexed), it's ready
      if (
        responseText.includes("Search Results") ||
        responseText.includes("No Results Found")
      ) {
        this.readyEcosystems.add(ecosystem);
        return true;
      }

      return false;
    } catch (error) {
      // If there's an error, assume not ready
      return false;
    }
  }

  /**
   * Ensure documentation is ingested for an ecosystem.
   * If already ingested, returns immediately. Otherwise, triggers ingestion.
   *
   * @param ecosystem - The blockchain ecosystem to ingest
   * @param force - Force re-ingestion even if already indexed
   * @param onProgress - Optional callback for progress updates
   * @returns Promise resolving to ingestion result
   */
  public async ensureIngested(
    ecosystem: VectorEcosystem,
    force = false,
    onProgress?: (message: string) => void,
  ): Promise<IngestionResult> {
    // Check if already ready and not forcing refresh
    if (!force && (await this.isReady(ecosystem))) {
      onProgress?.(`${ecosystem} documentation already indexed`);
      return {
        success: true,
        chunkCount: this.metadataCache.get(ecosystem)?.chunkCount,
      };
    }

    onProgress?.(`Ingesting ${ecosystem} documentation...`);

    try {
      const result = await this.ipcClient.callMcpTool(
        "blockchain-guide",
        "ingest-docs",
        {
          ecosystem,
          force,
        },
      );

      const responseText = result?.content?.[0]?.text || "";

      // Check for success indicators
      if (
        responseText.includes("Ingestion Complete") ||
        responseText.includes("Already Ingested")
      ) {
        // Parse metadata from response
        const chunkMatch = responseText.match(/Chunks[:\s]*(\d+)/i);
        const durationMatch = responseText.match(/Duration[:\s]*([\d.]+)s/i);

        const chunkCount = chunkMatch ? parseInt(chunkMatch[1], 10) : undefined;
        const durationSec = durationMatch
          ? parseFloat(durationMatch[1])
          : undefined;

        // Update caches
        this.readyEcosystems.add(ecosystem);
        if (chunkCount) {
          this.metadataCache.set(ecosystem, {
            ecosystem,
            source: ecosystem === "solana" ? "solana.com/llms.txt" : "docs.sui.io",
            version: new Date().toISOString().split("T")[0],
            chunkCount,
            embeddingModel: "Xenova/all-MiniLM-L6-v2",
            ingestedAt: Date.now(),
          });
        }

        onProgress?.(
          `Ingestion complete: ${chunkCount || "unknown"} chunks in ${durationSec || "unknown"}s`,
        );

        return {
          success: true,
          chunkCount,
          durationSec,
        };
      }

      // Check for failure indicators
      if (responseText.includes("Ingestion Failed")) {
        const errorMatch = responseText.match(/Error[:\s]*(.+)/i);
        const error = errorMatch ? errorMatch[1].trim() : "Unknown error";
        onProgress?.(`Ingestion failed: ${error}`);
        return {
          success: false,
          error,
        };
      }

      // Unknown response
      return {
        success: false,
        error: "Unexpected response from ingestion",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      onProgress?.(`Ingestion error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Query relevant context based on a natural language query.
   * Uses vector similarity search to find the most relevant documentation chunks.
   *
   * @param ecosystem - The blockchain ecosystem to query
   * @param query - Natural language search query
   * @param options - Optional query configuration
   * @returns Promise resolving to context result
   */
  public async queryRelevantContext(
    ecosystem: VectorEcosystem,
    query: string,
    options: QueryContextOptions = {},
  ): Promise<ContextResult> {
    const { limit = 10, minSimilarity = 0.5 } = options;
    const startTime = Date.now();

    try {
      const result = await this.ipcClient.callMcpTool(
        "blockchain-guide",
        "search-docs",
        {
          query,
          ecosystem,
          limit,
        },
      );

      const responseText = result?.content?.[0]?.text || "";
      const retrievalTimeMs = Date.now() - startTime;

      // Handle case where docs aren't indexed
      if (responseText.includes("No Documentation Indexed")) {
        return {
          context: "",
          size: 0,
          chunkCount: 0,
          usedVectorSearch: false,
          retrievalTimeMs,
        };
      }

      // Handle no results case
      if (responseText.includes("No Results Found")) {
        return {
          context: "",
          size: 0,
          chunkCount: 0,
          usedVectorSearch: true,
          retrievalTimeMs,
        };
      }

      // Parse results from the response
      const results = this.parseSearchResults(responseText, minSimilarity);

      // Aggregate context from all results
      const contextParts = results.map((r) => r.text);
      const context = contextParts.join("\n\n---\n\n");

      return {
        context,
        size: new TextEncoder().encode(context).length,
        chunkCount: results.length,
        usedVectorSearch: true,
        retrievalTimeMs,
      };
    } catch (error) {
      const retrievalTimeMs = Date.now() - startTime;
      return {
        context: "",
        size: 0,
        chunkCount: 0,
        usedVectorSearch: false,
        retrievalTimeMs,
      };
    }
  }

  /**
   * Get the current metadata for an ecosystem's indexed documentation.
   *
   * @param ecosystem - The blockchain ecosystem to get metadata for
   * @returns Promise resolving to metadata or null if not available
   */
  public async getVersion(
    ecosystem: VectorEcosystem,
  ): Promise<VectorMetadata | null> {
    // Return cached metadata if available
    const cached = this.metadataCache.get(ecosystem);
    if (cached) {
      return cached;
    }

    // Check if ready (this will populate cache if successful)
    const ready = await this.isReady(ecosystem);
    if (!ready) {
      return null;
    }

    // Return cached value that might have been populated
    return this.metadataCache.get(ecosystem) || null;
  }

  /**
   * Clear the ready state cache for an ecosystem.
   * Useful when you want to force a re-check of the vector store state.
   *
   * @param ecosystem - The ecosystem to clear cache for, or undefined to clear all
   */
  public clearCache(ecosystem?: VectorEcosystem): void {
    if (ecosystem) {
      this.readyEcosystems.delete(ecosystem);
      this.metadataCache.delete(ecosystem);
    } else {
      this.readyEcosystems.clear();
      this.metadataCache.clear();
    }
  }

  /**
   * Query multiple search terms and aggregate results.
   * Useful for gathering context on multiple related topics.
   *
   * @param ecosystem - The blockchain ecosystem to query
   * @param queries - Array of search queries
   * @param options - Optional query configuration
   * @returns Promise resolving to aggregated context result
   */
  public async queryMultiple(
    ecosystem: VectorEcosystem,
    queries: string[],
    options: QueryContextOptions = {},
  ): Promise<ContextResult> {
    const startTime = Date.now();
    const allResults: VectorSearchResult[] = [];
    const seenTexts = new Set<string>();

    // Run all queries in parallel for speed
    const queryResults = await Promise.all(
      queries.map((query) =>
        this.queryRelevantContext(ecosystem, query, {
          ...options,
          limit: Math.max(3, Math.floor((options.limit || 10) / queries.length)),
        }),
      ),
    );

    // Deduplicate results across queries
    for (const result of queryResults) {
      if (result.context) {
        const chunks = result.context.split("\n\n---\n\n");
        for (const chunk of chunks) {
          const trimmed = chunk.trim();
          if (trimmed && !seenTexts.has(trimmed)) {
            seenTexts.add(trimmed);
            allResults.push({
              text: trimmed,
              section: "aggregated",
              source: ecosystem,
            });
          }
        }
      }
    }

    // Limit to requested number of results
    const limitedResults = allResults.slice(0, options.limit || 10);
    const context = limitedResults.map((r) => r.text).join("\n\n---\n\n");
    const retrievalTimeMs = Date.now() - startTime;

    return {
      context,
      size: new TextEncoder().encode(context).length,
      chunkCount: limitedResults.length,
      usedVectorSearch: queryResults.some((r) => r.usedVectorSearch),
      retrievalTimeMs,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Parse search results from the MCP tool response text
   */
  private parseSearchResults(
    responseText: string,
    minSimilarity: number,
  ): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    // Split by result sections
    const resultSections = responseText.split(/## Result \d+/);

    for (const section of resultSections) {
      if (!section.trim()) continue;

      // Extract similarity score if present
      const similarityMatch = section.match(/similarity:\s*([\d.]+)/);
      const similarity = similarityMatch
        ? parseFloat(similarityMatch[1])
        : undefined;

      // Skip results below minimum similarity threshold
      if (similarity !== undefined && similarity < minSimilarity) {
        continue;
      }

      // Extract section name
      const sectionMatch = section.match(/\*\*Section:\*\*\s*(.+)/);
      const sectionName = sectionMatch ? sectionMatch[1].trim() : "unknown";

      // Extract source
      const sourceMatch = section.match(/\*\*Source:\*\*\s*(.+)/);
      const source = sourceMatch ? sourceMatch[1].trim() : "unknown";

      // Extract text content (everything after the metadata lines)
      const lines = section.split("\n");
      const textLines: string[] = [];
      let pastMetadata = false;

      for (const line of lines) {
        if (
          line.includes("**Section:**") ||
          line.includes("**Source:**") ||
          line.includes("similarity:")
        ) {
          pastMetadata = true;
          continue;
        }
        if (pastMetadata && line.trim()) {
          textLines.push(line);
        }
      }

      const text = textLines.join("\n").trim();
      if (text) {
        results.push({
          text,
          section: sectionName,
          source,
          similarity,
        });
      }
    }

    return results;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the singleton VectorStore instance
 */
export function getVectorStore(): VectorStore {
  return VectorStore.getInstance();
}

/**
 * Check if vector store is ready for an ecosystem
 */
export async function isVectorStoreReady(
  ecosystem: VectorEcosystem,
): Promise<boolean> {
  return VectorStore.getInstance().isReady(ecosystem);
}

/**
 * Query relevant context from the vector store
 */
export async function queryVectorContext(
  ecosystem: VectorEcosystem,
  query: string,
  options?: QueryContextOptions,
): Promise<ContextResult> {
  return VectorStore.getInstance().queryRelevantContext(ecosystem, query, options);
}
