/**
 * LanceDB Vector Database Wrapper
 *
 * Provides a typed interface for LanceDB operations including:
 * - Database connection management
 * - Table creation with vector schema
 * - Vector similarity search with cosine metric
 * - Storage monitoring for budget compliance
 */

import * as lancedb from "@lancedb/lancedb";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

/**
 * Document chunk with embedding vector for storage in LanceDB
 * Includes index signature for LanceDB Record<string, unknown> compatibility
 */
export interface DocumentChunk {
  /** Unique identifier for the chunk */
  id: string;
  /** Original text content of the chunk */
  text: string;
  /** Source document identifier (e.g., 'solana', 'sui') */
  source: string;
  /** Section or category within the source */
  section: string;
  /** 384-dimensional embedding vector */
  vector: number[];
  /** Chunk index within the original document */
  chunkIndex: number;
  /** Timestamp when chunk was created */
  createdAt: number;
  /** Index signature for LanceDB compatibility */
  [key: string]: string | number | number[];
}

/**
 * Search result from vector similarity query
 */
export interface SearchResult {
  id: string;
  text: string;
  source: string;
  section: string;
  chunkIndex: number;
  /** Distance/similarity score from query vector */
  _distance?: number;
}

/**
 * Configuration options for VectorDB
 */
export interface VectorDBConfig {
  /** Path to the LanceDB data directory */
  dataPath: string;
  /** Embedding vector dimension (default: 384 for all-MiniLM-L6-v2) */
  vectorDimension?: number;
  /** Storage budget in MB (default: 100) */
  storageBudgetMB?: number;
}

/**
 * Storage alert result from monitoring
 */
export interface StorageAlert {
  /** Alert severity level */
  severity: "info" | "warning" | "error";
  /** Human-readable alert message */
  message: string;
  /** Current storage size in MB */
  currentMB: number;
  /** Storage budget in MB (default: 100 MB) */
  budgetMB: number;
  /** Percentage of budget used */
  percentUsed: number;
  /** Whether storage is within budget */
  withinBudget: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Default embedding dimension for Xenova/all-MiniLM-L6-v2 model */
const DEFAULT_VECTOR_DIMENSION = 384;

/** Default storage budget in megabytes */
const DEFAULT_STORAGE_BUDGET_MB = 100;

/** Warning threshold as percentage of budget */
const STORAGE_WARNING_THRESHOLD = 0.8;

/** Default table name for documentation chunks */
const DEFAULT_TABLE_NAME = "docs";

// ============================================================================
// VectorDB Class
// ============================================================================

/**
 * LanceDB wrapper for vector storage operations
 *
 * Handles database connection, table management, and vector search
 * with support for cosine similarity metric.
 */
export class VectorDB {
  private config: Required<VectorDBConfig>;
  private db: lancedb.Connection | null = null;
  private tables: Map<string, lancedb.Table> = new Map();

  constructor(config: VectorDBConfig) {
    this.config = {
      dataPath: config.dataPath,
      vectorDimension: config.vectorDimension ?? DEFAULT_VECTOR_DIMENSION,
      storageBudgetMB: config.storageBudgetMB ?? DEFAULT_STORAGE_BUDGET_MB,
    };
  }

  /**
   * Connect to LanceDB database
   * Creates the data directory if it doesn't exist
   */
  async connect(): Promise<void> {
    if (this.db) {
      return; // Already connected
    }

    this.db = await lancedb.connect(this.config.dataPath);
  }

  /**
   * Ensure database is connected, throw if not
   */
  private ensureConnected(): lancedb.Connection {
    if (!this.db) {
      throw new Error(
        "VectorDB not connected. Call connect() before other operations.",
      );
    }
    return this.db;
  }

  /**
   * Create or overwrite a table with the document schema
   *
   * @param tableName - Name of the table to create
   * @param data - Initial data to populate the table
   * @param overwrite - Whether to overwrite existing table (default: true)
   */
  async createTable(
    tableName: string = DEFAULT_TABLE_NAME,
    data: DocumentChunk[],
    overwrite: boolean = true,
  ): Promise<lancedb.Table> {
    const db = this.ensureConnected();

    // Create table with data (LanceDB infers schema from data)
    const table = await db.createTable(tableName, data, {
      mode: overwrite ? "overwrite" : "create",
    });

    // Cache table reference
    this.tables.set(tableName, table);

    return table;
  }

