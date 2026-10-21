import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { withLock } from "../lock_utils";
import type {
  AttachmentManifestEntry,
  AttachmentManifestEntryInput,
} from "../media_path_utils";
import { getMimeType } from "../mime_utils";
import {
  extractZipArchive,
  ZipLimitError,
  type ExtractedZipFile,
  type ZipExtractionLimits,
  type ZipSkipReason,
} from "./zip_extract";
import { ZipFormatError } from "./zip_reader";

/**
 * Glue between the archive extractor and chat attachments.
 *
 * A dropped `.zip` is stored like any other attachment, then unpacked into a
 * sibling directory named after the stored file's hash. Each extracted file
 * is registered in the attachment manifest as `<archive>/<path>`, so the
 * existing `attachments:` resolution used by read_file, copy_file and the
 * sandbox host functions reaches it without any further plumbing.
 */

export const ZIP_ATTACHMENT_MIME_TYPE = "application/zip";

// Windows refuses to rename a directory while any file inside it is open,
// which antivirus and the indexer often do briefly after files are written.
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400];

const FILE_CHECK_BATCH_SIZE = 32;

/** Whether `dir` is a real directory that holds every one of `files`. */
async function holdsExtractedFiles(
  dir: string,
  files: readonly ExtractedZipFile[],
): Promise<boolean> {
  const isFile = async (target: string) => {
    try {
      return (await fs.lstat(target)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  };
  try {
    if (!(await fs.lstat(dir)).isDirectory()) {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  for (let start = 0; start < files.length; start += FILE_CHECK_BATCH_SIZE) {
    const present = await Promise.all(
      files
        .slice(start, start + FILE_CHECK_BATCH_SIZE)
        .map((file) => isFile(path.join(dir, ...file.relativePath.split("/")))),
    );
    if (present.includes(false)) {
      return false;
    }
  }
  return true;
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= RENAME_RETRY_DELAYS_MS.length ||
        !code ||
        !TRANSIENT_RENAME_ERRORS.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]),
      );
    }
  }
}

export interface ExtractedArchiveSummary {
  /** Directory under the media directory that holds the extracted files. */
  extractedDirName: string;
  /**
   * Extracted files. `relativePath` is the on-disk path until
   * `withFinalizedEntryNames` replaces it with the manifest's logical path.
   */
  files: ExtractedZipFile[];
  skipped: Partial<Record<ZipSkipReason, number>>;
  strippedRootDir: string | null;
  totalBytes: number;
  /** Files planned for extraction, as counted against the entry cap. */
  entryCount: number;
}

// Stored files are named `<hash>` or `<hash>.<ext>`, so a dash right after
// the hash keeps extraction directories from ever sharing a stored file's name.
export function extractedDirNameForStoredFile(storedFileName: string): string {
  const hash = storedFileName.slice(
    0,
    storedFileName.length - path.extname(storedFileName).length,
  );
  return `${hash}-unpacked`;
}

/**
 * Unpack an archive attachment next to its stored file. The result depends
 * only on the archive bytes, so a re-upload from any chat produces the same
 * directory. Extraction runs in a staging directory that is moved into place
 * only on success. If an earlier upload already put the directory in place,
 * that one is kept, so other chats reading it are never disturbed. The target
 * is locked so two chats uploading the same archive at once cannot interleave.
 * Throws `ZipFormatError` or `ZipLimitError`.
 */
