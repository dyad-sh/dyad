import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { withLock } from "./lock_utils";

/**
 * The root ".dyad" directory within each app that holds Dyad-managed files.
 */
export const DYAD_INTERNAL_DIR_NAME = ".dyad";

/**
 * The ".dyad"-relative subdir for uploaded media files.
 */
export const DYAD_MEDIA_SUBDIR = "media";

/**
 * The ".dyad"-relative subdir for screenshot files.
 */
export const DYAD_SCREENSHOT_SUBDIR = "screenshot";

/**
 * The subdirectory within each app where uploaded media files are stored.
 */
export const DYAD_MEDIA_DIR_NAME = `${DYAD_INTERNAL_DIR_NAME}/${DYAD_MEDIA_SUBDIR}`;
export const ATTACHMENTS_MANIFEST_FILE = "attachments-manifest.json";

/**
 * The subdirectory within each app where screenshot files are stored.
 */
export const DYAD_SCREENSHOT_DIR_NAME = `${DYAD_INTERNAL_DIR_NAME}/${DYAD_SCREENSHOT_SUBDIR}`;

/**
 * Maximum number of per-commit screenshots retained per app.
 */
export const MAX_SCREENSHOTS_PER_APP = 100;

/**
 * Matches a screenshot filename keyed by a 40-char hex SHA-1 commit hash.
 */
export const SCREENSHOT_FILENAME_REGEX = /^[0-9a-f]{40}\.png$/;

export interface AttachmentManifestEntry {
  logicalName: string;
  originalName: string;
  /**
   * Path of the stored file relative to the media directory. A plain file
   * name for uploads; a `<dir>/<path>` for files extracted from an archive.
   */
  storedFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /**
   * Logical name of the archive attachment this file was extracted from.
   * Present only on extracted entries.
   */
  archiveLogicalName?: string;
}

export interface StoredAttachmentInfo {
  logicalName: string;
  originalName: string;
  storedFileName: string;
  mimeType: string;
  sizeBytes: number;
  filePath: string;
  createdAt?: string;
  archiveLogicalName?: string;
}

export type AttachmentManifestEntryInput = Omit<
  AttachmentManifestEntry,
  "logicalName"
> & {
  requestedLogicalName: string;
  /**
   * Keep the directory segments of `requestedLogicalName` (for files
   * extracted from an archive, named `<archive>/<path>`). Uploads keep the
   * default, which reduces the name to its final segment.
   */
  nestedLogicalName?: boolean;
};

/**
 * Check if an absolute path falls within the app's .dyad/media directory.
 * Used to validate that file copy operations only read from the allowed media dir.
 */