  /**
   * Get an existing table by name
   *
   * @param tableName - Name of the table to retrieve
   * @returns Table instance or null if not found
   */
  async getTable(
    tableName: string = DEFAULT_TABLE_NAME,
  ): Promise<lancedb.Table | null> {
    // Check cache first
    const cached = this.tables.get(tableName);
    if (cached) {
      return cached;
    }

    const db = this.ensureConnected();

    try {
      const table = await db.openTable(tableName);
      this.tables.set(tableName, table);
      return table;
    } catch {
      // Table doesn't exist
      return null;
    }
  }

  /**
   * Check if a table exists
   *
   * @param tableName - Name of the table to check
   */
  async tableExists(tableName: string = DEFAULT_TABLE_NAME): Promise<boolean> {
    const db = this.ensureConnected();

    try {
      const tableNames = await db.tableNames();
      return tableNames.includes(tableName);
    } catch {
      return false;
    }
  }

  /**
   * Add documents to an existing table
   *
   * @param tableName - Name of the table
   * @param data - Documents to add
   */
  async addDocuments(
    tableName: string = DEFAULT_TABLE_NAME,
    data: DocumentChunk[],
  ): Promise<void> {
    const table = await this.getTable(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' does not exist`);
    }

    await table.add(data);
  }

  /**
   * Create an index on the vector column for faster similarity search
   * Only recommended when table has >1000 rows
   *
   * @param tableName - Name of the table to index
   */
  async createIndex(tableName: string = DEFAULT_TABLE_NAME): Promise<void> {
    const table = await this.getTable(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' does not exist`);
    }

    await table.createIndex("vector", {
      config: lancedb.Index.ivfPq({
        distanceType: "cosine",
      }),
    });
  }

  /**
   * Search for similar documents using vector similarity
   *
   * @param queryVector - 384-dimensional query embedding
   * @param tableName - Name of the table to search
   * @param limit - Maximum number of results (default: 10)
   * @param filter - Optional SQL filter expression
   * @returns Array of search results with distance scores
   */
  async search(
    queryVector: number[],
    tableName: string = DEFAULT_TABLE_NAME,
    limit: number = 10,
    filter?: string,
  ): Promise<SearchResult[]> {
    const table = await this.getTable(tableName);
    if (!table) {
      return []; // Return empty if table doesn't exist
    }

    // Validate vector dimension
    if (queryVector.length !== this.config.vectorDimension) {
      throw new Error(
        `Query vector dimension (${queryVector.length}) does not match expected dimension (${this.config.vectorDimension})`,
      );
    }

    // Build search query
    let query = table.vectorSearch(queryVector).limit(limit);

    if (filter) {
      query = query.where(filter);
    }

    const results = await query.toArray();

    // Map results to SearchResult type
    return results.map((row) => ({
      id: row.id as string,
      text: row.text as string,
      source: row.source as string,
      section: row.section as string,
      chunkIndex: row.chunkIndex as number,
      _distance: row._distance as number | undefined,
    }));
  }

  /**
   * Get the count of documents in a table
   *
   * @param tableName - Name of the table
   */
  async getDocumentCount(
    tableName: string = DEFAULT_TABLE_NAME,
  ): Promise<number> {
    const table = await this.getTable(tableName);
    if (!table) {
      return 0;
    }

    return await table.countRows();
  }

  /**
   * Delete a table
   *
   * @param tableName - Name of the table to delete
   */
  async deleteTable(tableName: string = DEFAULT_TABLE_NAME): Promise<void> {
    const db = this.ensureConnected();

    await db.dropTable(tableName);
    this.tables.delete(tableName);
  }

  /**
   * List all table names in the database
   */
  async listTables(): Promise<string[]> {
    const db = this.ensureConnected();
    return await db.tableNames();
  }

