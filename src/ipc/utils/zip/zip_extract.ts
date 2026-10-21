import fs from "node:fs/promises";
import path from "node:path";

import {
  isSupportedZipCompression,
  readZipDirectory,
  readZipEntryData,
  ZipFormatError,
  ZipLimitError,
  type ZipEntry,
} from "./zip_reader";

export { ZipLimitError };

/**
 * Extraction policy on top of the container reader. The reader hands back
 * whatever the archive declares; this layer decides what is allowed to reach
 * the filesystem:
 *
 * - Entry names are normalized to forward slashes and rejected when they are
 *   absolute, drive-qualified, contain ".." or control characters, or nest
 *   deeper than the limit. Names Windows cannot hold as regular files
 *   (reserved device names, the characters `:<>"|?*`, trailing dots or
 *   spaces) are rejected on
 *   every platform so an archive behaves the same everywhere. The final
 *   destination is also checked against the extraction root after
 *   resolution, so no entry can write outside it.
 * - Symlinks are never materialized (the reader reports them; they are skipped).
 * - Encrypted entries and unsupported compression methods are skipped with a
 *   reason rather than failing the whole archive.
 * - Packaging noise (`__MACOSX`, `node_modules`, `.git`, `.DS_Store`,
 *   `Thumbs.db`) is skipped.
 * - The number of files to extract and their total uncompressed size are
 *   capped before any byte is written, and the bytes actually written are
 *   counted against the same cap in case an entry lied about its size. A
 *   looser cap on every declared entry bounds parsing itself.
 * - When every file sits under one top-level folder (how Finder and most
 *   "compress folder" tools package a project) that folder is stripped, and
 *   its name is reported so the caller can mention it.
 */

export interface ZipExtractionLimits {
  /** Files to extract, after folders and skipped entries are left out. */
  maxEntries: number;
  /**
   * Every entry the archive declares. This bounds parsing, and is generous
   * so a project zipped with node_modules or .git still opens.
   */
  maxDirectoryEntries: number;
  maxTotalUncompressedBytes: number;
  maxPathDepth: number;
}

export const DEFAULT_ZIP_EXTRACTION_LIMITS: ZipExtractionLimits = {
  maxEntries: 5_000,
  maxDirectoryEntries: 50_000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxPathDepth: 32,
};

export type ZipSkipReason =
  | "encrypted"
  | "unsupported-compression"
  | "unsafe-path"
  | "symlink"
  | "ignored"
  | "unwritable";

export interface ExtractedZipFile {
  /** Forward-slash path relative to the extraction root, root folder stripped. */
  relativePath: string;
  sizeBytes: number;
}

export interface SkippedZipEntry {
  name: string;
  reason: ZipSkipReason;
}

export interface ZipExtractionResult {
  files: ExtractedZipFile[];
  skipped: SkippedZipEntry[];
  /** Name of the single top-level folder that was stripped, if any. */
  strippedRootDir: string | null;
  totalBytes: number;
  /** Files planned for extraction, as counted against `maxEntries`. */
  entryCount: number;
}

export interface ExtractZipOptions {
  limits?: Partial<ZipExtractionLimits>;
  /**
   * Stops between entries or during an entry's write; the caller removes
   * whatever was written.
   */
  signal?: AbortSignal;
}

const IGNORED_SEGMENTS = new Set([
  "__MACOSX",
  "node_modules",
  ".git",
  ".DS_Store",
  "Thumbs.db",
]);
const MAX_SEGMENT_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;
// On Windows these open devices (CON, NUL, COM1, CONIN$...) or alternate data
// streams (name:stream) instead of files, and trailing dots or spaces are
// stripped. COM and LPT also take the superscript digits ¹, ² and ³.
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
// Characters Windows does not allow in file names.
const WINDOWS_INVALID_CHARACTERS = /[:<>"|?*]/;

function isUnsafeSegment(segment: string): boolean {
  return (
    segment === ".." ||
    segment.length > MAX_SEGMENT_LENGTH ||
    WINDOWS_INVALID_CHARACTERS.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    WINDOWS_RESERVED_NAME.test(segment)
  );
}

/**
 * Normalize an archive entry name into safe path segments, or return null
 * when the name must not be materialized.
 */
export function toSafeZipSegments(
  name: string,
  maxPathDepth: number,
): string[] | null {
  if (CONTROL_CHARACTERS.test(name)) {
    return null;
  }
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || WINDOWS_DRIVE_PREFIX.test(normalized)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (isUnsafeSegment(segment)) {
      return null;
    }
    segments.push(segment);
  }
  if (segments.length === 0 || segments.length > maxPathDepth) {
    return null;
  }
  return segments;
}

function isIgnoredPath(segments: string[]): boolean {
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

interface PlannedEntry {
  entry: ZipEntry;
  segments: string[];
}

function stripCommonRoot(planned: PlannedEntry[]): string | null {
  if (planned.length === 0) {
    return null;
  }
  const root = planned[0].segments[0];
  const allShareRoot = planned.every(
    ({ segments }) => segments.length >= 2 && segments[0] === root,
  );
  if (!allShareRoot) {
    return null;
  }
  for (const item of planned) {
    item.segments = item.segments.slice(1);
  }
  return root;
}

const UNWRITABLE_ERROR_CODES = new Set([
  "EEXIST",
  "ENOTDIR",
  "EISDIR",
  "EINVAL",
  "ENAMETOOLONG",
]);

function isUnwritableEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && UNWRITABLE_ERROR_CODES.has(code);
}

