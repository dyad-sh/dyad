import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "../../main/settings";
import { initializeLocalVault, vaultDocumentsPath } from "./storage_vault";
import {
  createVectorCollection,
  getVectorOverview,
  indexVectorPaths,
  listVectorCollections,
  listVectorSources,
  removeVectorSource,
} from "./vector_workspace";
import { startVectorService } from "./vector_service_manager";
import type {
  KnowledgeBaseDocument,
  KnowledgeBaseOverview,
} from "../types/vector";

const logger = log.scope("knowledge_base");

/** Name of the collection backing the documents vault. */
export const KNOWLEDGE_BASE_COLLECTION_NAME = "Knowledge Base";

/**
 * The Knowledge Base is a single Vector collection wired to one folder in the
 * user's vault. Each document is registered as its own source rather than
 * indexing the folder as a unit, so the UI can list documents individually
 * with their own chunk counts and re-index state.
 */

export function getDocumentsFolder(): string | null {
  const vaultPath = readSettings().storage?.localVaultPath?.trim();
  if (!vaultPath) return null;
  try {
    return vaultDocumentsPath(vaultPath);
  } catch (error) {
    logger.warn("Vault path is not usable", error);
    return null;
  }
}

/**
 * Resolve the documents folder, repairing the vault structure first. Running
 * the initializer again is safe (it only creates what is missing), so vaults
 * created before the Documents folder existed get healed on first use.
 */
async function requireDocumentsFolder(): Promise<string> {
  const vaultPath = readSettings().storage?.localVaultPath?.trim();
  if (!vaultPath) {
    throw new DyadError(
      "Choose a local vault folder in Storage before using the Knowledge Base.",
      DyadErrorKind.Precondition,
    );
  }
  await initializeLocalVault(vaultPath);
  return vaultDocumentsPath(vaultPath);
}

async function ensureCollection(): Promise<string> {
  const existing = listVectorCollections().find(
    (collection) => collection.name === KNOWLEDGE_BASE_COLLECTION_NAME,
  );
  if (existing) return existing.id;

  const created = await createVectorCollection({
    name: KNOWLEDGE_BASE_COLLECTION_NAME,
    description: "Documents from your vault, indexed for local retrieval.",
  });
  return created.id;
}

/** Files sitting directly in (or nested under) the documents folder. */
function listDocumentFiles(folder: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  visit(folder);
  return files.sort();
}

/** Prefer an extracted Markdown sidecar over OCRing its PDF again. */
function indexableDocumentFiles(files: string[]): string[] {
  const paths = new Set(files.map((file) => path.resolve(file)));
  return files.filter((file) => {
    if (!/\.pdf$/i.test(file)) return true;
    const sidecar = file.replace(/\.pdf$/i, ".md");
    return !paths.has(path.resolve(sidecar));
  });
}

export type KnowledgeBaseProgressUpdate = {
  phase: "uploading" | "indexing";
  completedCount: number;
  totalCount: number;
  currentFile?: string;
  completedBytes?: number;
  totalBytes?: number;
};

const FILE_COPY_BUFFER_BYTES = 1024 * 1024;

async function filesAreEqual(
  sourcePath: string,
  destinationPath: string,
  sizeBytes: number,
): Promise<boolean> {
  const source = await fs.promises.open(sourcePath, "r");
  const destination = await fs.promises.open(destinationPath, "r");
  try {
    const sourceBuffer = Buffer.allocUnsafe(FILE_COPY_BUFFER_BYTES);
    const destinationBuffer = Buffer.allocUnsafe(FILE_COPY_BUFFER_BYTES);
    let offset = 0;
    while (offset < sizeBytes) {
      const length = Math.min(FILE_COPY_BUFFER_BYTES, sizeBytes - offset);
      const [sourceRead, destinationRead] = await Promise.all([
        source.read(sourceBuffer, 0, length, offset),
        destination.read(destinationBuffer, 0, length, offset),
      ]);
      if (
        sourceRead.bytesRead !== destinationRead.bytesRead ||
        !sourceBuffer
          .subarray(0, sourceRead.bytesRead)
          .equals(destinationBuffer.subarray(0, destinationRead.bytesRead))
      ) {
        return false;
      }
      offset += sourceRead.bytesRead;
    }
    return true;
  } finally {
    await Promise.all([source.close(), destination.close()]);
  }
}

