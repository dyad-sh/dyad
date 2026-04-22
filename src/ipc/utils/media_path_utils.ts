import path from "node:path";
import fs from "node:fs/promises";
import { withLock } from "./lock_utils";

/**
 * The subdirectory within each app where uploaded media files are stored.
 */
export const DYAD_MEDIA_DIR_NAME = ".dyad/media";
export const ATTACHMENTS_MANIFEST_FILE = "attachments-manifest.json";

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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
  await fs.writeFile(
    manifestPath,
    JSON.stringify([...byLogicalName.values()], null, 2),
  );
}

export async function appendAttachmentManifestEntries(
  appPath: string,
  entries: AttachmentManifestEntry[],
): Promise<void> {
  return withLock(`attachments-manifest:${appPath}`, () =>
    appendAttachmentManifestEntriesUnlocked(appPath, entries),
  );
}

export async function listStoredAttachments(
  appPath: string,
): Promise<StoredAttachmentInfo[]> {
  const mediaDir = getDyadMediaDir(appPath);
  const entries = await readAttachmentManifest(appPath);
  return entries.map((entry) => ({
    ...entry,
    filePath: path.join(mediaDir, path.basename(entry.storedFileName)),
  }));
}

export async function resolveAttachmentLogicalPath(
  appPath: string,
  logicalPath: string,
): Promise<StoredAttachmentInfo | null> {
  const logicalName = stripAttachmentLogicalPrefix(logicalPath);
  const entries = await listStoredAttachments(appPath);
  return entries.find((entry) => entry.logicalName === logicalName) ?? null;
}