export function isWithinDyadMediaDir(
  absPath: string,
  appPath: string,
): boolean {
  const resolved = path.resolve(absPath);
  const resolvedMediaDir = path.resolve(
    path.join(appPath, DYAD_MEDIA_DIR_NAME),
  );
  const relativePath = path.relative(resolvedMediaDir, resolved);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * Check if an absolute path is a file inside a .dyad/media directory
 * (without requiring a known app path). Validates by finding consecutive
 * ".dyad" + "media" path segments with at least one segment (filename) after,
 * then confirms the resolved path doesn't escape via ".." traversal.
 */
export function isFileWithinAnyDyadMediaDir(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const segments = resolved.split(path.sep);

  let mediaIdx = -1;
  for (let i = 0; i < segments.length - 2; i++) {
    if (segments[i] === ".dyad" && segments[i + 1] === "media") {
      mediaIdx = i + 1;
      break;
    }
  }
  if (mediaIdx === -1) {
    return false;
  }

  const mediaDirPath = segments.slice(0, mediaIdx + 1).join(path.sep);
  const relativePath = path.relative(mediaDirPath, resolved);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function getDyadMediaDir(appPath: string): string {
  return path.join(appPath, DYAD_MEDIA_DIR_NAME);
}

export function getAttachmentsManifestPath(appPath: string): string {
  return path.join(getDyadMediaDir(appPath), ATTACHMENTS_MANIFEST_FILE);
}

export function toAttachmentLogicalPath(logicalName: string): string {
  return `attachments:${logicalName}`;
}

export function stripAttachmentLogicalPrefix(logicalPath: string): string {
  return logicalPath.startsWith("attachments:")
    ? logicalPath.slice("attachments:".length)
    : logicalPath;
}

const MAX_LOGICAL_SEGMENT_LENGTH = 160;

function sanitizeLogicalNameSegment(segment: string): string {
  return segment
    .replace(/```/g, "_")
    .replace(/[<>{}`:\0\r\n]/g, "_")
    .slice(0, MAX_LOGICAL_SEGMENT_LENGTH)
    .trim();
}

function normalizeAttachmentLogicalName(
  originalName: string,
  options?: { nested?: boolean },
): string {
  const segments = originalName
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  if (options?.nested) {
    const sanitized = segments
      .map(sanitizeLogicalNameSegment)
      .filter(Boolean)
      .join("/");
    return sanitized || "attachment";
  }
  const fileName = segments.pop();
  return sanitizeLogicalNameSegment(fileName || "attachment") || "attachment";
}

// The next suffix to try for each colliding name, per set of used names, so
// many entries sharing one name don't each rescan the suffixes from 2.
const nextSuffixByUsedNames = new WeakMap<Set<string>, Map<string, number>>();

export function createUniqueAttachmentLogicalName(
  originalName: string,
  usedNames: Set<string>,
  options?: { nested?: boolean },
): string {
  const logicalName = normalizeAttachmentLogicalName(originalName, options);
  if (!usedNames.has(logicalName)) {
    usedNames.add(logicalName);
    return logicalName;
  }

  const ext = path.extname(logicalName);
  const base = ext ? logicalName.slice(0, -ext.length) : logicalName;
  const dirEnd = base.lastIndexOf("/") + 1;
  const dir = base.slice(0, dirEnd);
  const stem = base.slice(dirEnd);
  let nextSuffixes = nextSuffixByUsedNames.get(usedNames);
  if (!nextSuffixes) {
    nextSuffixes = new Map();
    nextSuffixByUsedNames.set(usedNames, nextSuffixes);
  }
  let suffix = nextSuffixes.get(logicalName) ?? 2;
  while (true) {
    // Keep the suffix inside the segment limit, so normalizing the name again
    // (as an archive's entries do with their parent's name) leaves it intact.
    const suffixText = `-${suffix}`;
    const tail = `${suffixText}${ext.slice(0, MAX_LOGICAL_SEGMENT_LENGTH - suffixText.length)}`;
    const candidate = `${dir}${stem.slice(0, MAX_LOGICAL_SEGMENT_LENGTH - tail.length)}${tail}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      nextSuffixes.set(logicalName, suffix + 1);
      return candidate;
    }
    suffix++;
  }
}

interface ParsedAttachmentManifest {
  entries: readonly AttachmentManifestEntry[];
  byLogicalName: ReadonlyMap<string, AttachmentManifestEntry>;
}

// Parsed manifests, reused while the file is unchanged. Archives can add
// thousands of rows, and a sandbox script may read every entry in one go.
// Writes clear the entry, and the stat check catches any other change. The
// parse is cached while in flight, so concurrent readers share it.
const manifestCache = new Map<
  string,
  {
    mtimeMs: number;
    size: number;
    ino: number;
    parsed: Promise<ParsedAttachmentManifest>;
  }
>();
const MAX_CACHED_MANIFESTS = 8;

const EMPTY_MANIFEST: ParsedAttachmentManifest = {
  entries: [],
  byLogicalName: new Map(),
};

async function readParsedAttachmentManifest(
  appPath: string,
): Promise<ParsedAttachmentManifest> {
  const manifestPath = getAttachmentsManifestPath(appPath);
  let stat;
  try {
    stat = await fs.stat(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      manifestCache.delete(manifestPath);
      return EMPTY_MANIFEST;
    }
    throw error;
  }
  const cached = manifestCache.get(manifestPath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size &&
    cached.ino === stat.ino
  ) {
    return cached.parsed;
  }

  const parsed = parseAttachmentManifest(manifestPath).then((entries) => {
    const byLogicalName = new Map<string, AttachmentManifestEntry>();
    for (const entry of entries) {
      if (!byLogicalName.has(entry.logicalName)) {
        byLogicalName.set(entry.logicalName, entry);
      }
    }
    return { entries, byLogicalName };
  });
  const cacheEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    ino: stat.ino,
    parsed,
  };
  manifestCache.delete(manifestPath);
  manifestCache.set(manifestPath, cacheEntry);
  if (manifestCache.size > MAX_CACHED_MANIFESTS) {
    manifestCache.delete(manifestCache.keys().next().value!);
  }
  parsed.catch(() => {
    if (manifestCache.get(manifestPath) === cacheEntry) {
      manifestCache.delete(manifestPath);
    }
  });
  return parsed;
}

async function readAttachmentManifest(
  appPath: string,
): Promise<readonly AttachmentManifestEntry[]> {
  return (await readParsedAttachmentManifest(appPath)).entries;
}

async function parseAttachmentManifest(
  manifestPath: string,
): Promise<AttachmentManifestEntry[]> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is AttachmentManifestEntry =>
        entry &&
        typeof entry.logicalName === "string" &&
        typeof entry.originalName === "string" &&
        typeof entry.storedFileName === "string" &&
        typeof entry.mimeType === "string" &&
        typeof entry.sizeBytes === "number" &&
        typeof entry.createdAt === "string" &&
        (entry.archiveLogicalName === undefined ||
          typeof entry.archiveLogicalName === "string"),
    );
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    ) {
      return [];
    }
    throw error;
  }
}

async function appendAttachmentManifestEntriesUnlocked(
  appPath: string,
  entries: AttachmentManifestEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const manifestPath = getAttachmentsManifestPath(appPath);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const existing = await readAttachmentManifest(appPath);
  const byLogicalName = new Map<string, AttachmentManifestEntry>();
  for (const entry of existing) {
    byLogicalName.set(entry.logicalName, entry);
  }
  for (const entry of entries) {
    byLogicalName.set(entry.logicalName, entry);
  }
  await writeAttachmentManifestAtomic(manifestPath, [
    ...byLogicalName.values(),
  ]);
}

async function appendAttachmentManifestEntryGroupsUnlocked(
  appPath: string,
  entries: AttachmentManifestEntryInput[],
  buildChildEntries: (
    finalized: AttachmentManifestEntry[],
  ) => AttachmentManifestEntryInput[][],
): Promise<{
  entries: AttachmentManifestEntry[];
  childEntries: AttachmentManifestEntry[][];
}> {
  if (entries.length === 0) {
    return { entries: [], childEntries: [] };
  }

  const manifestPath = getAttachmentsManifestPath(appPath);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const existing = await readAttachmentManifest(appPath);
  const byLogicalName = new Map<string, AttachmentManifestEntry>();
  const byStoredFileName = new Map<string, AttachmentManifestEntry>();
  const usedNames = new Set<string>();
  for (const entry of existing) {
    byLogicalName.set(entry.logicalName, entry);
    if (!byStoredFileName.has(entry.storedFileName)) {
      byStoredFileName.set(entry.storedFileName, entry);
    }
    usedNames.add(entry.logicalName);
  }

  const finalize = (
    inputs: AttachmentManifestEntryInput[],
  ): AttachmentManifestEntry[] => {
    const finalized: AttachmentManifestEntry[] = [];
    for (const {
      requestedLogicalName,
      nestedLogicalName,
      ...entry
    } of inputs) {
      const existingEntry = byStoredFileName.get(entry.storedFileName);
      if (existingEntry) {
        finalized.push(existingEntry);
        continue;
      }

      const newEntry = {
        ...entry,
        logicalName: createUniqueAttachmentLogicalName(
          requestedLogicalName,
          usedNames,
          { nested: nestedLogicalName },
        ),
      };
      finalized.push(newEntry);
      byLogicalName.set(newEntry.logicalName, newEntry);
      byStoredFileName.set(newEntry.storedFileName, newEntry);
    }
    return finalized;
  };

  const finalized = finalize(entries);
  const childEntries = buildChildEntries(finalized).map(finalize);

  await writeAttachmentManifestAtomic(manifestPath, [
    ...byLogicalName.values(),
  ]);

  return { entries: finalized, childEntries };
}

async function writeAttachmentManifestAtomic(
  manifestPath: string,
  entries: AttachmentManifestEntry[],
): Promise<void> {
  const tempPath = path.join(
    path.dirname(manifestPath),
    `.${path.basename(manifestPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), "utf8");
    await fs.rename(tempPath, manifestPath);
    manifestCache.delete(manifestPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function appendAttachmentManifestEntries(
  appPath: string,
  entries: AttachmentManifestEntry[],
): Promise<void> {
  return withLock(`attachments-manifest:${appPath}`, () =>
    appendAttachmentManifestEntriesUnlocked(appPath, entries),
  );
}

export async function appendAttachmentManifestEntriesWithLogicalNames(
  appPath: string,
  entries: AttachmentManifestEntryInput[],
): Promise<AttachmentManifestEntry[]> {
  const { entries: finalized } = await appendAttachmentManifestEntryGroups(
    appPath,
    entries,
    () => [],
  );
  return finalized;
}

/**
 * Register entries plus entries that are named under them, such as an
 * archive's unpacked files, in one manifest write so a failure leaves no
 * partial registration. `buildChildEntries` receives the finalized entries
 * and returns the inputs to register beneath each one, in the same order.
 */
export async function appendAttachmentManifestEntryGroups(
  appPath: string,
  entries: AttachmentManifestEntryInput[],
  buildChildEntries: (
    finalized: AttachmentManifestEntry[],
  ) => AttachmentManifestEntryInput[][],
): Promise<{
  entries: AttachmentManifestEntry[];
  childEntries: AttachmentManifestEntry[][];
}> {
  return withLock(`attachments-manifest:${appPath}`, () =>
    appendAttachmentManifestEntryGroupsUnlocked(
      appPath,
      entries,
      buildChildEntries,
    ),
  );
}

// Archives can add thousands of manifest rows, so their files are checked a
// batch at a time rather than one by one.
const STAT_BATCH_SIZE = 32;

async function pruneAttachmentManifestUnlocked(
  appPath: string,
): Promise<number> {
  const entries = await readAttachmentManifest(appPath);
  if (entries.length === 0) {
    return 0;
  }

  const mediaDir = getDyadMediaDir(appPath);
  const presentEntries: AttachmentManifestEntry[] = [];
  for (let start = 0; start < entries.length; start += STAT_BATCH_SIZE) {
    const batch = entries.slice(start, start + STAT_BATCH_SIZE);
    const present = await Promise.all(
      batch.map((entry) => toStoredAttachmentInfoIfPresent(mediaDir, entry)),
    );
    batch.forEach((entry, index) => {
      if (present[index]) {
        presentEntries.push(entry);
      }
    });
  }
  // Drop entries whose archive is gone, so a later upload of the same bytes
  // under another name doesn't inherit their names.
  const presentArchives = new Set(
    presentEntries
      .filter((entry) => entry.archiveLogicalName === undefined)
      .map((entry) => entry.logicalName),
  );
  const keptEntries = presentEntries.filter(
    (entry) =>
      entry.archiveLogicalName === undefined ||
      presentArchives.has(entry.archiveLogicalName),
  );

  const removedCount = entries.length - keptEntries.length;
  if (removedCount > 0) {
    await writeAttachmentManifestAtomic(
      getAttachmentsManifestPath(appPath),
      keptEntries,
    );
  }

  return removedCount;
}

export async function pruneAttachmentManifest(
  appPath: string,
): Promise<number> {
  return withLock(`attachments-manifest:${appPath}`, () =>
    pruneAttachmentManifestUnlocked(appPath),
  );
}

// Media paths that an attachment turn is still working on, from the moment
// it stores or unpacks them until the manifest records them. Stored names are
// content hashes, so two turns can touch the same path at once.
const inFlightMediaPaths = new Map<string, number>();

/**
 * Mark a media path as in use by a turn that has not registered it yet.
 * Returns the matching release; releasing twice is harmless.
 */
export function reserveMediaPath(mediaPath: string): () => void {
  const key = path.resolve(mediaPath);
  inFlightMediaPaths.set(key, (inFlightMediaPaths.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (inFlightMediaPaths.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      inFlightMediaPaths.delete(key);
    } else {
      inFlightMediaPaths.set(key, remaining);
    }
  };
}

/**
 * Remove stored files or extraction directories that no manifest entry
 * points at and no other turn is still working on. Stored names are content
 * hashes shared across chats, so a turn that is rejected before registering
 * its attachments must not delete media another turn registered meanwhile
 * or is about to register. The check and the removal run under the manifest
 * lock, which registration also takes; callers release their own
 * reservations first.
 */
export async function removeUnreferencedMediaPaths(
  appPath: string,
  candidatePaths: readonly string[],
): Promise<string[]> {
  if (candidatePaths.length === 0) {
    return [];
  }
  return withLock(`attachments-manifest:${appPath}`, async () => {
    const mediaDir = getDyadMediaDir(appPath);
    const referenced = (await readAttachmentManifest(appPath))
      .map((entry) => resolveStoredFilePath(mediaDir, entry.storedFileName))
      .filter((filePath): filePath is string => filePath !== null)
      .map((filePath) => path.resolve(filePath));
    const removed: string[] = [];
    for (const candidate of candidatePaths) {
      const resolved = path.resolve(candidate);
      const isReferenced = referenced.some(
        (filePath) =>
          filePath === resolved || filePath.startsWith(resolved + path.sep),
      );
      if (isReferenced || inFlightMediaPaths.has(resolved)) {
        continue;
      }
      await fs.rm(resolved, { recursive: true, force: true });
      removed.push(resolved);
    }
    return removed;
  });
}

/**
 * Resolve a manifest `storedFileName` to its path inside the media directory,
 * or null when the name could point anywhere else. Uploads are a single
 * segment; archive entries are `<dir>/<path>` with forward slashes. Every
 * segment must be a plain name, so a tampered manifest cannot reach outside
 * the media directory.
 */
export function resolveStoredFilePath(
  mediaDir: string,
  storedFileName: string,
): string | null {
  const segments = storedFileName.split("/");
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return null;
    }
  }
  return path.join(mediaDir, ...segments);
}

async function toStoredAttachmentInfoIfPresent(
  mediaDir: string,
  entry: AttachmentManifestEntry,
): Promise<StoredAttachmentInfo | null> {
  const filePath = resolveStoredFilePath(mediaDir, entry.storedFileName);
  if (!filePath) {
    return null;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return {
    ...entry,
    filePath,
  };
}

/**
 * Manifest entries whose stored file still exists, in manifest order.
 * `logicalNamePrefix` limits the check to matching entries, and
 * `topLevelOnly` leaves out entries unpacked from archives.
 */
export async function listStoredAttachments(
  appPath: string,
  {
    logicalNamePrefix = "",
    topLevelOnly = false,
  }: { logicalNamePrefix?: string; topLevelOnly?: boolean } = {},
): Promise<StoredAttachmentInfo[]> {
  const mediaDir = getDyadMediaDir(appPath);
  const entries = (await readAttachmentManifest(appPath)).filter(
    (entry) =>
      entry.logicalName.startsWith(logicalNamePrefix) &&
      !(topLevelOnly && entry.archiveLogicalName !== undefined),
  );
  const storedAttachments: StoredAttachmentInfo[] = [];
  for (let start = 0; start < entries.length; start += STAT_BATCH_SIZE) {
    const batch = await Promise.all(
      entries
        .slice(start, start + STAT_BATCH_SIZE)
        .map((entry) => toStoredAttachmentInfoIfPresent(mediaDir, entry)),
    );
    for (const storedAttachment of batch) {
      if (storedAttachment) {
        storedAttachments.push(storedAttachment);
      }
    }
  }
  return storedAttachments;
}

/**
 * Sorted `attachments:` paths for a listing. `attachments:` lists uploaded
 * files, archives included but not their entries; `attachments:<archive>` (or
 * a folder inside it) lists the entries under it and throws NotFound when
 * there are none, like a missing directory.
 */
export async function listAttachmentLogicalPaths(
  appPath: string,
  directory: string,
): Promise<string[]> {
  const scope = stripAttachmentLogicalPrefix(directory).replace(/\/+$/, "");
  const prefix = scope ? `${scope}/` : "";
  const paths = (
    await listStoredAttachments(appPath, {
      logicalNamePrefix: prefix,
      topLevelOnly: !scope,
    })
  )
    .map((attachment) => toAttachmentLogicalPath(attachment.logicalName))
    .sort((a, b) => a.localeCompare(b));
  if (scope && paths.length === 0) {
    throw new DyadError(
      `Directory not found: ${directory}`,
      DyadErrorKind.NotFound,
    );
  }
  return paths;
}

export async function resolveAttachmentLogicalPath(
  appPath: string,
  logicalPath: string,
): Promise<StoredAttachmentInfo | null> {
  const logicalName = stripAttachmentLogicalPrefix(logicalPath);
  const entry =
    (await readParsedAttachmentManifest(appPath)).byLogicalName.get(
      logicalName,
    ) ?? null;
  if (!entry) {
    return null;
  }
  return toStoredAttachmentInfoIfPresent(getDyadMediaDir(appPath), entry);
}