  /**
   * Get storage size of the vector database in bytes
   * Calculates the total size of all files in the data directory
   * Returns 0 if unable to calculate or directory doesn't exist
   */
  async getStorageSize(): Promise<number> {
    try {
      return this.calculateDirectorySize(this.config.dataPath);
    } catch {
      // Directory doesn't exist or can't be read
      return 0;
    }
  }

  /**
   * Recursively calculate the total size of a directory in bytes
   */
  private calculateDirectorySize(dirPath: string): number {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    let totalSize = 0;
    const entries = fs.readdirSync(dirPath);

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const entryStats = fs.statSync(entryPath);
        if (entryStats.isDirectory()) {
          totalSize += this.calculateDirectorySize(entryPath);
        } else {
          totalSize += entryStats.size;
        }
      } catch {
        // Skip entries that can't be read
        continue;
      }
    }

    return totalSize;
  }

  /**
   * Check if storage is within budget
   * Returns { withinBudget, currentMB, budgetMB, warningLevel }
   */
  async checkStorageBudget(): Promise<{
    withinBudget: boolean;
    currentMB: number;
    budgetMB: number;
    warningLevel: "ok" | "warning" | "exceeded";
  }> {
    const sizeBytes = await this.getStorageSize();
    const currentMB = sizeBytes / (1024 * 1024);
    const budgetMB = this.config.storageBudgetMB;

    let warningLevel: "ok" | "warning" | "exceeded" = "ok";
    if (currentMB >= budgetMB) {
      warningLevel = "exceeded";
    } else if (currentMB >= budgetMB * STORAGE_WARNING_THRESHOLD) {
      warningLevel = "warning";
    }

    return {
      withinBudget: currentMB < budgetMB,
      currentMB,
      budgetMB,
      warningLevel,
    };
  }

  /**
   * Monitor storage and return alert information
   * Returns a StorageAlert object with details about current storage status
   *
   * Storage budget: 100 MB default
   * Warning threshold: 80% (80 MB)
   * Error threshold: 100% (100 MB)
   */
  async monitorStorage(): Promise<StorageAlert> {
    const status = await this.checkStorageBudget();
    const percentUsed = (status.currentMB / status.budgetMB) * 100;

    let message: string;
    let severity: "info" | "warning" | "error";

    if (status.warningLevel === "exceeded") {
      // Storage exceeds 100 MB budget
      severity = "error";
      message = `STORAGE ALERT: Vector DB storage (${status.currentMB.toFixed(2)} MB) exceeds 100 MB budget! Consider clearing old data or increasing budget.`;
    } else if (status.warningLevel === "warning") {
      // Storage exceeds 80% of 100 MB budget (80 MB)
      severity = "warning";
      message = `STORAGE WARNING: Vector DB storage at ${percentUsed.toFixed(1)}% (${status.currentMB.toFixed(2)} MB / ${status.budgetMB} MB). Approaching 100 MB limit.`;
    } else {
      severity = "info";
      message = `Storage OK: ${status.currentMB.toFixed(2)} MB / ${status.budgetMB} MB (${percentUsed.toFixed(1)}%)`;
    }

    return {
      severity,
      message,
      currentMB: status.currentMB,
      budgetMB: status.budgetMB,
      percentUsed,
      withinBudget: status.withinBudget,
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.tables.clear();
    this.db = null;
  }

  /**
   * Get the configured vector dimension
   */
  getVectorDimension(): number {
    return this.config.vectorDimension;
  }

  /**
   * Get the configured data path
   */
  getDataPath(): string {
    return this.config.dataPath;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and connect a VectorDB instance
 *
 * @param dataPath - Path to the LanceDB data directory
 * @param options - Additional configuration options
 * @returns Connected VectorDB instance
 */
export async function createVectorDB(
  dataPath: string,
  options?: Partial<Omit<VectorDBConfig, "dataPath">>,
): Promise<VectorDB> {
  const db = new VectorDB({
    dataPath,
    ...options,
  });

  await db.connect();
  return db;
}
