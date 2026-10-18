import fs from "node:fs/promises";
import path from "node:path";

import { isDotenvFilePath } from "@/utils/dotenv_redaction";
import type { AttachmentManifestEntryInput } from "../media_path_utils";
import { getMimeType } from "../mime_utils";
import {
  extractZipArchive,
  ZipLimitError,
  type ExtractedZipFile,
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

export function isZipAttachmentName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".zip");
}

export interface ExtractedArchiveSummary {
  /** Directory under the media directory that holds the extracted files. */
  extractedDirName: string;
  files: ExtractedZipFile[];
  skipped: Partial<Record<ZipSkipReason, number>>;
  strippedRootDir: string | null;
  totalBytes: number;
}

export function extractedDirNameForStoredFile(storedFileName: string): string {
  return storedFileName.slice(
    0,
    storedFileName.length - path.extname(storedFileName).length,
  );
}

/**
 * Unpack an archive attachment next to its stored file. The target directory
 * is recreated from scratch so a re-upload of the same archive never leaves
 * stale entries behind. Throws `ZipFormatError` or `ZipLimitError`; the
 * directory is removed again on any failure.
 */
export async function extractZipAttachment({
  mediaDir,
  storedFileName,
  archive,
  excludeDotenvFiles,
}: {
  mediaDir: string;
  storedFileName: string;
  archive: Buffer;
  excludeDotenvFiles: boolean;
}): Promise<ExtractedArchiveSummary> {
  const extractedDirName = extractedDirNameForStoredFile(storedFileName);
  const destinationDir = path.join(mediaDir, extractedDirName);
  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.mkdir(destinationDir, { recursive: true });
  try {
    const result = await extractZipArchive(archive, destinationDir, {
      exclude: excludeDotenvFiles ? isDotenvFilePath : undefined,
    });
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
    };
  } catch (error) {
    await fs
      .rm(destinationDir, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

export function isZipExtractionError(error: unknown): boolean {
  return error instanceof ZipFormatError || error instanceof ZipLimitError;
}

export function toZipExtractionErrorMessage(
  attachmentName: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ZipLimitError) {
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
  excluded: "dotenv file",
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
