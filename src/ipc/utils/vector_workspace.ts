import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { markdownIndexableText } from "./markdown_document";
import type {
  VectorActivity,
  VectorCollection,
  VectorOverview,
  VectorSearchResult,
  VectorSettings,
  VectorSource,
} from "../types/vector";
import {
  getVectorServiceStatus,
  setVectorIndexing,
  startVectorService,
  vectorBackupsPath,
  vectorMetadataPath,
  vectorRequest,
  vectorStoragePath,
} from "./vector_service_manager";

const EMBEDDING_DIMENSIONS = 384;

/**
 * The embedder in use, resolved once and reused.
 *
 * Detection performs a real embedding, so it is not free; caching it keeps the
 * cost to the first index or search after launch.
 */
let activeEmbedder: ResolvedEmbedder | null = null;

// Metadata is a single JSON document. Two index jobs previously read the same
// snapshot, worked in parallel, then each wrote its own copy back. Whichever
// finished last silently restored the other source to `indexing`. Keep every
// metadata-mutating index run in one process-wide queue.
let indexingQueue: Promise<void> = Promise.resolve();
let recoveredInterruptedSources = false;

function embeddingConfig(): EmbeddingConfig {
  // Stored with the workspace, alongside the other Vector settings.
  const configured = readMetadata().settings.embedding ?? {};
  return {
    ...DEFAULT_EMBEDDING_CONFIG,
    ...Object.fromEntries(
      Object.entries(configured).filter(([, value]) => value !== undefined),
    ),
  } as EmbeddingConfig;
}

/** The embedder to use, detecting it the first time it is needed. */
export async function getActiveEmbedder(): Promise<ResolvedEmbedder> {
  if (activeEmbedder) return activeEmbedder;
  activeEmbedder = await detectEmbedder(embeddingConfig());
  return activeEmbedder;
}

/** Forgets the cached embedder, so a settings change takes effect. */
export function resetActiveEmbedder(): void {
  activeEmbedder = null;
}

/**
 * Embeds text with the active provider, falling back to the lexical hash only
 * when the user allows it. Never returns a vector of the wrong width.
 */
export async function embedForCollection(
  texts: string[],
): Promise<{ vectors: number[][]; embedder: ResolvedEmbedder }> {
  const embedder = await getActiveEmbedder();
  const config = embeddingConfig();
  try {
    return { vectors: await embedTexts(texts, embedder, config), embedder };
  } catch (error) {
    if (!config.enableFallback) throw error;
    logger.warn(
      "Embedding failed; using lexical vectors for this batch",
      error,
    );
    return {
      vectors: texts.map(lexicalEmbed),
      embedder: LEXICAL_EMBEDDER,
    };
  }
}
const EMBEDDING_MODEL = "Built-in Local · Balanced";
const MAX_FILES_PER_SOURCE = 5_000;
/**
 * Chunks were 1,800 characters, which made every fact inside a long block
 * cite the same wide line range — accurate, but useless for finding the
 * sentence. Smaller chunks give citations that point somewhere specific, at
 * the cost of more points in the index.
 */
const TARGET_CHUNK_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 140;

const logger = log.scope("vector_workspace");

import {
  DEFAULT_EMBEDDING_CONFIG,
  detectEmbedder,
  embedTexts,
  LEXICAL_EMBEDDER,
  lexicalEmbed,
  type EmbeddingConfig,
  type ResolvedEmbedder,
} from "./embedding_provider";
import {
  isDocumentSurveyQuery,
  scoreDocumentSurveyPassage,
} from "@/lib/vector_rag_context";

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".pdf",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".build",
  ".idea",
  ".turbo",
  ".venv",
  ".vscode",
  "Pods",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

const EXCLUDED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519",
]);

interface WorkspaceMetadata {
  version: 1;
  collections: VectorCollection[];
  sources: VectorSource[];
  settings: VectorSettings;
  activity: VectorActivity[];
  lastBackupAt: string | null;
}

interface Chunk {
  content: string;
  /** Which model produced this vector; mixing models breaks comparability. */
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingVersion?: string;
  lineStart: number;
  lineEnd: number;
  /** Page the chunk starts on, when the document carried page markers. */
  page?: number;
}