function assertWithinRoot(destinationRoot: string, filePath: string): void {
  const relative = path.relative(destinationRoot, filePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ZipFormatError(`entry resolves outside the extraction root`);
  }
}

/**
 * Extract an in-memory archive into `destinationDir`, which must already be
 * an empty directory owned by the caller. Throws `ZipFormatError` when the
 * archive is unreadable and `ZipLimitError` when it exceeds the limits;
 * per-entry problems are reported in `skipped` instead.
 */
export async function extractZipArchive(
  archive: Buffer,
  destinationDir: string,
  options: ExtractZipOptions = {},
): Promise<ZipExtractionResult> {
  const limits = { ...DEFAULT_ZIP_EXTRACTION_LIMITS, ...options.limits };
  let entries;
  try {
    entries = readZipDirectory(archive, {
      maxEntries: limits.maxDirectoryEntries,
    });
  } catch (error) {
    if (error instanceof ZipLimitError) {
      throw new ZipLimitError(
        `${error.message}, counting folders and skipped entries such as node_modules and .git`,
        "directory",
      );
    }
    throw error;
  }

  const skipped: SkippedZipEntry[] = [];
  const planned: PlannedEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    const segments = toSafeZipSegments(entry.name, limits.maxPathDepth);
    if (!segments) {
      skipped.push({ name: entry.name, reason: "unsafe-path" });
      continue;
    }
    if (isIgnoredPath(segments)) {
      skipped.push({ name: entry.name, reason: "ignored" });
      continue;
    }
    if (entry.isSymlink) {
      skipped.push({ name: entry.name, reason: "symlink" });
      continue;
    }
    if (entry.isEncrypted) {
      skipped.push({ name: entry.name, reason: "encrypted" });
      continue;
    }
    if (!isSupportedZipCompression(entry)) {
      skipped.push({ name: entry.name, reason: "unsupported-compression" });
      continue;
    }
    planned.push({ entry, segments });
  }

  if (planned.length > limits.maxEntries) {
    throw new ZipLimitError(
      `archive holds ${planned.length} files to extract, more than the ${limits.maxEntries} allowed`,
      "entries",
    );
  }

  const declaredTotal = planned.reduce(
    (sum, { entry }) => sum + entry.uncompressedSize,
    0,
  );
  if (declaredTotal > limits.maxTotalUncompressedBytes) {
    throw new ZipLimitError(
      `archive would expand to ${declaredTotal} bytes, more than the ${limits.maxTotalUncompressedBytes} allowed`,
      "bytes",
    );
  }

  const strippedRootDir = stripCommonRoot(planned);
  const destinationRoot = path.resolve(destinationDir);
  const files: ExtractedZipFile[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const { entry, segments } of planned) {
    options.signal?.throwIfAborted();
    const relativePath = segments.join("/");
    const filePath = path.resolve(destinationRoot, ...segments);
    assertWithinRoot(destinationRoot, filePath);

    const data = await readZipEntryData(archive, entry);
    // Inflating one large entry can take a while, so check again before
    // writing it.
    options.signal?.throwIfAborted();
    totalBytes += data.length;
    if (totalBytes > limits.maxTotalUncompressedBytes) {
      throw new ZipLimitError(
        `archive expanded past the ${limits.maxTotalUncompressedBytes} bytes allowed`,
        "bytes",
      );
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // A new path is created exclusively, so on a case-insensitive host
      // README.md and readme.md cannot both land on one file. A repeat of
      // the same path overwrites it.
      await fs.writeFile(filePath, data, {
        flag: seenPaths.has(relativePath) ? "w" : "wx",
        signal: options.signal,
      });
      // Keep scripts such as gradlew runnable once copied into the app. An
      // overwrite keeps the old mode, so a repeated path gets the winning
      // entry's. Best effort: some filesystems reject mode changes.
      if (entry.isExecutable || seenPaths.has(relativePath)) {
        await fs
          .chmod(filePath, entry.isExecutable ? 0o755 : 0o644)
          .catch(() => undefined);
      }
    } catch (error) {
      // Names that are valid inside an archive can still be unwritable on
      // the host: a file and a directory sharing a path, two names the
      // filesystem treats as one, or a path that is too long once resolved.
      if (isUnwritableEntryError(error)) {
        skipped.push({ name: entry.name, reason: "unwritable" });
        continue;
      }
      throw error;
    }

    // A later duplicate entry overwrites the earlier one on disk; report the
    // path once with the size that ended up there.
    const existingIndex = seenPaths.has(relativePath)
      ? files.findIndex((file) => file.relativePath === relativePath)
      : -1;
    if (existingIndex >= 0) {
      files[existingIndex] = { relativePath, sizeBytes: data.length };
    } else {
      seenPaths.add(relativePath);
      files.push({ relativePath, sizeBytes: data.length });
    }
  }

  return {
    files,
    skipped,
    strippedRootDir,
    totalBytes,
    entryCount: planned.length,
  };
}