async function copyFileWithProgress(
  sourcePath: string,
  destinationPath: string,
  onProgress: (copiedBytes: number) => void,
): Promise<void> {
  let destinationCreated = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const reader = fs.createReadStream(sourcePath, {
        highWaterMark: FILE_COPY_BUFFER_BYTES,
      });
      const writer = fs.createWriteStream(destinationPath, { flags: "wx" });
      let copiedBytes = 0;
      const fail = (error: Error) => {
        reader.destroy();
        writer.destroy();
        reject(error);
      };
      writer.once("open", () => {
        destinationCreated = true;
      });
      reader.on("data", (chunk) => {
        copiedBytes += Buffer.isBuffer(chunk)
          ? chunk.byteLength
          : Buffer.byteLength(chunk);
        onProgress(copiedBytes);
      });
      reader.once("error", fail);
      writer.once("error", fail);
      writer.once("finish", resolve);
      reader.pipe(writer);
    });
  } catch (error) {
    if (destinationCreated) {
      await fs.promises.unlink(destinationPath).catch(() => undefined);
    }
    throw error;
  }
}

function toDocument(
  source: ReturnType<typeof listVectorSources>[number],
): KnowledgeBaseDocument {
  let sizeBytes = 0;
  let missing = false;
  try {
    sizeBytes = fs.statSync(source.path).size;
  } catch {
    // Indexed earlier, then deleted from the folder.
    missing = true;
  }
  return {
    id: source.id,
    name: source.name,
    path: source.path,
    extension: path.extname(source.path).toLowerCase().replace(".", ""),
    sizeBytes,
    chunkCount: source.chunkCount,
    status: missing ? "missing" : source.status,
    lastIndexedAt: source.lastIndexedAt ?? null,
    error: source.error ?? null,
  };
}