interface PointPayload {
  collectionId: string;
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  content: string;
  /** Which model produced this vector; mixing models breaks comparability. */
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingVersion?: string;
  lineStart: number;
  lineEnd: number;
  page?: number;
  language: string | null;
  modifiedAt: string;
}

const DEFAULT_SETTINGS: VectorSettings = {
  // On by default: the point of a knowledge base is that the model you use
  // can read it, and most people's chat model is cloud-hosted. The toggle
  // stays available for anyone who wants retrieval to remain on-device only.
  allowCloudRag: true,
  includeHiddenFiles: false,
  // Chunks shrank from 1,800 to 700 characters for precise citations, which
  // would otherwise have cut the context a model sees by more than half.
  // Retrieve more of them so there is enough material to discuss a document,
  // not just quote it.
  defaultResultCount: 20,
  minimumScore: 0.12,
};

function emptyMetadata(): WorkspaceMetadata {
  return {
    version: 1,
    collections: [],
    sources: [],
    settings: DEFAULT_SETTINGS,
    activity: [],
    lastBackupAt: null,
  };
}

function ensureParent(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function readMetadata(): WorkspaceMetadata {
  const filePath = vectorMetadataPath();
  if (!fs.existsSync(filePath)) {
    recoveredInterruptedSources = true;
    return emptyMetadata();
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<WorkspaceMetadata>;
    const metadata = {
      ...emptyMetadata(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      collections: parsed.collections ?? [],
      sources: parsed.sources ?? [],
      activity: parsed.activity ?? [],
    };

    // `indexing` is an in-process state. If it survived an app restart or a
    // hot reload, the job was interrupted and cannot complete by itself.
    // Convert it to an actionable state once per launch instead of making the
    // UI poll forever at 0%.
    if (!recoveredInterruptedSources) {
      recoveredInterruptedSources = true;
      const interrupted = metadata.sources.filter(
        (source) => source.status === "indexing",
      );
      if (interrupted.length > 0) {
        const affectedCollections = new Set(
          interrupted.map((source) => source.collectionId),
        );
        for (const source of interrupted) {
          source.status = "attention";
          source.error =
            "Indexing was interrupted. Choose Fix to resume this document.";
        }
        for (const collection of metadata.collections) {
          if (affectedCollections.has(collection.id)) {
            collection.health = "attention";
          }
        }
        recordActivity(
          metadata,
          `Recovered ${interrupted.length} interrupted indexing job${interrupted.length === 1 ? "" : "s"}`,
          "warning",
        );
        writeMetadata(metadata);
        logger.warn(
          `Recovered ${interrupted.length} source(s) left in indexing state`,
        );
      }
    }

    return metadata;
  } catch {
    throw new DyadError(
      "Vector workspace metadata could not be read.",
      DyadErrorKind.Internal,
    );
  }
}

function writeMetadata(metadata: WorkspaceMetadata): void {
  const filePath = vectorMetadataPath();
  ensureParent(filePath);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // POSIX permissions are best-effort on non-POSIX filesystems.
  }
}

function recordActivity(
  metadata: WorkspaceMetadata,
  message: string,
  tone: VectorActivity["tone"] = "info",
): void {
  metadata.activity.unshift({
    id: crypto.randomUUID(),
    message,
    tone,
    at: new Date().toISOString(),
  });
  metadata.activity = metadata.activity.slice(0, 30);
}

function qdrantCollectionName(collectionId: string): string {
  return `mh_${collectionId.replace(/-/g, "_")}`;
}

function languageForFile(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase().slice(1);
  return extension || null;
}

function isSensitiveOrUnsupported(filePath: string): boolean {
  const name = path.basename(filePath);
  const lower = name.toLowerCase();
  return (
    EXCLUDED_FILE_NAMES.has(name) ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    !TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  );
}

export function embedLocalText(text: string): number[] {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const features = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push(`${tokens[index]}_${tokens[index + 1]}`);
  }
  for (const feature of features) {
    const digest = crypto.createHash("sha256").update(feature).digest();
    const slot = digest.readUInt32LE(0) % EMBEDDING_DIMENSIONS;
    const sign = (digest[4] & 1) === 0 ? 1 : -1;
    vector[slot] += sign;
  }
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return Array.from(vector);
  return Array.from(vector, (value) => value / magnitude);
}