export async function extractZipAttachment({
  mediaDir,
  storedFileName,
  archive,
  limits,
  signal,
}: {
  mediaDir: string;
  storedFileName: string;
  archive: Buffer;
  limits?: Partial<ZipExtractionLimits>;
  /**
   * Abandons the extraction between entries, during an entry's write, or
   * before it is moved into place.
   */
  signal?: AbortSignal;
}): Promise<ExtractedArchiveSummary> {
  const extractedDirName = extractedDirNameForStoredFile(storedFileName);
  const destinationDir = path.join(mediaDir, extractedDirName);
  return withLock(`archive-extract:${destinationDir}`, async () => {
    const token = crypto.randomUUID();
    const stagingDir = `${destinationDir}.extracting-${token}`;
    await fs.mkdir(stagingDir, { recursive: true });
    let result;
    try {
      result = await extractZipArchive(archive, stagingDir, { limits, signal });
      signal?.throwIfAborted();
    } catch (error) {
      await fs
        .rm(stagingDir, { recursive: true, force: true })
        .catch(() => undefined);
      throw error;
    }

    try {
      // Only a finished extraction of these same bytes is ever moved to this
      // name, so an existing directory normally holds the same files. Keep it
      // so chats reading it are never disturbed, and refresh its time so
      // cleanup ages it out with the re-uploaded zip. Replace it only when
      // files are missing from it.
      if (await holdsExtractedFiles(destinationDir, result.files)) {
        await fs.rm(stagingDir, { recursive: true, force: true });
        const now = new Date();
        await fs.utimes(destinationDir, now, now);
      } else {
        // Move a damaged directory aside rather than deleting it, so a failed
        // install can put it back for chats still reading its files. A real
        // directory's time is refreshed first so cleanup doesn't take it as
        // expired meanwhile; a symlink is skipped, as utimes would follow it.
        const retiredDir = `${destinationDir}.old-${token}`;
        let retired = false;
        try {
          const destinationStat = await fs
            .lstat(destinationDir)
            .catch(() => null);
          if (destinationStat?.isDirectory()) {
            const now = new Date();
            await fs.utimes(destinationDir, now, now).catch(() => undefined);
          }
          await renameWithRetry(destinationDir, retiredDir);
          retired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
        try {
          await renameWithRetry(stagingDir, destinationDir);
        } catch (error) {
          if (retired) {
            await renameWithRetry(retiredDir, destinationDir).catch(
              () => undefined,
            );
          }
          throw error;
        }
        if (retired) {
          await fs
            .rm(retiredDir, {
              recursive: true,
              force: true,
              maxRetries: RENAME_RETRY_DELAYS_MS.length,
            })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      await fs
        .rm(stagingDir, { recursive: true, force: true })
        .catch(() => undefined);
      throw error;
    }

    const skipped: Partial<Record<ZipSkipReason, number>> = {};
    for (const entry of result.skipped) {
      skipped[entry.reason] = (skipped[entry.reason] ?? 0) + 1;
    }
    return {
      extractedDirName,
      files: result.files,
      skipped,
      strippedRootDir: result.strippedRootDir,
      totalBytes: result.totalBytes,
      entryCount: result.entryCount,
    };
  });
}

/**
 * Replace each file's path with the logical path the manifest actually
 * registered (sanitized, truncated, or suffixed on collision), relative to
 * the archive, so the prompt advertises names that resolve. `finalized` must
 * be the entries returned for `buildArchiveManifestEntries` of this summary,
 * in the same order.
 */
export function withFinalizedEntryNames(
  summary: ExtractedArchiveSummary,
  archiveLogicalName: string,
  finalized: readonly AttachmentManifestEntry[],
): ExtractedArchiveSummary {
  const prefix = `${archiveLogicalName}/`;
  return {
    ...summary,
    files: summary.files.map((file, index) => {
      const logicalName = finalized[index]?.logicalName;
      if (!logicalName) {
        return file;
      }
      return {
        ...file,
        relativePath: logicalName.startsWith(prefix)
          ? logicalName.slice(prefix.length)
          : logicalName,
      };
    }),
  };
}

export function isZipExtractionError(error: unknown): boolean {
  return error instanceof ZipFormatError || error instanceof ZipLimitError;
}

export function toZipExtractionErrorMessage(
  attachmentName: string,
  error: unknown,
  options: {
    /**
     * The byte limit the extraction ran with was what remained of a budget
     * shared by every archive in the message, not the full per-archive cap.
     */
    sharedBudgetBytes?: number;
    /** Same, for the entry count. */
    sharedBudgetEntries?: number;
  } = {},
): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ZipLimitError) {
    if (error.limit === "bytes" && options.sharedBudgetBytes !== undefined) {
      return `"${attachmentName}" cannot be unpacked: together, the archives in this message would expand past the ${Math.round(options.sharedBudgetBytes / (1024 * 1024))} MiB they can share.`;
    }
    if (
      error.limit === "entries" &&
      options.sharedBudgetEntries !== undefined
    ) {
      return `"${attachmentName}" cannot be unpacked: together, the archives in this message hold more than the ${options.sharedBudgetEntries} entries they can share.`;
    }
    return `"${attachmentName}" is too large to extract: ${detail}.`;
  }
  return `"${attachmentName}" is not a readable zip archive: ${detail}.`;
}

const TEXT_MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
};

export function guessArchiveEntryMimeType(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  return TEXT_MIME_TYPES[ext] ?? getMimeType(ext);
}

/**
 * Manifest inputs for every extracted file, named under the archive's final
 * logical name so `attachments:<archive>/<path>` resolves to the file.
 */
export function buildArchiveManifestEntries(
  archiveLogicalName: string,
  summary: ExtractedArchiveSummary,
  createdAt: string,
): AttachmentManifestEntryInput[] {
  return summary.files.map((file) => ({
    requestedLogicalName: `${archiveLogicalName}/${file.relativePath}`,
    nestedLogicalName: true,
    originalName: file.relativePath,
    storedFileName: `${summary.extractedDirName}/${file.relativePath}`,
    mimeType: guessArchiveEntryMimeType(file.relativePath),
    sizeBytes: file.sizeBytes,
    createdAt,
    archiveLogicalName,
  }));
}

const SKIP_REASON_LABELS: Record<ZipSkipReason, string> = {
  encrypted: "encrypted",
  "unsupported-compression": "unsupported compression",
  "unsafe-path": "unsafe path",
  symlink: "symlink",
  ignored: "packaging noise such as node_modules or __MACOSX",
  unwritable: "not writable on this filesystem",
};

export function describeSkippedArchiveEntries(
  skipped: ExtractedArchiveSummary["skipped"],
): string | null {
  const reasons = (Object.keys(SKIP_REASON_LABELS) as ZipSkipReason[]).filter(
    (reason) => (skipped[reason] ?? 0) > 0,
  );
  if (reasons.length === 0) {
    return null;
  }
  const total = reasons.reduce(
    (sum, reason) => sum + (skipped[reason] ?? 0),
    0,
  );
  const parts = reasons.map(
    (reason) => `${skipped[reason]} ${SKIP_REASON_LABELS[reason]}`,
  );
  return `${total} ${total === 1 ? "entry" : "entries"} skipped (${parts.join(", ")})`;
}
