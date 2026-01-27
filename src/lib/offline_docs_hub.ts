/**
 * Offline Documentation Hub
 * Searchable, cached documentation for offline use
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";

// =============================================================================
// TYPES
// =============================================================================

export type DocId = string & { __brand: "DocId" };
export type CollectionId = string & { __brand: "CollectionId" };

export type DocSource = "local" | "url" | "github" | "npm" | "bundled";
export type DocFormat = "markdown" | "html" | "json" | "text" | "rst";
export type DocCategory = 
  | "language" 
  | "framework" 
  | "library" 
  | "api" 
  | "tool" 
  | "tutorial"
  | "reference"
  | "guide"
  | "custom";

export interface DocCollection {
  id: CollectionId;
  name: string;
  description?: string;
  category: DocCategory;
  source: DocSource;
  sourceUrl?: string;
  version?: string;
  icon?: string;
  documentCount: number;
  totalSize: number;
  lastUpdated: number;
  createdAt: number;
  tags: string[];
  metadata: Record<string, any>;
}

export interface Document {
  id: DocId;
  collectionId: CollectionId;
  title: string;
  path: string;
  content: string;
  format: DocFormat;
  language?: string;
  size: number;
  hash: string;
  headings: DocHeading[];
  codeBlocks: DocCodeBlock[];
  links: DocLink[];
  createdAt: number;
  updatedAt: number;
}

export interface DocHeading {
  level: number;
  text: string;
  anchor: string;
  line: number;
}

export interface DocCodeBlock {
  language: string;
  code: string;
  line: number;
}

export interface DocLink {
  text: string;
  href: string;
  isExternal: boolean;
  line: number;
}

export interface SearchResult {
  docId: DocId;
  collectionId: CollectionId;
  collectionName: string;
  title: string;
  path: string;
  snippet: string;
  relevance: number;
  matchType: "title" | "content" | "heading" | "code";
  matchedTerms: string[];
}

export interface DocStats {
  totalCollections: number;
  totalDocuments: number;
  totalSize: number;
  byCategory: Record<DocCategory, number>;
  lastIndexed?: number;
}

export interface ImportProgress {
  collectionId: CollectionId;
  total: number;
  current: number;
  currentFile?: string;
  status: "preparing" | "downloading" | "indexing" | "complete" | "error";
  error?: string;
}

export type DocsEventType =
  | "collection:created"
  | "collection:updated"
  | "collection:deleted"
  | "document:added"
  | "document:updated"
  | "document:deleted"
  | "import:progress"
  | "import:complete"
  | "import:error"
  | "index:rebuild"
  | "error";

export interface DocsEvent {
  type: DocsEventType;
  collectionId?: CollectionId;
  docId?: DocId;
  data?: any;
}

// =============================================================================
// BUNDLED DOCUMENTATION SOURCES
// =============================================================================

export const BUNDLED_DOCS: Array<{
  id: string;
  name: string;
  category: DocCategory;
  description: string;
  source: DocSource;
  sourceUrl?: string;
  icon: string;
}> = [
  {
    id: "typescript",
    name: "TypeScript",
    category: "language",
    description: "TypeScript language documentation",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/typescriptlang-org/docs",
    icon: "📘",
  },
  {
    id: "react",
    name: "React",
    category: "framework",
    description: "React documentation for building UIs",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/reactjs/react.dev/main/src/content",
    icon: "⚛️",
  },
  {
    id: "nodejs",
    name: "Node.js",
    category: "framework",
    description: "Node.js runtime documentation",
    source: "url",
    sourceUrl: "https://nodejs.org/api",
    icon: "💚",
  },
  {
    id: "electron",
    name: "Electron",
    category: "framework",
    description: "Electron desktop app framework docs",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/electron/electron/main/docs",
    icon: "🔌",
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    category: "library",
    description: "Utility-first CSS framework",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/tailwindlabs/tailwindcss.com/master/src/pages/docs",
    icon: "🎨",
  },
  {
    id: "prisma",
    name: "Prisma",
    category: "library",
    description: "Next-generation ORM for Node.js",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/prisma/docs/main/content",
    icon: "🔷",
  },
  {
    id: "drizzle",
    name: "Drizzle ORM",
    category: "library",
    description: "TypeScript ORM with SQL-like syntax",
    source: "url",
    sourceUrl: "https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/docs",
    icon: "💧",
  },
];

// =============================================================================
// OFFLINE DOCS HUB
// =============================================================================

export class OfflineDocsHub extends EventEmitter {
  private db: Database.Database | null = null;
  private storageDir: string;
  private importProgress = new Map<CollectionId, ImportProgress>();

  constructor(storageDir?: string) {
    super();
    this.storageDir = storageDir || path.join(app.getPath("userData"), "offline-docs");
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.mkdir(path.join(this.storageDir, "content"), { recursive: true });

    const dbPath = path.join(this.storageDir, "docs.db");
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma("journal_mode = WAL");

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        source_url TEXT,
        version TEXT,
        icon TEXT,
        document_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        last_updated INTEGER,
        created_at INTEGER NOT NULL,
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        format TEXT NOT NULL,
        language TEXT,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        headings TEXT DEFAULT '[]',
        code_blocks TEXT DEFAULT '[]',
        links TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);
      CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title);
      CREATE INDEX IF NOT EXISTS idx_collections_category ON collections(category);

      -- FTS5 for full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title,
        content,
        headings,
        code_content,
        content='documents',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, content, headings, code_content)
        VALUES (new.rowid, new.title, new.content, new.headings, 
          (SELECT group_concat(json_extract(value, '$.code'), ' ') FROM json_each(new.code_blocks)));
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, content, headings, code_content)
        VALUES ('delete', old.rowid, old.title, old.content, old.headings,
          (SELECT group_concat(json_extract(value, '$.code'), ' ') FROM json_each(old.code_blocks)));
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, content, headings, code_content)
        VALUES ('delete', old.rowid, old.title, old.content, old.headings,
          (SELECT group_concat(json_extract(value, '$.code'), ' ') FROM json_each(old.code_blocks)));
        INSERT INTO documents_fts(rowid, title, content, headings, code_content)
        VALUES (new.rowid, new.title, new.content, new.headings,
          (SELECT group_concat(json_extract(value, '$.code'), ' ') FROM json_each(new.code_blocks)));
      END;
    `);
  }

  async shutdown(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  // ---------------------------------------------------------------------------
  // COLLECTION MANAGEMENT
  // ---------------------------------------------------------------------------

  async createCollection(params: {
    name: string;
    description?: string;
    category: DocCategory;
    source: DocSource;
    sourceUrl?: string;
    version?: string;
    icon?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): Promise<DocCollection> {
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID() as CollectionId;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO collections (id, name, description, category, source, source_url, version, icon, created_at, last_updated, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.name,
      params.description || null,
      params.category,
      params.source,
      params.sourceUrl || null,
      params.version || null,
      params.icon || null,
      now,
      now,
      JSON.stringify(params.tags || []),
      JSON.stringify(params.metadata || {})
    );

    const collection = this.getCollection(id);
    this.emitEvent("collection:created", id);
    return collection!;
  }

  getCollection(id: CollectionId): DocCollection | null {
    if (!this.db) return null;

    const row = this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as any;
    return row ? this.rowToCollection(row) : null;
  }

  listCollections(filters?: {
    category?: DocCategory;
    source?: DocSource;
    search?: string;
  }): DocCollection[] {
    if (!this.db) return [];

    let sql = "SELECT * FROM collections WHERE 1=1";
    const params: any[] = [];

    if (filters?.category) {
      sql += " AND category = ?";
      params.push(filters.category);
    }
    if (filters?.source) {
      sql += " AND source = ?";
      params.push(filters.source);
    }
    if (filters?.search) {
      sql += " AND (name LIKE ? OR description LIKE ?)";
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    sql += " ORDER BY name ASC";

    return this.db.prepare(sql).all(...params).map((row: any) => this.rowToCollection(row));
  }

  async updateCollection(
    id: CollectionId,
    updates: Partial<{
      name: string;
      description: string;
      version: string;
      icon: string;
      tags: string[];
      metadata: Record<string, any>;
    }>
  ): Promise<DocCollection | null> {
    if (!this.db) return null;

    const sets: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      sets.push("name = ?");
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.version !== undefined) {
      sets.push("version = ?");
      params.push(updates.version);
    }
    if (updates.icon !== undefined) {
      sets.push("icon = ?");
      params.push(updates.icon);
    }
    if (updates.tags !== undefined) {
      sets.push("tags = ?");
      params.push(JSON.stringify(updates.tags));
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(updates.metadata));
    }

    if (sets.length === 0) return this.getCollection(id);

    sets.push("last_updated = ?");
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    this.emitEvent("collection:updated", id);

    return this.getCollection(id);
  }

  async deleteCollection(id: CollectionId): Promise<boolean> {
    if (!this.db) return false;

    // Delete content files
    const contentDir = path.join(this.storageDir, "content", id);
    try {
      await fs.rm(contentDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    const result = this.db.prepare("DELETE FROM collections WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.emitEvent("collection:deleted", id);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // DOCUMENT MANAGEMENT
  // ---------------------------------------------------------------------------

  async addDocument(params: {
    collectionId: CollectionId;
    title: string;
    path: string;
    content: string;
    format: DocFormat;
    language?: string;
  }): Promise<Document> {
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID() as DocId;
    const now = Date.now();
    const hash = this.hashContent(params.content);
    const size = Buffer.byteLength(params.content, "utf8");

    // Extract metadata
    const headings = this.extractHeadings(params.content, params.format);
    const codeBlocks = this.extractCodeBlocks(params.content, params.format);
    const links = this.extractLinks(params.content, params.format);

    const stmt = this.db.prepare(`
      INSERT INTO documents (id, collection_id, title, path, content, format, language, size, hash, headings, code_blocks, links, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.collectionId,
      params.title,
      params.path,
      params.content,
      params.format,
      params.language || null,
      size,
      hash,
      JSON.stringify(headings),
      JSON.stringify(codeBlocks),
      JSON.stringify(links),
      now,
      now
    );

    // Update collection stats
    this.updateCollectionStats(params.collectionId);

    const doc = this.getDocument(id);
    this.emitEvent("document:added", params.collectionId, id);
    return doc!;
  }

  getDocument(id: DocId): Document | null {
    if (!this.db) return null;

    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as any;
    return row ? this.rowToDocument(row) : null;
  }

  listDocuments(
    collectionId: CollectionId,
    options?: { limit?: number; offset?: number }
  ): Document[] {
    if (!this.db) return [];

    let sql = "SELECT * FROM documents WHERE collection_id = ? ORDER BY path ASC";
    const params: any[] = [collectionId];

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    return this.db.prepare(sql).all(...params).map((row: any) => this.rowToDocument(row));
  }

  async deleteDocument(id: DocId): Promise<boolean> {
    if (!this.db) return false;

    const doc = this.getDocument(id);
    if (!doc) return false;

    this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    this.updateCollectionStats(doc.collectionId);
    this.emitEvent("document:deleted", doc.collectionId, id);

    return true;
  }

  // ---------------------------------------------------------------------------
  // SEARCH
  // ---------------------------------------------------------------------------

  search(query: string, options?: {
    collectionId?: CollectionId;
    category?: DocCategory;
    limit?: number;
  }): SearchResult[] {
    if (!this.db) return [];

    const limit = options?.limit || 50;
    
    // Use FTS5 for search
    let sql = `
      SELECT 
        d.id,
        d.collection_id,
        c.name as collection_name,
        d.title,
        d.path,
        snippet(documents_fts, 1, '<mark>', '</mark>', '...', 32) as snippet,
        bm25(documents_fts) as relevance
      FROM documents_fts
      JOIN documents d ON d.rowid = documents_fts.rowid
      JOIN collections c ON c.id = d.collection_id
      WHERE documents_fts MATCH ?
    `;

    const params: any[] = [this.formatFtsQuery(query)];

    if (options?.collectionId) {
      sql += " AND d.collection_id = ?";
      params.push(options.collectionId);
    }
    if (options?.category) {
      sql += " AND c.category = ?";
      params.push(options.category);
    }

    sql += " ORDER BY relevance LIMIT ?";
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map((row) => ({
        docId: row.id as DocId,
        collectionId: row.collection_id as CollectionId,
        collectionName: row.collection_name,
        title: row.title,
        path: row.path,
        snippet: row.snippet || "",
        relevance: Math.abs(row.relevance),
        matchType: this.determineMatchType(row, query),
        matchedTerms: query.split(/\s+/).filter(Boolean),
      }));
    } catch {
      // FTS query failed, fallback to simple LIKE search
      return this.searchFallback(query, options);
    }
  }

  private searchFallback(query: string, options?: {
    collectionId?: CollectionId;
    category?: DocCategory;
    limit?: number;
  }): SearchResult[] {
    if (!this.db) return [];

    const limit = options?.limit || 50;
    const searchTerm = `%${query}%`;

    let sql = `
      SELECT 
        d.id,
        d.collection_id,
        c.name as collection_name,
        d.title,
        d.path,
        substr(d.content, 1, 200) as snippet
      FROM documents d
      JOIN collections c ON c.id = d.collection_id
      WHERE (d.title LIKE ? OR d.content LIKE ?)
    `;

    const params: any[] = [searchTerm, searchTerm];

    if (options?.collectionId) {
      sql += " AND d.collection_id = ?";
      params.push(options.collectionId);
    }
    if (options?.category) {
      sql += " AND c.category = ?";
      params.push(options.category);
    }

    sql += " ORDER BY d.title ASC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row, index) => ({
      docId: row.id as DocId,
      collectionId: row.collection_id as CollectionId,
      collectionName: row.collection_name,
      title: row.title,
      path: row.path,
      snippet: row.snippet + "...",
      relevance: 1 - index * 0.01,
      matchType: "content" as const,
      matchedTerms: [query],
    }));
  }

  // ---------------------------------------------------------------------------
  // IMPORT
  // ---------------------------------------------------------------------------

  async importFromLocalFolder(
    collectionId: CollectionId,
    folderPath: string,
    options?: { extensions?: string[]; recursive?: boolean }
  ): Promise<number> {
    const extensions = options?.extensions || [".md", ".mdx", ".txt", ".html", ".rst"];
    const recursive = options?.recursive ?? true;

    this.updateProgress(collectionId, { status: "preparing", total: 0, current: 0 });

    const files = await this.scanFolder(folderPath, extensions, recursive);
    const total = files.length;

    this.updateProgress(collectionId, { status: "indexing", total, current: 0 });

    let imported = 0;
    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const relativePath = path.relative(folderPath, file);
        const title = this.extractTitle(content, path.basename(file));
        const format = this.detectFormat(file);

        await this.addDocument({
          collectionId,
          title,
          path: relativePath,
          content,
          format,
        });

        imported++;
        this.updateProgress(collectionId, {
          status: "indexing",
          total,
          current: imported,
          currentFile: relativePath,
        });
      } catch (error) {
        console.error(`Failed to import ${file}:`, error);
      }
    }

    this.updateProgress(collectionId, { status: "complete", total, current: imported });
    this.emitEvent("import:complete", collectionId, undefined, { imported, total });

    return imported;
  }

  async importFromUrl(
    collectionId: CollectionId,
    url: string
  ): Promise<number> {
    this.updateProgress(collectionId, { status: "downloading", total: 1, current: 0 });

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const content = await response.text();
      const title = this.extractTitle(content, path.basename(url));
      const format = this.detectFormat(url);

      await this.addDocument({
        collectionId,
        title,
        path: url,
        content,
        format,
      });

      this.updateProgress(collectionId, { status: "complete", total: 1, current: 1 });
      this.emitEvent("import:complete", collectionId, undefined, { imported: 1, total: 1 });

      return 1;
    } catch (error) {
      this.updateProgress(collectionId, {
        status: "error",
        total: 1,
        current: 0,
        error: String(error),
      });
      this.emitEvent("import:error", collectionId, undefined, { error: String(error) });
      throw error;
    }
  }

  getImportProgress(collectionId: CollectionId): ImportProgress | null {
    return this.importProgress.get(collectionId) || null;
  }

  // ---------------------------------------------------------------------------
  // STATISTICS
  // ---------------------------------------------------------------------------

  getStats(): DocStats {
    if (!this.db) {
      return {
        totalCollections: 0,
        totalDocuments: 0,
        totalSize: 0,
        byCategory: {} as Record<DocCategory, number>,
      };
    }

    const collectionCount = this.db.prepare("SELECT COUNT(*) as count FROM collections").get() as any;
    const docStats = this.db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM documents").get() as any;
    
    const categoryRows = this.db.prepare(`
      SELECT category, COUNT(*) as count FROM collections GROUP BY category
    `).all() as any[];

    const byCategory: Record<DocCategory, number> = {
      language: 0,
      framework: 0,
      library: 0,
      api: 0,
      tool: 0,
      tutorial: 0,
      reference: 0,
      guide: 0,
      custom: 0,
    };

    for (const row of categoryRows) {
      byCategory[row.category as DocCategory] = row.count;
    }

    return {
      totalCollections: collectionCount.count,
      totalDocuments: docStats.count,
      totalSize: docStats.size,
      byCategory,
    };
  }

  getBundledDocs() {
    return BUNDLED_DOCS;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  private rowToCollection(row: any): DocCollection {
    return {
      id: row.id as CollectionId,
      name: row.name,
      description: row.description,
      category: row.category as DocCategory,
      source: row.source as DocSource,
      sourceUrl: row.source_url,
      version: row.version,
      icon: row.icon,
      documentCount: row.document_count,
      totalSize: row.total_size,
      lastUpdated: row.last_updated,
      createdAt: row.created_at,
      tags: JSON.parse(row.tags || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private rowToDocument(row: any): Document {
    return {
      id: row.id as DocId,
      collectionId: row.collection_id as CollectionId,
      title: row.title,
      path: row.path,
      content: row.content,
      format: row.format as DocFormat,
      language: row.language,
      size: row.size,
      hash: row.hash,
      headings: JSON.parse(row.headings || "[]"),
      codeBlocks: JSON.parse(row.code_blocks || "[]"),
      links: JSON.parse(row.links || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private updateCollectionStats(collectionId: CollectionId): void {
    if (!this.db) return;

    const stats = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size 
      FROM documents WHERE collection_id = ?
    `).get(collectionId) as any;

    this.db.prepare(`
      UPDATE collections 
      SET document_count = ?, total_size = ?, last_updated = ? 
      WHERE id = ?
    `).run(stats.count, stats.size, Date.now(), collectionId);
  }

  private hashContent(content: string): string {
    const crypto = require("node:crypto");
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private extractHeadings(content: string, format: DocFormat): DocHeading[] {
    if (format !== "markdown" && format !== "html") return [];

    const headings: DocHeading[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mdMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (mdMatch) {
        const level = mdMatch[1].length;
        const text = mdMatch[2].replace(/[#*`]/g, "").trim();
        const anchor = text.toLowerCase().replace(/[^\w]+/g, "-");
        headings.push({ level, text, anchor, line: i + 1 });
      }
    }

    return headings;
  }

  private extractCodeBlocks(content: string, format: DocFormat): DocCodeBlock[] {
    if (format !== "markdown") return [];

    const codeBlocks: DocCodeBlock[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const language = match[1] || "text";
      const code = match[2].trim();
      const line = content.substring(0, match.index).split("\n").length;
      codeBlocks.push({ language, code, line });
    }

    return codeBlocks;
  }

  private extractLinks(content: string, format: DocFormat): DocLink[] {
    if (format !== "markdown" && format !== "html") return [];

    const links: DocLink[] = [];
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const text = match[1];
      const href = match[2];
      const isExternal = href.startsWith("http://") || href.startsWith("https://");
      const line = content.substring(0, match.index).split("\n").length;
      links.push({ text, href, isExternal, line });
    }

    return links;
  }

  private extractTitle(content: string, filename: string): string {
    // Try to extract title from first heading
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // Try to extract from HTML title
    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].trim();

    // Use filename without extension
    return filename.replace(/\.[^.]+$/, "");
  }

  private detectFormat(filepath: string): DocFormat {
    const ext = path.extname(filepath).toLowerCase();
    switch (ext) {
      case ".md":
      case ".mdx":
        return "markdown";
      case ".html":
      case ".htm":
        return "html";
      case ".json":
        return "json";
      case ".rst":
        return "rst";
      default:
        return "text";
    }
  }

  private async scanFolder(
    folderPath: string,
    extensions: string[],
    recursive: boolean
  ): Promise<string[]> {
    const files: string[] = [];
    
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory() && recursive) {
        const subFiles = await this.scanFolder(fullPath, extensions, recursive);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
    
    return files;
  }

  private formatFtsQuery(query: string): string {
    // Format query for FTS5
    const terms = query.trim().split(/\s+/).filter(Boolean);
    return terms.map((t) => `"${t}"*`).join(" OR ");
  }

  private determineMatchType(row: any, query: string): "title" | "content" | "heading" | "code" {
    const lowerQuery = query.toLowerCase();
    if (row.title?.toLowerCase().includes(lowerQuery)) return "title";
    if (row.headings?.toLowerCase().includes(lowerQuery)) return "heading";
    return "content";
  }

  private updateProgress(collectionId: CollectionId, partial: Partial<ImportProgress>): void {
    const existing = this.importProgress.get(collectionId) || {
      collectionId,
      total: 0,
      current: 0,
      status: "preparing" as const,
    };

    const updated = { ...existing, ...partial };
    this.importProgress.set(collectionId, updated);
    this.emitEvent("import:progress", collectionId, undefined, updated);
  }

  private emitEvent(type: DocsEventType, collectionId?: CollectionId, docId?: DocId, data?: any): void {
    const event: DocsEvent = { type, collectionId, docId, data };
    this.emit("docs:event", event);
  }

  subscribe(callback: (event: DocsEvent) => void): () => void {
    this.on("docs:event", callback);
    return () => this.off("docs:event", callback);
  }
}

// Global instance
let offlineDocsHub: OfflineDocsHub | null = null;

export function getOfflineDocsHub(): OfflineDocsHub {
  if (!offlineDocsHub) {
    offlineDocsHub = new OfflineDocsHub();
  }
  return offlineDocsHub;
}