/** Marker the OCR step emits at the top of each page. */
const PAGE_MARKER = /^\s*\[\[page\s+(\d+)\]\]\s*$/i;

export function chunkText(text: string): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // Which page each line belongs to, so a chunk can name one. Markers stay in
  // the line array to keep line numbers honest against the extracted text.
  const pageForLine: (number | undefined)[] = [];
  let currentPage: number | undefined;
  for (const line of lines) {
    const marker = PAGE_MARKER.exec(line);
    if (marker) currentPage = Number(marker[1]);
    pageForLine.push(currentPage);
  }
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let length = 0;
    while (end < lines.length && length < TARGET_CHUNK_CHARS) {
      length += lines[end].length + 1;
      end += 1;
    }
    // Markers are scaffolding for locating text, not text to search.
    const content = lines
      .slice(start, end)
      .filter((line) => !PAGE_MARKER.test(line))
      .join("\n")
      .trim();
    if (content) {
      chunks.push({
        content,
        lineStart: start + 1,
        lineEnd: end,
        page: pageForLine[start],
      });
    }
    if (end >= lines.length) break;
    let overlap = 0;
    let nextStart = end;
    while (nextStart > start + 1 && overlap < CHUNK_OVERLAP_CHARS) {
      nextStart -= 1;
      overlap += lines[nextStart].length + 1;
    }
    start = nextStart;
  }
  return chunks;
}

function listSourceFiles(
  sourcePath: string,
  includeHiddenFiles: boolean,
): string[] {
  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    return isSensitiveOrUnsupported(sourcePath) ? [] : [sourcePath];
  }
  const files: string[] = [];
  const visit = (directory: string) => {
    if (files.length >= MAX_FILES_PER_SOURCE) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= MAX_FILES_PER_SOURCE) break;
      if (!includeHiddenFiles && entry.name.startsWith(".")) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) visit(entryPath);
      } else if (entry.isFile() && !isSensitiveOrUnsupported(entryPath)) {
        files.push(entryPath);
      }
    }
  };
  visit(sourcePath);
  return files;
}

async function deleteSourcePoints(
  collectionId: string,
  sourceId: string,
): Promise<void> {
  await vectorRequest(
    `/collections/${qdrantCollectionName(collectionId)}/points/delete?wait=true`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          must: [{ key: "sourceId", match: { value: sourceId } }],
        },
      }),
    },
  );
}

/**
 * Text of a PDF, extracted once and cached by path and modification time.
 *
 * Without the cache every re-index would re-run a paid model call over the
 * same unchanged file.
 */
async function readPdfText(filePath: string, mtimeMs: number): Promise<string> {
  // Knowledge Base repairs are deliberate background operations. Give large
  // PDFs substantially longer than the interactive chat attachment path,
  // which must fail quickly enough to avoid trapping the composer UI.
  const knowledgeBaseOcrTimeoutMs = 10 * 60_000;
  const cacheDir = path.join(path.dirname(vectorMetadataPath()), "pdf-text");
  const key = crypto
    .createHash("sha1")
    .update(`${filePath}:${Math.round(mtimeMs)}`)
    .digest("hex");
  const cachePath = path.join(cacheDir, `${key}.txt`);

  try {
    return await fs.promises.readFile(cachePath, "utf8");
  } catch {
    // Not cached yet.
  }

  const { extractDocumentText } = await import("../handlers/ocr_handlers");
  const { text } = await extractDocumentText(
    {
      fileName: path.basename(filePath),
      mimeType: "application/pdf",
      dataBase64: (await fs.promises.readFile(filePath)).toString("base64"),
    },
    { timeoutMs: knowledgeBaseOcrTimeoutMs },
  );

  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.writeFile(cachePath, text, "utf8");
  } catch {
    // A cache that cannot be written is not a reason to fail the index.
  }
  return text;
}