export async function getKnowledgeBaseOverview(): Promise<KnowledgeBaseOverview> {
  const folder = getDocumentsFolder();

  // The engine is started on demand, so simply reading the overview used to
  // report "offline" every time this page was opened — which reads as broken
  // rather than idle. Opening the Knowledge Base is a clear signal the store
  // is about to be used, so bring it up and report the truth.
  try {
    await startVectorService();
  } catch (error) {
    logger.warn(
      `Vector engine did not start for the Knowledge Base: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const overview = await getVectorOverview();
  const collection = listVectorCollections().find(
    (entry) => entry.name === KNOWLEDGE_BASE_COLLECTION_NAME,
  );

  const documents = collection
    ? listVectorSources(collection.id)
        .filter((source) => source.kind === "file")
        .map(toDocument)
    : [];

  // Files present in the folder that have never been indexed.
  const indexedPaths = new Set(documents.map((document) => document.path));
  const pendingCount = folder
    ? indexableDocumentFiles(listDocumentFiles(folder)).filter(
        (file) => !indexedPaths.has(file),
      ).length
    : 0;

  return {
    status: overview.status,
    documentsFolder: folder,
    collectionId: collection?.id ?? null,
    embeddingModel: overview.embeddingModel,
    dimensions: collection?.dimensions ?? 384,
    storageBytes: overview.storageBytes,
    documentCount: documents.length,
    chunkCount: documents.reduce(
      (total, document) => total + document.chunkCount,
      0,
    ),
    pendingCount,
    lastIndexedAt:
      documents
        .map((document) => document.lastIndexedAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null,
    documents,
  };
}

/**
 * Index everything in the documents folder. Files already indexed are
 * re-indexed (their points are replaced), and sources whose file has since
 * been deleted are dropped so the list matches what is on disk.
 */
export async function indexKnowledgeBase(
  onProgress?: (progress: KnowledgeBaseProgressUpdate) => void,
): Promise<KnowledgeBaseOverview> {
  const folder = await requireDocumentsFolder();
  const collectionId = await ensureCollection();

  const files = indexableDocumentFiles(listDocumentFiles(folder));

  // Drop sources whose backing file is gone, and collect the ones that still
  // exist outside the vault folder. Those were added by path and would
  // otherwise never be re-indexed — leaving a source stuck at zero chunks
  // with no way for the user to refresh it.
  const external: string[] = [];
  for (const source of listVectorSources(collectionId)) {
    if (source.kind === "file" && !fs.existsSync(source.path)) {
      await removeVectorSource(collectionId, source.id);
      continue;
    }
    if (!files.includes(source.path)) external.push(source.path);
  }

  const targets = [...files, ...external];
  // Say what is about to be indexed. A run that finds nothing must be
  // distinguishable from a run that never happened.
  logger.log(
    `Indexing knowledge base: ${files.length} vault file(s), ${external.length} external source(s)`,
  );
  if (targets.length === 0) {
    onProgress?.({
      phase: "indexing",
      completedCount: 0,
      totalCount: 0,
    });
    logger.warn(
      `Nothing to index. Documents folder: ${folder}. Add files there, or add a path from the Vector screen.`,
    );
  } else {
    await indexVectorPaths(collectionId, targets, (progress) => {
      onProgress?.({ phase: "indexing", ...progress });
    });
    logger.log(`Indexing finished for ${targets.length} target(s)`);
  }

  return getKnowledgeBaseOverview();
}

/** Copy chosen files into the documents folder, then index them. */
export async function addKnowledgeBaseDocuments(
  sourcePaths: string[],
  onProgress?: (progress: KnowledgeBaseProgressUpdate) => void,
): Promise<KnowledgeBaseOverview> {
  const folder = await requireDocumentsFolder();

  const sourceSizes = new Map<string, number>();
  for (const sourcePath of sourcePaths) {
    try {
      const stat = await fs.promises.stat(sourcePath);
      if (stat.isFile()) sourceSizes.set(sourcePath, stat.size);
    } catch {
      // Reported as a completed/skipped item below.
    }
  }
  const totalBytes = [...sourceSizes.values()].reduce(
    (total, size) => total + size,
    0,
  );
  let completedBytes = 0;
  let completedCount = 0;
  onProgress?.({
    phase: "uploading",
    completedCount,
    totalCount: sourcePaths.length,
    completedBytes,
    totalBytes,
  });

  for (const sourcePath of sourcePaths) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(sourcePath);
    } catch {
      completedCount += 1;
      onProgress?.({
        phase: "uploading",
        completedCount,
        totalCount: sourcePaths.length,
        currentFile: path.basename(sourcePath),
        completedBytes,
        totalBytes,
      });
      continue;
    }
    if (!stat.isFile()) {
      completedCount += 1;
      onProgress?.({
        phase: "uploading",
        completedCount,
        totalCount: sourcePaths.length,
        currentFile: path.basename(sourcePath),
        completedBytes,
        totalBytes,
      });
      continue;
    }

    // Never overwrite an existing document; suffix instead.
    const extension = path.extname(sourcePath);
    const base = path.basename(sourcePath, extension);
    let destination = path.join(folder, `${base}${extension}`);
    let attempt = 1;
    let alreadyPresent = false;
    while (fs.existsSync(destination)) {
      if (
        fs.statSync(destination).size === stat.size &&
        (await filesAreEqual(sourcePath, destination, stat.size))
      ) {
        // Identical file already in the vault.
        alreadyPresent = true;
        break;
      }
      destination = path.join(folder, `${base} (${attempt})${extension}`);
      attempt += 1;
    }
    if (!alreadyPresent) {
      await copyFileWithProgress(sourcePath, destination, (copiedBytes) => {
        onProgress?.({
          phase: "uploading",
          completedCount,
          totalCount: sourcePaths.length,
          currentFile: path.basename(sourcePath),
          completedBytes: completedBytes + copiedBytes,
          totalBytes,
        });
      });
    }
    completedBytes += stat.size;
    completedCount += 1;
    onProgress?.({
      phase: "uploading",
      completedCount,
      totalCount: sourcePaths.length,
      currentFile: path.basename(sourcePath),
      completedBytes,
      totalBytes,
    });
  }

  return indexKnowledgeBase(onProgress);
}

/** Re-index one failed document without making the user re-run the vault. */
export async function retryKnowledgeBaseDocument(
  documentId: string,
  onProgress?: (progress: KnowledgeBaseProgressUpdate) => void,
): Promise<KnowledgeBaseOverview> {
  const collection = listVectorCollections().find(
    (entry) => entry.name === KNOWLEDGE_BASE_COLLECTION_NAME,
  );
  if (!collection) {
    throw new DyadError(
      "The Knowledge Base index no longer exists. Choose Index now to rebuild it.",
      DyadErrorKind.NotFound,
    );
  }

  const source = listVectorSources(collection.id).find(
    (entry) => entry.id === documentId,
  );
  if (!source) {
    throw new DyadError(
      "That document is no longer in the Knowledge Base.",
      DyadErrorKind.NotFound,
    );
  }
  if (!fs.existsSync(source.path)) {
    throw new DyadError(
      "The original document is missing. Put it back in the Documents folder, then choose Index now.",
      DyadErrorKind.Precondition,
    );
  }

  await indexVectorPaths(collection.id, [source.path], (progress) => {
    onProgress?.({ phase: "indexing", ...progress });
  });
  return getKnowledgeBaseOverview();
}

/**
 * Files a document that was read by OCR into the vault, alongside its
 * extracted text, and indexes both.
 *
 * The original is kept because it is the artefact the user actually has; the
 * `.md` sidecar is what the embedder indexes, since the vector store reads
 * text rather than PDF bytes. The original remains available in the vault.
 */
export async function saveOcrDocumentToVault(input: {
  fileName: string;
  dataBase64: string;
  text: string;
  model: string;
}): Promise<{ documentPath: string; textPath: string } | null> {
  // No vault configured is a normal state, not an error: the chat still works.
  const vaultPath = readSettings().storage?.localVaultPath?.trim();
  if (!vaultPath) return null;

  const folder = await requireDocumentsFolder();
  const extension = path.extname(input.fileName);
  const base = safeDocumentName(path.basename(input.fileName, extension));

  let stem = base;
  let attempt = 1;
  while (fs.existsSync(path.join(folder, `${stem}${extension}`))) {
    // An identical re-upload should not pile up copies.
    const existing = path.join(folder, `${stem}${extension}`);
    const incoming = Buffer.from(input.dataBase64, "base64");
    if (fs.readFileSync(existing).equals(incoming)) break;
    stem = `${base} (${attempt})`;
    attempt += 1;
  }

  const documentPath = path.join(folder, `${stem}${extension}`);
  const textPath = path.join(folder, `${stem}.md`);

  await fs.promises.writeFile(
    documentPath,
    Buffer.from(input.dataBase64, "base64"),
  );
  await fs.promises.writeFile(
    textPath,
    `---\ntype: document-text\nsource: ${JSON.stringify(input.fileName)}\nextracted_by: ${JSON.stringify(input.model)}\nextracted: ${new Date().toISOString()}\ntags:\n  - meta-human\n  - ocr\n---\n\n# ${input.fileName}\n\n${input.text}\n`,
    "utf8",
  );

  // Indexing is best-effort and must not hold the chat OCR response open. The
  // markdown sidecar already contains the extracted text, so indexing the PDF
  // too would send the same document through OCR a second time and can keep
  // the chat's "Finishing up" card alive for minutes.
  void (async () => {
    const collectionId = await ensureCollection();
    await indexVectorPaths(collectionId, [textPath]);
  })().catch((error) => {
    logger.warn(
      `Saved ${input.fileName} to the vault but could not index it: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  });

  return { documentPath, textPath };
}

function safeDocumentName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Document"
  );
}

/** Remove a document from the index and, optionally, from the vault folder. */
export async function removeKnowledgeBaseDocument(input: {
  documentId: string;
  deleteFile: boolean;
}): Promise<KnowledgeBaseOverview> {
  const collection = listVectorCollections().find(
    (entry) => entry.name === KNOWLEDGE_BASE_COLLECTION_NAME,
  );
  if (!collection) {
    return getKnowledgeBaseOverview();
  }
  const source = listVectorSources(collection.id).find(
    (entry) => entry.id === input.documentId,
  );
  if (!source) {
    return getKnowledgeBaseOverview();
  }

  await removeVectorSource(collection.id, source.id);

  if (input.deleteFile) {
    const folder = getDocumentsFolder();
    // Only ever delete inside the vault documents folder.
    if (folder && path.resolve(source.path).startsWith(path.resolve(folder))) {
      try {
        fs.unlinkSync(source.path);
      } catch (error) {
        logger.warn(`Could not delete ${source.path}`, error);
      }
    }
  }

  return getKnowledgeBaseOverview();
}
