import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
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
  storedFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StoredAttachmentInfo {
  logicalName: string;
  originalName: string;
  storedFileName: string;
  mimeType: string;
  sizeBytes: number;
  filePath: string;
}

export type AttachmentManifestEntryInput = Omit<
  AttachmentManifestEntry,
  "logicalName"
> & {
  requestedLogicalName: string;
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

function normalizeAttachmentLogicalName(originalName: string): string {
  const fileName = originalName.split(/[\\/]/).filter(Boolean).pop()?.trim();
  const sanitized = (fileName || "attachment")
    .replace(/```/g, "_")
    .replace(/[<>{}`:\0\r\n]/g, "_")
    .slice(0, 160)
    .trim();
  return sanitized || "attachment";
}

export function createUniqueAttachmentLogicalName(
  originalName: string,
  usedNames: Set<string>,
): string {
  const logicalName = normalizeAttachmentLogicalName(originalName);
  if (!usedNames.has(logicalName)) {
    usedNames.add(logicalName);
    return logicalName;
  }

  const ext = path.extname(logicalName);
  const base = ext ? logicalName.slice(0, -ext.length) : logicalName;
  let suffix = 2;
  while (true) {
    const candidate = `${base}-${suffix}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix++;
  }
}

async function readAttachmentManifest(
  appPath: string,
): Promise<AttachmentManifestEntry[]> {
  try {
    const raw = await fs.readFile(getAttachmentsManifestPath(appPath), "utf8");
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
        typeof entry.createdAt === "string",
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

async function appendAttachmentManifestEntriesWithLogicalNamesUnlocked(
  appPath: string,
  entries: AttachmentManifestEntryInput[],
): Promise<AttachmentManifestEntry[]> {
  if (entries.length === 0) {
    return [];
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

  const finalized: AttachmentManifestEntry[] = [];
  for (const { requestedLogicalName, ...entry } of entries) {
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
      ),
    };
    finalized.push(newEntry);
    byLogicalName.set(newEntry.logicalName, newEntry);
    byStoredFileName.set(newEntry.storedFileName, newEntry);
  }

  await writeAttachmentManifestAtomic(manifestPath, [
    ...byLogicalName.values(),
  ]);

  return finalized;
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
  return withLock(`attachments-manifest:${appPath}`, () =>
    appendAttachmentManifestEntriesWithLogicalNamesUnlocked(appPath, entries),
  );
}

async function pruneAttachmentManifestUnlocked(
  appPath: string,
): Promise<number> {
  const entries = await readAttachmentManifest(appPath);
  if (entries.length === 0) {
    return 0;
  }

  const mediaDir = getDyadMediaDir(appPath);
  const keptEntries: AttachmentManifestEntry[] = [];
  for (const entry of entries) {
    const storedAttachment = await toStoredAttachmentInfoIfPresent(
      mediaDir,
      entry,
    );
    if (storedAttachment) {
      keptEntries.push(entry);
    }
  }

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

async function toStoredAttachmentInfoIfPresent(
  mediaDir: string,
  entry: AttachmentManifestEntry,
): Promise<StoredAttachmentInfo | null> {
  const filePath = path.join(mediaDir, path.basename(entry.storedFileName));
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

export async function listStoredAttachments(
  appPath: string,
): Promise<StoredAttachmentInfo[]> {
  const mediaDir = getDyadMediaDir(appPath);
  const entries = await readAttachmentManifest(appPath);
  const storedAttachments: StoredAttachmentInfo[] = [];
  for (const entry of entries) {
    const storedAttachment = await toStoredAttachmentInfoIfPresent(
      mediaDir,
      entry,
    );
    if (storedAttachment) {
      storedAttachments.push(storedAttachment);
    }
  }
  return storedAttachments;
}

export async function resolveAttachmentLogicalPath(
  appPath: string,
  logicalPath: string,
): Promise<StoredAttachmentInfo | null> {
  const logicalName = stripAttachmentLogicalPrefix(logicalPath);
  const entry =
    (await readAttachmentManifest(appPath)).find(
      (manifestEntry) => manifestEntry.logicalName === logicalName,
    ) ?? null;
  if (!entry) {
    return null;
  }
  return toStoredAttachmentInfoIfPresent(getDyadMediaDir(appPath), entry);
}
