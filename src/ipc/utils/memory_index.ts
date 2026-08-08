/**
 * Connecting the memory vault to the existing local vector workspace.
 *
 * This deliberately adds no second vector implementation: collections,
 * chunking, embedding, point identity and stale-point removal all come from
 * `vector_workspace`. Point IDs there are derived from the chunk's content, so
 * re-indexing unchanged text upserts the same IDs and cannot duplicate, and a
 * re-index deletes the source's previous points before writing new ones — so a
 * changed file replaces its vectors rather than accumulating them.
 *
 * What belongs here is everything that is specific to *memory*: which folder
 * is indexed, which files are excluded by their own privacy flags, and how a
 * search result becomes a memory with a kind, a project and a person.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import {
  createVectorCollection,
  indexVectorPaths,
  listVectorCollections,
  listVectorSources,
  removeVectorSource,
  searchVectorWorkspace,
} from "./vector_workspace";
import { MEMORY_ROOT } from "./memory_vault";
import {
  mayIndex,
  maySendToCloud,
  parseMemoryDocument,
} from "./memory_documents";
import type { RetrievedMemory } from "./memory_context";
import { classifyMemoryPath } from "./memory_retrieval";

const logger = log.scope("memory_index");

/** The collection memory lives in, kept apart from the user's own knowledge. */
export const MEMORY_COLLECTION_NAME = "AI Memory";

/** Finds the memory collection, creating it the first time. */
export async function ensureMemoryCollection(): Promise<string> {
  const existing = listVectorCollections().find(
    (collection) => collection.name === MEMORY_COLLECTION_NAME,
  );
  if (existing) return existing.id;

  const created = await createVectorCollection({
    name: MEMORY_COLLECTION_NAME,
    description:
      "The assistant's own memory. Rebuilt from the Markdown files in " +
      "Memory/, which remain the source of truth.",
  });
  return created.id;
}

/**
 * Memory files that are allowed to be indexed.
 *
 * A file carrying `do_not_index` is skipped entirely — not indexed and then
 * filtered later, but never embedded at all, so nothing about it reaches the
 * vector store.
 */
export function indexableMemoryFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, MEMORY_ROOT);
  if (!fs.existsSync(root)) return [];

  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Diagnostic logs are about the system, not the user. Indexing them
        // would put request metadata into semantic recall.
        if (entry.name === "Logs" || entry.name === "Jobs") continue;
        walk(full);
        continue;
      }
      if (!/\.mdx?$/i.test(entry.name)) continue;
      try {
        const { frontMatter } = parseMemoryDocument(
          fs.readFileSync(full, "utf8"),
        );
        if (mayIndex(frontMatter)) files.push(full);
      } catch (error) {
        logger.warn(
          `Could not read ${entry.name} while indexing memory`,
          error,
        );
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Indexes the memory vault.
 *
 * Returns the number of files offered to the indexer. Failure is reported, not
 * thrown: memory is an enhancement, and a vector store that is down must never
 * stop the user from chatting.
 */
export async function indexMemoryVault(
  vaultPath: string,
): Promise<{ indexed: number; ok: boolean }> {
  const files = indexableMemoryFiles(vaultPath);
  if (files.length === 0) return { indexed: 0, ok: true };

  try {
    const collectionId = await ensureMemoryCollection();
    await pruneExcludedSources(collectionId, files);
    await indexVectorPaths(collectionId, files);
    return { indexed: files.length, ok: true };
  } catch (error) {
    logger.error("Memory indexing failed", error);
    return { indexed: 0, ok: false };
  }
}

/**
 * Removes vectors for memory files that have been deleted or newly excluded.
 *
 * Without this, marking a file `do_not_index` would stop it being refreshed
 * but leave whatever was already embedded searchable — the opposite of what
 * the flag promises.
 */
async function pruneExcludedSources(
  collectionId: string,
  allowedFiles: string[],
): Promise<void> {
  const allowed = new Set(allowedFiles.map((file) => path.resolve(file)));
  for (const source of listVectorSources(collectionId)) {
    const resolved = path.resolve(source.path);
    // Only prune memory files; a directory source covers many.
    if (!resolved.includes(`${path.sep}${MEMORY_ROOT}${path.sep}`)) continue;
    if (allowed.has(resolved)) continue;
    try {
      await removeVectorSource(collectionId, source.id);
      logger.log(`Removed memory vectors for ${path.basename(resolved)}`);
    } catch (error) {
      logger.warn("Could not remove stale memory vectors", error);
    }
  }
}

/** Reads the front matter of a memory file, tolerating a missing file. */
function readFrontMatter(filePath: string) {
  try {
    return parseMemoryDocument(fs.readFileSync(filePath, "utf8")).frontMatter;
  } catch {
    return {};
  }
}

/**
 * Searches memory, returning results already carrying the metadata that
 * ranking and privacy filtering need.
 *
 * Never throws. When the vector service is unavailable this returns nothing,
 * and the conversation proceeds without memory.
 */
export async function searchMemory(
  vaultPath: string,
  query: string,
  limit: number,
): Promise<RetrievedMemory[]> {
  try {
    const collectionId = await ensureMemoryCollection();
    const results = await searchVectorWorkspace({
      query,
      collectionIds: [collectionId],
      limit,
      minimumScore: 0.05,
    });

    return results.map((result) => {
      const relative = path
        .relative(vaultPath, result.sourcePath)
        .replace(/\\/g, "/");
      const { kind, project, person } = classifyMemoryPath(relative);
      const frontMatter = readFrontMatter(result.sourcePath);

      return {
        kind,
        sourcePath: relative,
        content: result.content,
        score: result.score,
        updatedAt:
          typeof frontMatter.updated === "string"
            ? frontMatter.updated
            : undefined,
        cloudSafe: maySendToCloud(frontMatter),
        // Carried for ranking; not part of the injected block.
        project:
          project ??
          (typeof frontMatter.project === "string" &&
          frontMatter.project !== "null"
            ? frontMatter.project
            : null),
        person:
          person ??
          (typeof frontMatter.name === "string" ? frontMatter.name : null),
      } as RetrievedMemory & { project: string | null; person: string | null };
    });
  } catch (error) {
    // Chatting continues without memory rather than failing the turn.
    logger.warn("Memory search unavailable; continuing without it", error);
    return [];
  }
}
