/**
 * sqlite-vec Backend for VectorStoreService
 *
 * Provides native vector similarity search using the sqlite-vec extension
 * loaded into the existing better-sqlite3 instance. This gives us KNN search
 * via virtual tables without any external process or dependency.
 *
 * Architecture:
 *   better-sqlite3 DB  →  loadExtension(sqlite-vec)  →  vec0 virtual tables
 *   Embeddings stored as float32 BLOBs, searched with distance_cosine / L2 / dot
 */

import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import Database, { Database as DatabaseType } from "better-sqlite3";

import type {
  CollectionId,
  DistanceMetric,
} from "@/types/sovereign_stack_types";

const logger = log.scope("sqlite_vec");

// =============================================================================
// EXTENSION LOADING
// =============================================================================

/**
 * Resolve the path to the sqlite-vec shared library for the current platform.
 * sqlite-vec ships per-platform packages: @anthropic/sqlite-vec-{platform}-{arch}
 * We also check for a local copy in the app's native modules directory.
 */
function resolveSqliteVecPath(): string | null {
  // Try require.resolve first — works when sqlite-vec is an npm dependency
  const candidates = [
    // npm package locations
    () => {
      try {
        return require.resolve("sqlite-vec");
      } catch {
        return null;
      }
    },
    // Electron asar-unpacked native modules
    () => {
      const base = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "sqlite-vec")
        : path.join(app.getAppPath(), "node_modules", "sqlite-vec");
      if (existsSync(base)) return base;
      return null;
    },
  ];

  for (const resolve of candidates) {
    const p = resolve();
    if (p) return p;
  }

  return null;
}

let _extensionLoaded = false;

/**
 * Load the sqlite-vec extension into a better-sqlite3 Database instance.
 * Calling this multiple times on the same DB is safe (idempotent).
 */
export function loadSqliteVec(db: DatabaseType): boolean {
  if (_extensionLoaded) return true;

  try {
    // sqlite-vec exposes a loadable() helper that returns the path to the .dll/.so/.dylib
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let vecModule: any;
    try {
      vecModule = require("sqlite-vec");
    } catch {
      logger.warn("sqlite-vec package not installed — vector search will use fallback brute-force");
      return false;
    }

    if (typeof vecModule.load === "function") {
      vecModule.load(db);
    } else if (typeof vecModule.loadable === "function") {
      const extPath = vecModule.loadable();
      db.loadExtension(extPath);
    } else {
      // Try loading it as a raw extension path
      const extPath = resolveSqliteVecPath();
      if (extPath) {
        db.loadExtension(extPath);
      } else {
        logger.warn("Could not resolve sqlite-vec extension path");
        return false;
      }
    }

    _extensionLoaded = true;
    logger.info("sqlite-vec extension loaded successfully");
    return true;
  } catch (error) {
    logger.warn("Failed to load sqlite-vec extension — using brute-force fallback", { error });
    return false;
  }
}

// =============================================================================
// SQLITE-VEC INDEX
// =============================================================================

export interface SqliteVecIndex {
  db: DatabaseType;
  collectionId: CollectionId;
  dimension: number;
  distanceMetric: DistanceMetric;
  usesNativeVec: boolean;
}

/**
 * Create or open a sqlite-vec backed vector index for a collection.
 */
export function createSqliteVecIndex(
  dbPath: string,
  collectionId: CollectionId,
  dimension: number,
  distanceMetric: DistanceMetric = "cosine",
): SqliteVecIndex {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const usesNativeVec = loadSqliteVec(db);

  // Create metadata tables (always)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      title TEXT,
      source TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS vec_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_pos INTEGER,
      end_pos INTEGER,
      metadata TEXT,
      FOREIGN KEY (document_id) REFERENCES vec_documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_vec_chunks_doc ON vec_chunks(document_id);
  `);

  if (usesNativeVec) {
    // Create the vec0 virtual table for native KNN search
    // sqlite-vec uses float[N] syntax for dimension
    const distFn = distanceMetric === "cosine" ? "cosine" : distanceMetric === "dot_product" || distanceMetric === "dot" ? "dot" : "L2";
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
          chunk_id TEXT PRIMARY KEY,
          embedding float[${dimension}] distance_metric=${distFn}
        );
      `);
    } catch (err) {
      logger.warn("Failed to create vec0 virtual table, using fallback", { err });
      // Fall through to create the fallback table
      createFallbackEmbeddingTable(db);
      return { db, collectionId, dimension, distanceMetric, usesNativeVec: false };
    }
  } else {
    createFallbackEmbeddingTable(db);
  }

  return { db, collectionId, dimension, distanceMetric, usesNativeVec };
}

function createFallbackEmbeddingTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_embeddings_fallback (
      chunk_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES vec_chunks(id) ON DELETE CASCADE
    );
  `);
}

// =============================================================================
// INSERT
// =============================================================================

/**
 * Insert a document with its chunks and embeddings into the index.
 */
export function insertDocument(
  index: SqliteVecIndex,
  doc: {
    id: string;
    content: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  },
  chunks: Array<{
    id: string;
    content: string;
    chunkIndex: number;
    startPos?: number;
    endPos?: number;
    embedding: number[];
  }>,
): void {
  const { db, usesNativeVec } = index;

  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO vec_documents (id, content, title, source, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `);

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO vec_chunks (id, document_id, content, chunk_index, start_pos, end_pos, metadata)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `);

  const insertNativeEmb = usesNativeVec
    ? db.prepare(`INSERT OR REPLACE INTO vec_embeddings (chunk_id, embedding) VALUES (?, ?)`)
    : null;

  const insertFallbackEmb = !usesNativeVec
    ? db.prepare(`INSERT OR REPLACE INTO vec_embeddings_fallback (chunk_id, embedding) VALUES (?, ?)`)
    : null;

  const tx = db.transaction(() => {
    insertDoc.run(
      doc.id,
      doc.content,
      doc.title ?? null,
      doc.source ?? null,
      doc.metadata ? JSON.stringify(doc.metadata) : null,
    );

    for (const chunk of chunks) {
      insertChunk.run(
        chunk.id,
        doc.id,
        chunk.content,
        chunk.chunkIndex,
        chunk.startPos ?? null,
        chunk.endPos ?? null,
      );

      const embBuf = float32ArrayToBuffer(chunk.embedding);
      if (insertNativeEmb) {
        insertNativeEmb.run(chunk.id, embBuf);
      } else if (insertFallbackEmb) {
        insertFallbackEmb.run(chunk.id, embBuf);
      }
    }
  });

  tx();
}

// =============================================================================
// SEARCH
// =============================================================================

export interface VecSearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  distance: number;
  title?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  chunkIndex: number;
}

/**
 * Perform KNN vector search.
 *
 * When native vec0 is available, uses the built-in KNN operator.
 * Otherwise falls back to brute-force cosine similarity in JS.
 */
export function searchVectors(
  index: SqliteVecIndex,
  queryEmbedding: number[],
  topK: number = 10,
  options?: {
    minScore?: number;
    filter?: Record<string, unknown>;
  },
): VecSearchResult[] {
  if (index.usesNativeVec) {
    return nativeSearch(index, queryEmbedding, topK, options);
  }
  return fallbackSearch(index, queryEmbedding, topK, options);
}

function nativeSearch(
  index: SqliteVecIndex,
  queryEmbedding: number[],
  topK: number,
  options?: { minScore?: number; filter?: Record<string, unknown> },
): VecSearchResult[] {
  const { db } = index;
  const queryBuf = float32ArrayToBuffer(queryEmbedding);

  // sqlite-vec KNN query syntax:
  //   SELECT * FROM vec_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance
  const rows = db.prepare(`
    SELECT
      ve.chunk_id,
      ve.distance,
      c.content,
      c.document_id,
      c.chunk_index,
      d.title,
      d.source,
      d.metadata
    FROM vec_embeddings ve
    JOIN vec_chunks c ON c.id = ve.chunk_id
    JOIN vec_documents d ON d.id = c.document_id
    WHERE ve.embedding MATCH ?
      AND k = ?
    ORDER BY ve.distance ASC
  `).all(queryBuf, topK) as Array<{
    chunk_id: string;
    distance: number;
    content: string;
    document_id: string;
    chunk_index: number;
    title: string | null;
    source: string | null;
    metadata: string | null;
  }>;

  let results: VecSearchResult[] = rows.map((r) => {
    // Convert distance to a similarity score (0-1 range, higher is better)
    const score = distanceToScore(r.distance, index.distanceMetric);
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      score,
      distance: r.distance,
      title: r.title ?? undefined,
      source: r.source ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      chunkIndex: r.chunk_index,
    };
  });

  // Apply min score filter
  if (options?.minScore) {
    results = results.filter((r) => r.score >= options.minScore!);
  }

  // Apply metadata filter
  if (options?.filter) {
    results = results.filter((r) => matchesFilter(r.metadata, options.filter!));
  }

  return results;
}

function fallbackSearch(
  index: SqliteVecIndex,
  queryEmbedding: number[],
  topK: number,
  options?: { minScore?: number; filter?: Record<string, unknown> },
): VecSearchResult[] {
  const { db } = index;

  const rows = db.prepare(`
    SELECT
      e.chunk_id,
      e.embedding,
      c.content,
      c.document_id,
      c.chunk_index,
      d.title,
      d.source,
      d.metadata
    FROM vec_embeddings_fallback e
    JOIN vec_chunks c ON c.id = e.chunk_id
    JOIN vec_documents d ON d.id = c.document_id
  `).all() as Array<{
    chunk_id: string;
    embedding: Buffer;
    content: string;
    document_id: string;
    chunk_index: number;
    title: string | null;
    source: string | null;
    metadata: string | null;
  }>;

  let scored = rows.map((r) => {
    const embedding = bufferToFloat32Array(r.embedding);
    const score = cosineSimilarity(queryEmbedding, embedding);
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      score,
      distance: 1 - score,
      title: r.title ?? undefined,
      source: r.source ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      chunkIndex: r.chunk_index,
    };
  });

  // Apply filters
  if (options?.minScore) {
    scored = scored.filter((r) => r.score >= options.minScore!);
  }
  if (options?.filter) {
    scored = scored.filter((r) => matchesFilter(r.metadata, options.filter!));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// =============================================================================
// DELETE
// =============================================================================

/**
 * Delete a document and all its chunks/embeddings from the index.
 */
export function deleteDocumentFromIndex(index: SqliteVecIndex, documentId: string): number {
  const { db, usesNativeVec } = index;

  // Get chunk IDs for cleanup
  const chunkIds: string[] = (
    db.prepare(`SELECT id FROM vec_chunks WHERE document_id = ?`).all(documentId) as Array<{ id: string }>
  ).map((r) => r.id);

  if (chunkIds.length === 0) return 0;

  const tx = db.transaction(() => {
    const embTable = usesNativeVec ? "vec_embeddings" : "vec_embeddings_fallback";
    const placeholders = chunkIds.map(() => "?").join(",");

    db.prepare(`DELETE FROM ${embTable} WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
    db.prepare(`DELETE FROM vec_chunks WHERE document_id = ?`).run(documentId);
    db.prepare(`DELETE FROM vec_documents WHERE id = ?`).run(documentId);
  });

  tx();
  return chunkIds.length;
}