async function indexSingleSource(
  collection: VectorCollection,
  source: VectorSource,
  settings: VectorSettings,
): Promise<VectorSource> {
  const files = listSourceFiles(source.path, settings.includeHiddenFiles);
  // The most common silent failure is a source whose files were all filtered
  // out by type or size, which looks identical to a successful empty index.
  logger.info(
    `Indexing "${source.name}": ${files.length} indexable file(s) from ${source.path}`,
  );
  await deleteSourcePoints(collection.id, source.id);
  let chunkCount = 0;
  const batch: Array<{
    id: string;
    vector: number[];
    payload: PointPayload;
  }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await vectorRequest(
      `/collections/${qdrantCollectionName(collection.id)}/points?wait=true`,
      {
        method: "PUT",
        body: JSON.stringify({ points: batch.splice(0, batch.length) }),
      },
    );
  };

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    // A PDF holds no readable text as utf8; its words come from the OCR-role
    // model. The result is cached beside the vector store so re-indexing an
    // unchanged file costs nothing.
    const raw = /\.pdf$/i.test(filePath)
      ? await readPdfText(filePath, stat.mtimeMs)
      : await fs.promises.readFile(filePath, "utf8");
    if (!raw.trim()) {
      logger.warn(`No text extracted from ${filePath}; skipping.`);
      continue;
    }
    // Markdown carries a YAML frontmatter block that is metadata, not prose.
    // Indexing it verbatim pollutes both the embeddings and the snippets
    // shown in results, so index the title, tags and body instead.
    const content = /\.mdx?$/i.test(filePath)
      ? markdownIndexableText(raw)
      : raw;
    const chunks = chunkText(content);
    // Embedded as a batch: one request for the file rather than one per chunk.
    const { vectors: chunkVectors, embedder: usedEmbedder } =
      await embedForCollection(chunks.map((chunk) => chunk.content));
    // A collection built with a different model cannot accept these vectors.
    if (
      collection.embeddingVersion &&
      collection.embeddingVersion !== usedEmbedder.version
    ) {
      throw new DyadError(
        `“${collection.name}” was built with a different embedding model. ` +
          `Rebuild it before indexing so its vectors stay comparable.`,
        DyadErrorKind.Validation,
      );
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const pointSeed = `${collection.id}:${source.id}:${filePath}:${index}:${chunk.content}`;
      const hash = crypto.createHash("sha256").update(pointSeed).digest("hex");
      const pointId = [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `a${hash.slice(17, 20)}`,
        hash.slice(20, 32),
      ].join("-");
      batch.push({
        id: pointId,
        vector: chunkVectors[index]!,
        payload: {
          collectionId: collection.id,
          sourceId: source.id,
          sourceName: source.name,
          sourcePath: filePath,
          content: chunk.content,
          embeddingProvider: usedEmbedder.provider,
          embeddingModel: usedEmbedder.model,
          embeddingDimensions: usedEmbedder.dimensions,
          embeddingVersion: usedEmbedder.version,
          lineStart: chunk.lineStart,
          page: chunk.page,
          lineEnd: chunk.lineEnd,
          language: languageForFile(filePath),
          modifiedAt: stat.mtime.toISOString(),
        },
      });
      chunkCount += 1;
      if (batch.length >= 64) await flush();
    }
  }
  await flush();
  return {
    ...source,
    status: "ready",
    chunkCount,
    fileCount: files.length,
    lastIndexedAt: new Date().toISOString(),
    error: null,
  };
}

function requireCollection(
  metadata: WorkspaceMetadata,
  collectionId: string,
): VectorCollection {
  const collection = metadata.collections.find(
    (candidate) => candidate.id === collectionId,
  );
  if (!collection) {
    throw new DyadError(
      "That Vector collection no longer exists.",
      DyadErrorKind.NotFound,
    );
  }
  return collection;
}

export async function getVectorOverview(): Promise<VectorOverview> {
  const metadata = readMetadata();
  let storageBytes = 0;
  // Qdrant reclaims segment directories in the background (moving them under
  // `.deleted/` before removing them), so paths can disappear mid-walk. The
  // size is a display-only figure — skip whatever vanishes rather than
  // failing the whole overview with ENOENT.
  const visit = (directory: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        try {
          storageBytes += fs.statSync(entryPath).size;
        } catch {
          // Removed between readdir and stat.
        }
      }
    }
  };
  visit(vectorStoragePath());
  return {
    status: getVectorServiceStatus(),
    collectionCount: metadata.collections.length,
    sourceCount: metadata.sources.length,
    chunkCount: metadata.collections.reduce(
      (total, collection) => total + collection.chunkCount,
      0,
    ),
    storageBytes,
    embeddingModel: EMBEDDING_MODEL,
    lastBackupAt: metadata.lastBackupAt,
    activity: metadata.activity,
    settings: metadata.settings,
  };
}

