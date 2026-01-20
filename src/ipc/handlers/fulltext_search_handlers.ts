/**
 * Full-Text Search Handlers
 * SQLite FTS5-powered search for datasets
 * 
 * Features:
 * - Full-text search with ranking
 * - Fuzzy matching
 * - Faceted search
 * - Search suggestions
 * - Saved searches
 * - Search analytics
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";
import { db } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  datasetItems,
  studioDatasets,
} from "@/db/schema";

const logger = log.scope("fulltext_search");

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  itemId: string;
  datasetId: string;
  datasetName: string;
  snippet: string;
  rank: number;
  highlights: string[];
  metadata: Record<string, any>;
}

interface SearchQuery {
  query: string;
  datasetIds?: string[];
  modalities?: string[];
  splits?: string[];
  limit?: number;
  offset?: number;
  sortBy?: "rank" | "date" | "size";
  sortOrder?: "asc" | "desc";
  filters?: Record<string, any>;
}

interface SearchSuggestion {
  text: string;
  type: "term" | "phrase" | "recent" | "popular";
  score: number;
}

interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  createdAt: Date;
  lastUsed?: Date;
  useCount: number;
}

interface SearchAnalytics {
  queryId: string;
  query: string;
  resultCount: number;
  executionTimeMs: number;
  timestamp: Date;
  clicked?: boolean;
  clickedItemId?: string;
}

// ============================================================================
// FTS Database
// ============================================================================

let ftsDb: Database.Database | null = null;
let savedSearches: Map<string, SavedSearch> = new Map();
let searchHistory: SearchAnalytics[] = [];

function getFtsDbPath(): string {
  return path.join(app.getPath("userData"), "search-index.db");
}

function getSavedSearchesPath(): string {
  return path.join(app.getPath("userData"), "saved-searches.json");
}

function getSearchHistoryPath(): string {
  return path.join(app.getPath("userData"), "search-history.json");
}

async function initializeFtsDatabase() {
  const dbPath = getFtsDbPath();
  
  ftsDb = new Database(dbPath);
  
  // Create FTS5 virtual table
  ftsDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      item_id,
      dataset_id,
      content,
      metadata_text,
      labels_text,
      tokenize='porter unicode61'
    );
  `);
  
  // Create auxiliary tables
  ftsDb.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      item_id TEXT PRIMARY KEY,
      dataset_id TEXT,
      modality TEXT,
      split TEXT,
      size_bytes INTEGER,
      created_at TEXT,
      indexed_at TEXT
    );
  `);
  
  // Create term frequency table for suggestions
  ftsDb.exec(`
    CREATE TABLE IF NOT EXISTS term_frequencies (
      term TEXT PRIMARY KEY,
      frequency INTEGER,
      last_seen TEXT
    );
  `);
  
  // Load saved searches
  const savedPath = getSavedSearchesPath();
  if (await fs.pathExists(savedPath)) {
    const data = await fs.readJson(savedPath);
    savedSearches = new Map(Object.entries(data));
  }
  
  // Load search history (recent only)
  const historyPath = getSearchHistoryPath();
  if (await fs.pathExists(historyPath)) {
    const data = await fs.readJson(historyPath);
    searchHistory = data.slice(-1000); // Keep last 1000
  }
  
  logger.info("FTS database initialized");
}

async function saveSavedSearches() {
  const savedPath = getSavedSearchesPath();
  await fs.writeJson(savedPath, Object.fromEntries(savedSearches), { spaces: 2 });
}

async function saveSearchHistory() {
  const historyPath = getSearchHistoryPath();
  // Keep only last 1000 entries
  const toSave = searchHistory.slice(-1000);
  await fs.writeJson(historyPath, toSave, { spaces: 2 });
}

function updateTermFrequencies(text: string) {
  if (!ftsDb) return;
  
  // Extract terms
  const terms = text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3);
  
  const stmt = ftsDb.prepare(`
    INSERT INTO term_frequencies (term, frequency, last_seen)
    VALUES (?, 1, ?)
    ON CONFLICT(term) DO UPDATE SET
      frequency = frequency + 1,
      last_seen = excluded.last_seen
  `);
  
  const now = new Date().toISOString();
  for (const term of terms) {
    stmt.run(term, now);
  }
}

// Internal search query function (to avoid recursive IPC calls)
async function executeSearchQueryInternal(query: SearchQuery): Promise<{
  success: boolean;
  results: SearchResult[];
  total: number;
  executionTimeMs: number;
  queryId: string;
}> {
  if (!ftsDb) throw new Error("Search index not initialized");
  
  const startTime = Date.now();
  const {
    query: searchText,
    datasetIds,
    modalities,
    splits,
    limit = 50,
    offset = 0,
    sortBy = "rank",
    sortOrder = "desc",
  } = query;
  
  // Build FTS query
  let ftsQuery = searchText
    .replace(/[^\w\s"]/g, " ")
    .trim();
  
  // Support phrase matching
  if (!ftsQuery.includes('"')) {
    ftsQuery = ftsQuery
      .split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => `"${t}"*`)
      .join(" OR ");
  }
  
  if (!ftsQuery) {
    return { success: true, results: [], total: 0, executionTimeMs: 0, queryId: uuidv4() };
  }
  
  // Build filter conditions
  let filterConditions: string[] = [];
  let filterParams: any[] = [];
  
  if (datasetIds && datasetIds.length > 0) {
    filterConditions.push(`m.dataset_id IN (${datasetIds.map(() => "?").join(",")})`);
    filterParams.push(...datasetIds);
  }
  
  if (modalities && modalities.length > 0) {
    filterConditions.push(`m.modality IN (${modalities.map(() => "?").join(",")})`);
    filterParams.push(...modalities);
  }
  
  if (splits && splits.length > 0) {
    filterConditions.push(`m.split IN (${splits.map(() => "?").join(",")})`);
    filterParams.push(...splits);
  }
  
  const filterClause = filterConditions.length > 0
    ? `AND ${filterConditions.join(" AND ")}`
    : "";
  
  // Sort clause
  let orderClause = "ORDER BY rank";
  if (sortBy === "date") {
    orderClause = `ORDER BY m.created_at ${sortOrder === "asc" ? "ASC" : "DESC"}`;
  } else if (sortBy === "size") {
    orderClause = `ORDER BY m.size_bytes ${sortOrder === "asc" ? "ASC" : "DESC"}`;
  } else {
    orderClause = `ORDER BY rank ${sortOrder === "asc" ? "ASC" : "DESC"}`;
  }
  
  // Execute search
  const searchSql = `
    SELECT 
      s.item_id,
      s.dataset_id,
      snippet(search_index, 2, '<mark>', '</mark>', '...', 64) as snippet,
      bm25(search_index) as rank,
      m.modality,
      m.split,
      m.size_bytes,
      m.created_at
    FROM search_index s
    JOIN index_metadata m ON s.item_id = m.item_id
    WHERE search_index MATCH ?
    ${filterClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `;
  
  const results = ftsDb.prepare(searchSql).all(ftsQuery, ...filterParams, limit, offset) as any[];
  
  // Get total count
  const countSql = `
    SELECT COUNT(*) as count
    FROM search_index s
    JOIN index_metadata m ON s.item_id = m.item_id
    WHERE search_index MATCH ?
    ${filterClause}
  `;
  const totalResult = ftsDb.prepare(countSql).get(ftsQuery, ...filterParams) as any;
  const total = totalResult?.count || 0;
  
  // Get dataset names
  const datasetIdList = [...new Set(results.map(r => r.dataset_id))];
  let datasetNames: Record<string, string> = {};
  
  if (datasetIdList.length > 0) {
    const dsResults = await db.select({ id: studioDatasets.id, name: studioDatasets.name })
      .from(studioDatasets)
      .where(inArray(studioDatasets.id, datasetIdList));
    datasetNames = Object.fromEntries(dsResults.map(d => [d.id, d.name]));
  }
  
  const executionTimeMs = Date.now() - startTime;
  
  // Record analytics
  const analytics: SearchAnalytics = {
    queryId: uuidv4(),
    query: searchText,
    resultCount: total,
    executionTimeMs,
    timestamp: new Date(),
  };
  searchHistory.push(analytics);
  saveSearchHistory().catch(() => {});
  
  // Format results
  const formattedResults: SearchResult[] = results.map(r => ({
    itemId: r.item_id,
    datasetId: r.dataset_id,
    datasetName: datasetNames[r.dataset_id] || "Unknown",
    snippet: r.snippet,
    rank: Math.abs(r.rank),
    highlights: [],
    metadata: {
      modality: r.modality,
      split: r.split,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    },
  }));
  
  return {
    success: true,
    results: formattedResults,
    total,
    executionTimeMs,
    queryId: analytics.queryId,
  };
}

// Internal function for indexing a dataset (to avoid recursive IPC calls)
async function indexDatasetInternal(datasetId: string): Promise<{
  success: boolean;
  total: number;
  indexed: number;
  failed: number;
}> {
  if (!ftsDb) throw new Error("Search index not initialized");
  
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  
  let indexed = 0;
  let failed = 0;
  
  for (const item of items) {
    try {
      // Load content
      const storeDir = path.join(app.getPath("userData"), "content-store");
      const prefix = item.contentHash.substring(0, 2);
      const contentPath = path.join(storeDir, prefix, item.contentHash);
      
      let content = "";
      try {
        content = await fs.readFile(contentPath, "utf-8");
      } catch {
        // Binary content
      }
      
      const labelsText = item.labelsJson ? JSON.stringify(item.labelsJson) : "";
      
      // Delete existing
      ftsDb.prepare("DELETE FROM search_index WHERE item_id = ?").run(item.id);
      ftsDb.prepare("DELETE FROM index_metadata WHERE item_id = ?").run(item.id);
      
      // Insert
      ftsDb.prepare(`
        INSERT INTO search_index (item_id, dataset_id, content, metadata_text, labels_text)
        VALUES (?, ?, ?, ?, ?)
      `).run(item.id, item.datasetId, content, labelsText, labelsText);
      
      ftsDb.prepare(`
        INSERT INTO index_metadata (item_id, dataset_id, modality, split, size_bytes, created_at, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.datasetId,
        item.modality,
        item.split,
        item.byteSize,
        item.createdAt?.toISOString(),
        new Date().toISOString()
      );
      
      updateTermFrequencies(content + " " + labelsText);
      indexed++;
    } catch {
      failed++;
    }
  }
  
  return {
    success: true,
    total: items.length,
    indexed,
    failed,
  };
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerFullTextSearchHandlers() {
  logger.info("Registering Full-Text Search handlers");

  // Initialize on app ready
  app.whenReady().then(() => {
    initializeFtsDatabase().catch(err => {
      logger.error("Failed to initialize FTS database:", err);
    });
  });

  // ========== Indexing ==========

  /**
   * Index a single item
   */
  ipcMain.handle("search:index-item", async (_event, itemId: string) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!item) throw new Error("Item not found");
      
      // Load content
      const storeDir = path.join(app.getPath("userData"), "content-store");
      const prefix = item.contentHash.substring(0, 2);
      const contentPath = path.join(storeDir, prefix, item.contentHash);
      
      let content = "";
      try {
        content = await fs.readFile(contentPath, "utf-8");
      } catch {
        // Binary content - use metadata only
      }
      
      // Extract text from labels (metadata is not a field in schema)
      const labelsText = item.labelsJson
        ? JSON.stringify(item.labelsJson)
        : "";
      
      // Delete existing entry
      ftsDb.prepare("DELETE FROM search_index WHERE item_id = ?").run(itemId);
      ftsDb.prepare("DELETE FROM index_metadata WHERE item_id = ?").run(itemId);
      
      // Insert into FTS table
      ftsDb.prepare(`
        INSERT INTO search_index (item_id, dataset_id, content, metadata_text, labels_text)
        VALUES (?, ?, ?, ?, ?)
      `).run(itemId, item.datasetId, content, labelsText, labelsText);
      
      // Insert metadata
      ftsDb.prepare(`
        INSERT INTO index_metadata (item_id, dataset_id, modality, split, size_bytes, created_at, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        itemId,
        item.datasetId,
        item.modality,
        item.split,
        item.byteSize,
        item.createdAt?.toISOString(),
        new Date().toISOString()
      );
      
      // Update term frequencies
      updateTermFrequencies(content + " " + labelsText);
      
      return { success: true };
    } catch (error) {
      logger.error("Index item failed:", error);
      throw error;
    }
  });

  /**
   * Index entire dataset
   */
  ipcMain.handle("search:index-dataset", async (event, datasetId: string) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      let indexed = 0;
      let failed = 0;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        try {
          // Load content
          const storeDir = path.join(app.getPath("userData"), "content-store");
          const prefix = item.contentHash.substring(0, 2);
          const contentPath = path.join(storeDir, prefix, item.contentHash);
          
          let content = "";
          try {
            content = await fs.readFile(contentPath, "utf-8");
          } catch {
            // Binary content
          }
          
          const labelsText = item.labelsJson ? JSON.stringify(item.labelsJson) : "";
          
          // Delete existing
          ftsDb.prepare("DELETE FROM search_index WHERE item_id = ?").run(item.id);
          ftsDb.prepare("DELETE FROM index_metadata WHERE item_id = ?").run(item.id);
          
          // Insert
          ftsDb.prepare(`
            INSERT INTO search_index (item_id, dataset_id, content, metadata_text, labels_text)
            VALUES (?, ?, ?, ?, ?)
          `).run(item.id, item.datasetId, content, labelsText, labelsText);
          
          ftsDb.prepare(`
            INSERT INTO index_metadata (item_id, dataset_id, modality, split, size_bytes, created_at, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            item.id,
            item.datasetId,
            item.modality,
            item.split,
            item.byteSize,
            item.createdAt?.toISOString(),
            new Date().toISOString()
          );
          
          updateTermFrequencies(content + " " + labelsText);
          indexed++;
        } catch (err) {
          failed++;
        }
        
        // Progress
        if ((i + 1) % 50 === 0 || i === items.length - 1) {
          event.sender.send("search:index-progress", {
            current: i + 1,
            total: items.length,
            indexed,
            failed,
          });
        }
      }
      
      return {
        success: true,
        total: items.length,
        indexed,
        failed,
      };
    } catch (error) {
      logger.error("Index dataset failed:", error);
      throw error;
    }
  });

  /**
   * Remove item from index
   */
  ipcMain.handle("search:remove-from-index", async (_event, itemId: string) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      ftsDb.prepare("DELETE FROM search_index WHERE item_id = ?").run(itemId);
      ftsDb.prepare("DELETE FROM index_metadata WHERE item_id = ?").run(itemId);
      
      return { success: true };
    } catch (error) {
      logger.error("Remove from index failed:", error);
      throw error;
    }
  });

  /**
   * Get index statistics
   */
  ipcMain.handle("search:get-index-stats", async () => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const totalItems = ftsDb.prepare("SELECT COUNT(*) as count FROM index_metadata").get() as any;
      const byDataset = ftsDb.prepare(`
        SELECT dataset_id, COUNT(*) as count 
        FROM index_metadata 
        GROUP BY dataset_id
      `).all() as any[];
      const byModality = ftsDb.prepare(`
        SELECT modality, COUNT(*) as count 
        FROM index_metadata 
        GROUP BY modality
      `).all() as any[];
      const termCount = ftsDb.prepare("SELECT COUNT(*) as count FROM term_frequencies").get() as any;
      
      return {
        success: true,
        stats: {
          totalItems: totalItems?.count || 0,
          byDataset,
          byModality,
          uniqueTerms: termCount?.count || 0,
        },
      };
    } catch (error) {
      logger.error("Get index stats failed:", error);
      throw error;
    }
  });

  // ========== Search ==========

  /**
   * Full-text search
   */
  ipcMain.handle("search:query", async (_event, query: SearchQuery) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const startTime = Date.now();
      const {
        query: searchText,
        datasetIds,
        modalities,
        splits,
        limit = 50,
        offset = 0,
        sortBy = "rank",
        sortOrder = "desc",
      } = query;
      
      // Build FTS query
      let ftsQuery = searchText
        .replace(/[^\w\s"]/g, " ")
        .trim();
      
      // Support phrase matching
      if (!ftsQuery.includes('"')) {
        // Add prefix matching for better results
        ftsQuery = ftsQuery
          .split(/\s+/)
          .filter(t => t.length > 0)
          .map(t => `"${t}"*`)
          .join(" OR ");
      }
      
      if (!ftsQuery) {
        return { success: true, results: [], total: 0 };
      }
      
      // Build filter conditions
      let filterConditions: string[] = [];
      let filterParams: any[] = [];
      
      if (datasetIds && datasetIds.length > 0) {
        filterConditions.push(`m.dataset_id IN (${datasetIds.map(() => "?").join(",")})`);
        filterParams.push(...datasetIds);
      }
      
      if (modalities && modalities.length > 0) {
        filterConditions.push(`m.modality IN (${modalities.map(() => "?").join(",")})`);
        filterParams.push(...modalities);
      }
      
      if (splits && splits.length > 0) {
        filterConditions.push(`m.split IN (${splits.map(() => "?").join(",")})`);
        filterParams.push(...splits);
      }
      
      const filterClause = filterConditions.length > 0
        ? `AND ${filterConditions.join(" AND ")}`
        : "";
      
      // Sort clause
      let orderClause = "ORDER BY rank";
      if (sortBy === "date") {
        orderClause = `ORDER BY m.created_at ${sortOrder === "asc" ? "ASC" : "DESC"}`;
      } else if (sortBy === "size") {
        orderClause = `ORDER BY m.size_bytes ${sortOrder === "asc" ? "ASC" : "DESC"}`;
      } else {
        orderClause = `ORDER BY rank ${sortOrder === "asc" ? "ASC" : "DESC"}`;
      }
      
      // Execute search
      const searchSql = `
        SELECT 
          s.item_id,
          s.dataset_id,
          snippet(search_index, 2, '<mark>', '</mark>', '...', 64) as snippet,
          bm25(search_index) as rank,
          m.modality,
          m.split,
          m.size_bytes,
          m.created_at
        FROM search_index s
        JOIN index_metadata m ON s.item_id = m.item_id
        WHERE search_index MATCH ?
        ${filterClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;
      
      const results = ftsDb.prepare(searchSql).all(ftsQuery, ...filterParams, limit, offset) as any[];
      
      // Get total count
      const countSql = `
        SELECT COUNT(*) as count
        FROM search_index s
        JOIN index_metadata m ON s.item_id = m.item_id
        WHERE search_index MATCH ?
        ${filterClause}
      `;
      const totalResult = ftsDb.prepare(countSql).get(ftsQuery, ...filterParams) as any;
      const total = totalResult?.count || 0;
      
      // Get dataset names
      const datasetIdList = [...new Set(results.map(r => r.dataset_id))];
      let datasetNames: Record<string, string> = {};
      
      if (datasetIdList.length > 0) {
        const dsResults = await db.select({ id: studioDatasets.id, name: studioDatasets.name })
          .from(studioDatasets)
          .where(inArray(studioDatasets.id, datasetIdList));
        datasetNames = Object.fromEntries(dsResults.map(d => [d.id, d.name]));
      }
      
      const executionTimeMs = Date.now() - startTime;
      
      // Record analytics
      const analytics: SearchAnalytics = {
        queryId: uuidv4(),
        query: searchText,
        resultCount: total,
        executionTimeMs,
        timestamp: new Date(),
      };
      searchHistory.push(analytics);
      saveSearchHistory().catch(() => {});
      
      // Format results
      const formattedResults: SearchResult[] = results.map(r => ({
        itemId: r.item_id,
        datasetId: r.dataset_id,
        datasetName: datasetNames[r.dataset_id] || "Unknown",
        snippet: r.snippet,
        rank: Math.abs(r.rank), // BM25 returns negative values
        highlights: [],
        metadata: {
          modality: r.modality,
          split: r.split,
          sizeBytes: r.size_bytes,
          createdAt: r.created_at,
        },
      }));
      
      return {
        success: true,
        results: formattedResults,
        total,
        executionTimeMs,
        queryId: analytics.queryId,
      };
    } catch (error) {
      logger.error("Search query failed:", error);
      throw error;
    }
  });

  /**
   * Get search suggestions
   */
  ipcMain.handle("search:suggestions", async (_event, prefix: string) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const suggestions: SearchSuggestion[] = [];
      const lowerPrefix = prefix.toLowerCase();
      
      // Get term suggestions
      const termResults = ftsDb.prepare(`
        SELECT term, frequency
        FROM term_frequencies
        WHERE term LIKE ?
        ORDER BY frequency DESC
        LIMIT 5
      `).all(`${lowerPrefix}%`) as any[];
      
      for (const result of termResults) {
        suggestions.push({
          text: result.term,
          type: "term",
          score: result.frequency,
        });
      }
      
      // Get recent searches
      const recentSearches = searchHistory
        .filter(h => h.query.toLowerCase().startsWith(lowerPrefix))
        .slice(-5)
        .reverse();
      
      for (const search of recentSearches) {
        if (!suggestions.some(s => s.text === search.query)) {
          suggestions.push({
            text: search.query,
            type: "recent",
            score: 0.5,
          });
        }
      }
      
      // Sort by score
      suggestions.sort((a, b) => b.score - a.score);
      
      return { success: true, suggestions: suggestions.slice(0, 10) };
    } catch (error) {
      logger.error("Get suggestions failed:", error);
      throw error;
    }
  });

  /**
   * Fuzzy search (for typo tolerance)
   */
  ipcMain.handle("search:fuzzy", async (_event, args: {
    query: string;
    maxDistance?: number;
    limit?: number;
  }) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      const { query: searchText, maxDistance = 2, limit = 20 } = args;
      
      // Get all terms that might match
      const terms = ftsDb.prepare(`
        SELECT DISTINCT term FROM term_frequencies
      `).all() as any[];
      
      // Simple Levenshtein distance calculation
      function levenshtein(a: string, b: string): number {
        const matrix: number[][] = [];
        
        for (let i = 0; i <= a.length; i++) {
          matrix[i] = [i];
        }
        for (let j = 0; j <= b.length; j++) {
          matrix[0][j] = j;
        }
        
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
              matrix[i - 1][j] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j - 1] + cost
            );
          }
        }
        
        return matrix[a.length][b.length];
      }
      
      // Find similar terms
      const queryTerms = searchText.toLowerCase().split(/\s+/);
      const matchedTerms: string[] = [];
      
      for (const queryTerm of queryTerms) {
        const similar = terms
          .map(t => ({ term: t.term, distance: levenshtein(queryTerm, t.term) }))
          .filter(t => t.distance <= maxDistance)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);
        
        matchedTerms.push(...similar.map(s => s.term));
      }
      
      if (matchedTerms.length === 0) {
        return { success: true, results: [], total: 0, suggestions: [] };
      }
      
      // Search with matched terms
      const ftsQuery = matchedTerms.map(t => `"${t}"`).join(" OR ");
      
      const results = ftsDb.prepare(`
        SELECT 
          s.item_id,
          s.dataset_id,
          snippet(search_index, 2, '<mark>', '</mark>', '...', 64) as snippet,
          bm25(search_index) as rank
        FROM search_index s
        WHERE search_index MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as any[];
      
      return {
        success: true,
        results: results.map(r => ({
          itemId: r.item_id,
          datasetId: r.dataset_id,
          snippet: r.snippet,
          rank: Math.abs(r.rank),
        })),
        total: results.length,
        correctedTerms: matchedTerms,
      };
    } catch (error) {
      logger.error("Fuzzy search failed:", error);
      throw error;
    }
  });

  // ========== Saved Searches ==========

  /**
   * Save a search
   */
  ipcMain.handle("search:save", async (_event, args: {
    name: string;
    query: SearchQuery;
  }) => {
    try {
      const { name, query } = args;
      
      const savedSearch: SavedSearch = {
        id: uuidv4(),
        name,
        query,
        createdAt: new Date(),
        useCount: 0,
      };
      
      savedSearches.set(savedSearch.id, savedSearch);
      await saveSavedSearches();
      
      return { success: true, search: savedSearch };
    } catch (error) {
      logger.error("Save search failed:", error);
      throw error;
    }
  });

  /**
   * List saved searches
   */
  ipcMain.handle("search:list-saved", async () => {
    try {
      return { success: true, searches: Array.from(savedSearches.values()) };
    } catch (error) {
      logger.error("List saved searches failed:", error);
      throw error;
    }
  });

  /**
   * Delete saved search
   */
  ipcMain.handle("search:delete-saved", async (_event, searchId: string) => {
    try {
      if (!savedSearches.has(searchId)) throw new Error("Saved search not found");
      
      savedSearches.delete(searchId);
      await saveSavedSearches();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete saved search failed:", error);
      throw error;
    }
  });

  /**
   * Execute saved search
   */
  ipcMain.handle("search:execute-saved", async (_event, searchId: string) => {
    try {
      const savedSearch = savedSearches.get(searchId);
      if (!savedSearch) throw new Error("Saved search not found");
      
      // Update usage stats
      savedSearch.lastUsed = new Date();
      savedSearch.useCount++;
      savedSearches.set(searchId, savedSearch);
      await saveSavedSearches();
      
      // Execute the query using internal function
      const result = await executeSearchQueryInternal(savedSearch.query);
      
      return result;
    } catch (error) {
      logger.error("Execute saved search failed:", error);
      throw error;
    }
  });

  // ========== Search Analytics ==========

  /**
   * Get search analytics
   */
  ipcMain.handle("search:get-analytics", async (_event, args?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }) => {
    try {
      let history = [...searchHistory];
      
      if (args?.startDate) {
        const start = new Date(args.startDate);
        history = history.filter(h => new Date(h.timestamp) >= start);
      }
      
      if (args?.endDate) {
        const end = new Date(args.endDate);
        history = history.filter(h => new Date(h.timestamp) <= end);
      }
      
      // Calculate statistics
      const totalSearches = history.length;
      const avgResultCount = history.length > 0
        ? history.reduce((sum, h) => sum + h.resultCount, 0) / history.length
        : 0;
      const avgExecutionTime = history.length > 0
        ? history.reduce((sum, h) => sum + h.executionTimeMs, 0) / history.length
        : 0;
      
      // Popular queries
      const queryFrequency: Map<string, number> = new Map();
      for (const h of history) {
        const q = h.query.toLowerCase();
        queryFrequency.set(q, (queryFrequency.get(q) || 0) + 1);
      }
      
      const popularQueries = Array.from(queryFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([query, count]) => ({ query, count }));
      
      // Zero result queries
      const zeroResultQueries = history
        .filter(h => h.resultCount === 0)
        .map(h => h.query)
        .filter((q, i, arr) => arr.indexOf(q) === i)
        .slice(0, 10);
      
      return {
        success: true,
        analytics: {
          totalSearches,
          avgResultCount,
          avgExecutionTime,
          popularQueries,
          zeroResultQueries,
          recentSearches: history.slice(-20).reverse(),
        },
      };
    } catch (error) {
      logger.error("Get search analytics failed:", error);
      throw error;
    }
  });

  /**
   * Record search click (for ranking improvement)
   */
  ipcMain.handle("search:record-click", async (_event, args: {
    queryId: string;
    itemId: string;
  }) => {
    try {
      const { queryId, itemId } = args;
      
      const analytics = searchHistory.find(h => h.queryId === queryId);
      if (analytics) {
        analytics.clicked = true;
        analytics.clickedItemId = itemId;
        await saveSearchHistory();
      }
      
      return { success: true };
    } catch (error) {
      logger.error("Record click failed:", error);
      throw error;
    }
  });

  /**
   * Clear search history
   */
  ipcMain.handle("search:clear-history", async () => {
    try {
      searchHistory = [];
      await saveSearchHistory();
      return { success: true };
    } catch (error) {
      logger.error("Clear search history failed:", error);
      throw error;
    }
  });

  // ========== Faceted Search ==========

  /**
   * Get facets for search results
   */
  ipcMain.handle("search:get-facets", async (_event, query?: string) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      let baseCondition = "";
      let params: any[] = [];
      
      if (query) {
        const ftsQuery = query
          .replace(/[^\w\s"]/g, " ")
          .trim()
          .split(/\s+/)
          .filter(t => t.length > 0)
          .map(t => `"${t}"*`)
          .join(" OR ");
        
        if (ftsQuery) {
          baseCondition = "WHERE s.item_id IN (SELECT item_id FROM search_index WHERE search_index MATCH ?)";
          params = [ftsQuery];
        }
      }
      
      // Get modality facets
      const modalityFacets = ftsDb.prepare(`
        SELECT m.modality as value, COUNT(*) as count
        FROM index_metadata m
        ${baseCondition ? `JOIN search_index s ON m.item_id = s.item_id ${baseCondition}` : ""}
        GROUP BY m.modality
        ORDER BY count DESC
      `).all(...params) as any[];
      
      // Get split facets
      const splitFacets = ftsDb.prepare(`
        SELECT m.split as value, COUNT(*) as count
        FROM index_metadata m
        ${baseCondition ? `JOIN search_index s ON m.item_id = s.item_id ${baseCondition}` : ""}
        GROUP BY m.split
        ORDER BY count DESC
      `).all(...params) as any[];
      
      // Get dataset facets
      const datasetFacets = ftsDb.prepare(`
        SELECT m.dataset_id as value, COUNT(*) as count
        FROM index_metadata m
        ${baseCondition ? `JOIN search_index s ON m.item_id = s.item_id ${baseCondition}` : ""}
        GROUP BY m.dataset_id
        ORDER BY count DESC
        LIMIT 10
      `).all(...params) as any[];
      
      // Get dataset names
      const datasetIds = datasetFacets.map(f => f.value);
      let datasetNames: Record<string, string> = {};
      
      if (datasetIds.length > 0) {
        const dsResults = await db.select({ id: studioDatasets.id, name: studioDatasets.name })
          .from(studioDatasets)
          .where(inArray(studioDatasets.id, datasetIds));
        datasetNames = Object.fromEntries(dsResults.map(d => [d.id, d.name]));
      }
      
      return {
        success: true,
        facets: {
          modality: modalityFacets,
          split: splitFacets,
          dataset: datasetFacets.map(f => ({
            ...f,
            name: datasetNames[f.value] || f.value,
          })),
        },
      };
    } catch (error) {
      logger.error("Get facets failed:", error);
      throw error;
    }
  });

  /**
   * Rebuild entire search index
   */
  ipcMain.handle("search:rebuild-index", async (_event) => {
    try {
      if (!ftsDb) throw new Error("Search index not initialized");
      
      // Clear existing index
      ftsDb.exec("DELETE FROM search_index");
      ftsDb.exec("DELETE FROM index_metadata");
      ftsDb.exec("DELETE FROM term_frequencies");
      
      // Get all datasets
      const allDatasets = await db.select({ id: studioDatasets.id }).from(studioDatasets);
      
      let totalIndexed = 0;
      let totalFailed = 0;
      
      for (const dataset of allDatasets) {
        // Use internal function instead of recursive IPC call
        const result = await indexDatasetInternal(dataset.id);
        totalIndexed += result.indexed || 0;
        totalFailed += result.failed || 0;
      }
      
      return {
        success: true,
        totalIndexed,
        totalFailed,
      };
    } catch (error) {
      logger.error("Rebuild index failed:", error);
      throw error;
    }
  });

  logger.info("Full-Text Search handlers registered");
}