/**
 * Drop the entire index (delete all data).
 */
export function dropIndex(index: SqliteVecIndex): void {
  const { db, usesNativeVec } = index;
  db.exec(`DELETE FROM ${usesNativeVec ? "vec_embeddings" : "vec_embeddings_fallback"}`);
  db.exec(`DELETE FROM vec_chunks`);
  db.exec(`DELETE FROM vec_documents`);
}

/**
 * Get stats for an index.
 */
export function getIndexStats(index: SqliteVecIndex): {
  documentCount: number;
  chunkCount: number;
  embeddingCount: number;
  usesNativeVec: boolean;
} {
  const { db, usesNativeVec } = index;
  const embTable = usesNativeVec ? "vec_embeddings" : "vec_embeddings_fallback";

  const docs = (db.prepare(`SELECT COUNT(*) as c FROM vec_documents`).get() as { c: number }).c;
  const chunks = (db.prepare(`SELECT COUNT(*) as c FROM vec_chunks`).get() as { c: number }).c;
  const embeddings = (db.prepare(`SELECT COUNT(*) as c FROM ${embTable}`).get() as { c: number }).c;

  return { documentCount: docs, chunkCount: chunks, embeddingCount: embeddings, usesNativeVec };
}

/**
 * Close an index's database.
 */
export function closeIndex(index: SqliteVecIndex): void {
  index.db.close();
}

// =============================================================================
// HELPERS
// =============================================================================

function float32ArrayToBuffer(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i], i * 4);
  }
  return buf;
}

function bufferToFloat32Array(buf: Buffer): number[] {
  const arr: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    arr.push(buf.readFloatLE(i));
  }
  return arr;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function distanceToScore(distance: number, metric: DistanceMetric): number {
  switch (metric) {
    case "cosine":
      // sqlite-vec cosine distance is 1 - cosine_similarity, range [0, 2]
      return Math.max(0, 1 - distance);
    case "dot_product":
    case "dot":
      // Higher dot product = more similar; negate distance
      return -distance;
    case "euclidean":
    case "manhattan":
      // Lower distance = more similar
      return 1 / (1 + distance);
    default:
      return Math.max(0, 1 - distance);
  }
}

function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return false;
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