export function listVectorCollections(): VectorCollection[] {
  return readMetadata().collections;
}

export async function createVectorCollection(input: {
  name: string;
  description: string;
}): Promise<VectorCollection> {
  await startVectorService();
  // The collection is sized to whatever model is active, and remembers which
  // one — vectors from two models are not comparable.
  const creationEmbedder = await getActiveEmbedder();
  const metadata = readMetadata();
  if (
    metadata.collections.some(
      (collection) =>
        collection.name.localeCompare(input.name, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    throw new DyadError(
      "A collection with that name already exists.",
      DyadErrorKind.Conflict,
    );
  }
  const collection: VectorCollection = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    embeddingModel: creationEmbedder.model,
    dimensions: creationEmbedder.dimensions,
    embeddingVersion: creationEmbedder.version,
    documentCount: 0,
    chunkCount: 0,
    storageBytes: 0,
    health: "ready",
    createdAt: new Date().toISOString(),
    lastIndexedAt: null,
  };
  await vectorRequest(`/collections/${qdrantCollectionName(collection.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: { size: creationEmbedder.dimensions, distance: "Cosine" },
    }),
  });
  metadata.collections.push(collection);
  recordActivity(metadata, `Created “${collection.name}”`, "success");
  writeMetadata(metadata);
  return collection;
}

export function updateVectorCollection(input: {
  collectionId: string;
  name: string;
  description: string;
}): VectorCollection {
  const metadata = readMetadata();
  const collection = requireCollection(metadata, input.collectionId);
  collection.name = input.name;
  collection.description = input.description;
  recordActivity(metadata, `Updated “${collection.name}”`);
  writeMetadata(metadata);
  return collection;
}

export async function deleteVectorCollection(
  collectionId: string,
): Promise<void> {
  const metadata = readMetadata();
  const collection = requireCollection(metadata, collectionId);
  await vectorRequest(`/collections/${qdrantCollectionName(collection.id)}`, {
    method: "DELETE",
  });
  metadata.collections = metadata.collections.filter(
    (candidate) => candidate.id !== collectionId,
  );
  metadata.sources = metadata.sources.filter(
    (source) => source.collectionId !== collectionId,
  );
  recordActivity(metadata, `Deleted “${collection.name}”`, "warning");
  writeMetadata(metadata);
}

export function listVectorSources(collectionId: string): VectorSource[] {
  const metadata = readMetadata();
  requireCollection(metadata, collectionId);
  return metadata.sources.filter(
    (source) => source.collectionId === collectionId,
  );
}

async function runVectorPathIndex(
  collectionId: string,
  sourcePaths: string[],
  onProgress?: (progress: {
    completedCount: number;
    totalCount: number;
    currentFile?: string;
  }) => void,
): Promise<VectorSource[]> {
  await startVectorService();
  const metadata = readMetadata();
  const collection = requireCollection(metadata, collectionId);
  setVectorIndexing(true);
  collection.health = "indexing";
  writeMetadata(metadata);
  const indexed: VectorSource[] = [];
  const indexablePaths = sourcePaths.filter((sourcePath) => {
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) return false;
    const stat = fs.statSync(resolved);
    return stat.isFile() || stat.isDirectory();
  });
  let completedCount = 0;
  onProgress?.({ completedCount, totalCount: indexablePaths.length });
  try {
    for (const sourcePath of indexablePaths) {
      const resolved = path.resolve(sourcePath);
      const stat = fs.statSync(resolved);
      onProgress?.({
        completedCount,
        totalCount: indexablePaths.length,
        currentFile: path.basename(resolved),
      });
      let source = metadata.sources.find(
        (candidate) =>
          candidate.collectionId === collectionId &&
          candidate.path === resolved,
      );
      if (!source) {
        source = {
          id: crypto.randomUUID(),
          collectionId,
          name: path.basename(resolved),
          path: resolved,
          kind: stat.isDirectory() ? "folder" : "file",
          status: "indexing",
          chunkCount: 0,
          fileCount: 0,
          lastIndexedAt: null,
          error: null,
        };
        metadata.sources.push(source);
      } else {
        source.status = "indexing";
        source.error = null;
      }
      writeMetadata(metadata);
      try {
        const completed = await indexSingleSource(
          collection,
          source,
          metadata.settings,
        );
        Object.assign(source, completed);
        indexed.push(completed);
      } catch (error) {
        source.status = "attention";
        source.error =
          error instanceof Error ? error.message : "Indexing failed.";
        indexed.push({ ...source });
      }
      writeMetadata(metadata);
      completedCount += 1;
      onProgress?.({
        completedCount,
        totalCount: indexablePaths.length,
        currentFile: path.basename(resolved),
      });
    }
    const collectionSources = metadata.sources.filter(
      (source) => source.collectionId === collectionId,
    );
    collection.documentCount = collectionSources.reduce(
      (total, source) => total + source.fileCount,
      0,
    );
    collection.chunkCount = collectionSources.reduce(
      (total, source) => total + source.chunkCount,
      0,
    );
    collection.health = collectionSources.some(
      (source) => source.status === "attention",
    )
      ? "attention"
      : "ready";
    collection.lastIndexedAt = new Date().toISOString();
    recordActivity(
      metadata,
      `Indexed ${indexed.length} source${indexed.length === 1 ? "" : "s"} into “${collection.name}”`,
      collection.health === "ready" ? "success" : "warning",
    );
    writeMetadata(metadata);
    return indexed;
  } finally {
    setVectorIndexing(false);
  }
}

export function indexVectorPaths(
  collectionId: string,
  sourcePaths: string[],
  onProgress?: (progress: {
    completedCount: number;
    totalCount: number;
    currentFile?: string;
  }) => void,
): Promise<VectorSource[]> {
  const run = indexingQueue.then(() =>
    runVectorPathIndex(collectionId, sourcePaths, onProgress),
  );
  // A failed run must not poison the queue and prevent every future repair.
  indexingQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function removeVectorSource(
  collectionId: string,
  sourceId: string,
): Promise<void> {
  const metadata = readMetadata();
  const collection = requireCollection(metadata, collectionId);
  const source = metadata.sources.find(
    (candidate) =>
      candidate.id === sourceId && candidate.collectionId === collectionId,
  );
  if (!source) {
    throw new DyadError(
      "That knowledge source no longer exists.",
      DyadErrorKind.NotFound,
    );
  }
  await deleteSourcePoints(collectionId, sourceId);
  metadata.sources = metadata.sources.filter(
    (candidate) => candidate.id !== sourceId,
  );
  const remaining = metadata.sources.filter(
    (candidate) => candidate.collectionId === collectionId,
  );
  collection.documentCount = remaining.reduce(
    (total, candidate) => total + candidate.fileCount,
    0,
  );
  collection.chunkCount = remaining.reduce(
    (total, candidate) => total + candidate.chunkCount,
    0,
  );
  recordActivity(metadata, `Removed “${source.name}”`, "warning");
  writeMetadata(metadata);
}

interface QdrantQueryResponse {
  result: {
    points: Array<{
      id: string | number;
      score: number;
      payload: PointPayload;
    }>;
  };
}

interface QdrantScrollResponse {
  result: {
    points: Array<{
      id: string | number;
      payload: PointPayload;
    }>;
    next_page_offset?: string | number | null;
  };
}

async function scrollSourcePoints(
  collectionId: string,
  sourceId: string,
): Promise<QdrantScrollResponse["result"]["points"]> {
  const points: QdrantScrollResponse["result"]["points"] = [];
  let offset: string | number | undefined;
  do {
    const response = await vectorRequest<QdrantScrollResponse>(
      `/collections/${qdrantCollectionName(collectionId)}/points/scroll`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            must: [{ key: "sourceId", match: { value: sourceId } }],
          },
          limit: 512,
          ...(offset === undefined ? {} : { offset }),
          with_payload: true,
          with_vector: false,
        }),
      },
    );
    points.push(...response.result.points);
    const next = response.result.next_page_offset ?? undefined;
    if (next === offset) break;
    offset = next;
  } while (offset !== undefined);
  return points;
}

function vectorPointToSearchResult(
  collection: VectorCollection,
  collectionId: string,
  point: { id: string | number; score: number; payload: PointPayload },
): VectorSearchResult {
  return {
    id: String(point.id),
    collectionId,
    collectionName: collection.name,
    sourceId: point.payload.sourceId,
    sourceName: point.payload.sourceName,
    sourcePath: point.payload.sourcePath,
    content: point.payload.content,
    score: point.score,
    lineStart: point.payload.lineStart,
    page: point.payload.page,
    lineEnd: point.payload.lineEnd,
    language: point.payload.language,
    modifiedAt: point.payload.modifiedAt,
  };
}

function canonicalSourceName(sourceName: string): string {
  return sourceName.replace(/\.(?:md|pdf)$/i, "").toLowerCase();
}

function deduplicateSearchResults(
  results: VectorSearchResult[],
): VectorSearchResult[] {
  const byPassage = new Map<string, VectorSearchResult>();
  for (const result of results) {
    // OCR sidecars can leave identical .pdf and .md points in older indexes.
    // They must count as one passage or half the model context is duplicated.
    const canonicalSource = canonicalSourceName(result.sourceName);
    const key = `${canonicalSource}:${result.page ?? ""}:${result.content}`;
    const existing = byPassage.get(key);
    const resultIsPdf = /\.pdf$/i.test(result.sourceName);
    const existingIsPdf = existing
      ? /\.pdf$/i.test(existing.sourceName)
      : false;
    if (
      !existing ||
      (resultIsPdf && !existingIsPdf) ||
      (resultIsPdf === existingIsPdf && result.score > existing.score)
    ) {
      byPassage.set(key, result);
    }
  }
  return [...byPassage.values()];
}

async function documentSurveyResults(
  metadata: WorkspaceMetadata,
  anchors: VectorSearchResult[],
  query: string,
): Promise<VectorSearchResult[]> {
  const sources = new Map<string, VectorSearchResult>();
  for (const anchor of anchors) {
    const canonicalSource = canonicalSourceName(anchor.sourceName);
    // An OCR Markdown sidecar is an implementation detail. When the original
    // PDF is also indexed, survey and cite that source while preserving the
    // semantic score that selected the document.
    const originalPdf = metadata.sources.find(
      (source) =>
        source.collectionId === anchor.collectionId &&
        source.status === "ready" &&
        /\.pdf$/i.test(source.name) &&
        canonicalSourceName(source.name) === canonicalSource,
    );
    const resolvedAnchor = originalPdf
      ? {
          ...anchor,
          sourceId: originalPdf.id,
          sourceName: originalPdf.name,
          sourcePath: originalPdf.path,
        }
      : anchor;
    const existing = sources.get(canonicalSource);
    if (
      !existing ||
      (/\.pdf$/i.test(resolvedAnchor.sourceName) &&
        !/\.pdf$/i.test(existing.sourceName))
    ) {
      sources.set(canonicalSource, resolvedAnchor);
    }
  }

  const groups = await Promise.all(
    [...sources.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map(async (anchor) => {
        const collection = requireCollection(metadata, anchor.collectionId);
        const points = await scrollSourcePoints(
          anchor.collectionId,
          anchor.sourceId,
        );

        return points
          .map((point) => ({
            anchor,
            collection,
            point,
            surveyScore: scoreDocumentSurveyPassage(
              query,
              point.payload.content,
            ),
          }))
          .filter((candidate) => candidate.surveyScore > 0)
          .sort((left, right) => right.surveyScore - left.surveyScore)
          .slice(0, 12);
      }),
  );
  return (
    groups
      .flat()
      // Rank globally. Giving every source the same fixed boost allowed an
      // unrelated document with a generic "summary" heading to consume result
      // slots that belonged to the matched tender's pricing table.
      .sort(
        (left, right) =>
          right.surveyScore - left.surveyScore ||
          right.anchor.score - left.anchor.score,
      )
      .slice(0, 16)
      .map((candidate) =>
        vectorPointToSearchResult(
          candidate.collection,
          candidate.anchor.collectionId,
          {
            ...candidate.point,
            // The source was selected semantically; the structural score then
            // promotes explicit lists and priced tables within that source.
            score: Math.min(
              0.999,
              candidate.anchor.score +
                Math.min(candidate.surveyScore, 30) * 0.01,
            ),
          },
        ),
      )
  );
}

async function adjacentPageResults(
  metadata: WorkspaceMetadata,
  anchors: VectorSearchResult[],
): Promise<VectorSearchResult[]> {
  const bySource = new Map<string, VectorSearchResult[]>();
  for (const result of anchors) {
    if (result.page == null) continue;
    const key = `${result.collectionId}:${result.sourceId}`;
    const existing = bySource.get(key) ?? [];
    // Keep several section anchors. A document-wide question can legitimately
    // need its overview, comparison table and later analysis; retaining only
    // two anchors allowed one verbose clarification section to crowd out the
    // table immediately following the overview.
    if (existing.length < 4) existing.push(result);
    bySource.set(key, existing);
  }

  const sourceGroups = [...bySource.values()].slice(0, 4);
  const groups = await Promise.all(
    sourceGroups.map(async (sourceAnchors) => {
      const first = sourceAnchors[0]!;
      const collection = requireCollection(metadata, first.collectionId);
      const points = await scrollSourcePoints(
        first.collectionId,
        first.sourceId,
      );

      return points.flatMap((point) => {
        const page = point.payload.page;
        if (page == null) return [];
        const closest = sourceAnchors
          .map((anchor) => ({
            anchor,
            distance: Math.abs(page - anchor.page!),
          }))
          .sort((left, right) => left.distance - right.distance)[0]!;
        if (closest.distance > 2) return [];
        return [
          vectorPointToSearchResult(collection, first.collectionId, {
            ...point,
            // Nearby pages are supporting context, ranked just below their
            // semantic anchor. This is especially important for numeric
            // tables whose embeddings are naturally weak.
            score: Math.max(
              0,
              closest.anchor.score - closest.distance * 0.02 - 0.001,
            ),
          }),
        ];
      });
    }),
  );
  return groups.flat();
}

export async function searchVectorWorkspace(input: {
  query: string;
  collectionIds: string[];
  limit: number;
  minimumScore: number;
  includeAdjacentPages?: boolean;
  includeDocumentSurvey?: boolean;
}): Promise<VectorSearchResult[]> {
  const metadata = readMetadata();
  // The query must be embedded by the same model as the stored vectors.
  const { vectors: queryVectors } = await embedForCollection([input.query]);
  const vector = queryVectors[0]!;
  const perCollection = Math.max(
    input.includeAdjacentPages ? input.limit * 2 : input.limit,
    4,
  );
  const searches = input.collectionIds.map(async (collectionId) => {
    const collection = requireCollection(metadata, collectionId);
    const response = await vectorRequest<QdrantQueryResponse>(
      `/collections/${qdrantCollectionName(collectionId)}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          query: vector,
          limit: perCollection,
          score_threshold: input.minimumScore,
          with_payload: true,
        }),
      },
    );
    return response.result.points.map((point) =>
      vectorPointToSearchResult(collection, collectionId, point),
    );
  });
  const direct = deduplicateSearchResults(
    (await Promise.all(searches))
      .flat()
      .sort((left, right) => right.score - left.score),
  );
  const includeDocumentSurvey =
    input.includeDocumentSurvey ?? isDocumentSurveyQuery(input.query);
  const survey = includeDocumentSurvey
    ? await documentSurveyResults(metadata, direct, input.query)
    : [];
  const adjacent = input.includeAdjacentPages
    ? await adjacentPageResults(metadata, [...survey, ...direct])
    : [];
  return deduplicateSearchResults([...direct, ...survey, ...adjacent])
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
}

export function updateVectorSettings(settings: VectorSettings): VectorSettings {
  const metadata = readMetadata();
  metadata.settings = settings;
  recordActivity(metadata, "Updated Vector privacy and search settings");
  writeMetadata(metadata);
  return metadata.settings;
}

export function createVectorBackup(): { path: string; createdAt: string } {
  const metadata = readMetadata();
  const createdAt = new Date().toISOString();
  const safeTimestamp = createdAt.replace(/:/g, "-");
  const backupDirectory = path.join(
    vectorBackupsPath(),
    `vector-backup-${safeTimestamp}`,
  );
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(vectorMetadataPath())) {
    fs.copyFileSync(
      vectorMetadataPath(),
      path.join(backupDirectory, "workspace.json"),
    );
  }
  metadata.lastBackupAt = createdAt;
  recordActivity(metadata, "Created a local Vector metadata backup", "success");
  writeMetadata(metadata);
  return { path: backupDirectory, createdAt };
}
