/**
 * Unified Content-Addressed Storage
 *
 * Merges the storage patterns from data_scraping_handlers.ts and
 * dataset_studio_handlers.ts.  Every blob is SHA-256 hashed, stored in a
 * two-character prefix-sharded directory, and tracked in the `contentBlobs`
 * table for ref-count based garbage collection.
 */

import { app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import type { StoredContent } from "./types";

const logger = log.scope("scraping:storage");

// ── Paths ───────────────────────────────────────────────────────────────────

let _storeDir: string | null = null;

function storeDir(): string {
  if (!_storeDir) {
    _storeDir = path.join(app.getPath("userData"), "content-store");
  }
  return _storeDir;
}

let _mediaDir: string | null = null;

function mediaDir(): string {
  if (!_mediaDir) {
    _mediaDir = path.join(app.getPath("userData"), "scraping-media");
  }
  return _mediaDir;
}

let _thumbDir: string | null = null;

function thumbDir(): string {
  if (!_thumbDir) {
    _thumbDir = path.join(app.getPath("userData"), "scraping-thumbnails");
  }
  return _thumbDir;
}

let _jobsDir: string | null = null;

function jobsDir(): string {
  if (!_jobsDir) {
    _jobsDir = path.join(app.getPath("userData"), "scraping-jobs");
  }
  return _jobsDir;
}

// ── Initialisation ──────────────────────────────────────────────────────────

export async function initStorage(): Promise<void> {
  await Promise.all([
    fs.ensureDir(storeDir()),
    fs.ensureDir(mediaDir()),
    fs.ensureDir(thumbDir()),
    fs.ensureDir(jobsDir()),
  ]);
  logger.info("Storage directories initialised");
}

// ── Content-addressed text storage ──────────────────────────────────────────

export function computeHash(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Store arbitrary content (text or binary) and return its content-addressed
 * metadata.  Skips write if the blob already exists (dedup by hash).
 */
export async function storeContent(
  data: Buffer,
  mimeType: string,
): Promise<StoredContent> {
  const hash = computeHash(data);
  const prefix = hash.substring(0, 2);
  const dir = path.join(storeDir(), prefix);
  await fs.ensureDir(dir);

  const filePath = path.join(dir, hash);
  if (!(await fs.pathExists(filePath))) {
    await fs.writeFile(filePath, data);
  }

  return {
    hash,
    size: data.length,
    storagePath: filePath,
    mimeType,
    contentUri: `content://${hash}`,
  };
}

/**
 * Convenience wrapper for storing a UTF-8 string.
 */
export async function storeText(
  text: string,
  mimeType = "text/plain",
): Promise<StoredContent> {
  return storeContent(Buffer.from(text, "utf-8"), mimeType);
}

// ── Media file storage ──────────────────────────────────────────────────────

/**
 * Download a remote media URL and store the binary in content-addressed
 * storage.  Returns `null` if the download fails or the file exceeds
 * `maxBytes`.
 */
export async function downloadAndStoreMedia(
  url: string,
  maxBytes = 50 * 1024 * 1024, // 50 MB
): Promise<StoredContent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JoyCreate-Scraper/2.0",
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      logger.warn(`Media download failed (${res.status}): ${url}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const contentLength = Number(res.headers.get("content-length") || 0);

    if (contentLength > maxBytes) {
      logger.warn(`Media too large (${contentLength} bytes): ${url}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > maxBytes) {
      logger.warn(`Media too large after download (${buffer.length} bytes): ${url}`);
      return null;
    }

    const stored = await storeContent(buffer, contentType);

    // Also save with a human-readable extension in the media dir for
    // convenience (hard-linked to content-store blob).
    const ext = guessExtension(contentType, url);
    const mediaPath = path.join(mediaDir(), `${stored.hash}${ext}`);
    if (!(await fs.pathExists(mediaPath))) {
      try {
        await fs.link(stored.storagePath, mediaPath);
      } catch {
        // hard-link may fail on some FS; fall back to copy
        await fs.copyFile(stored.storagePath, mediaPath);
      }
    }

    return { ...stored, storagePath: mediaPath };
  } catch (err) {
    logger.warn(`Media download error for ${url}: ${(err as Error).message}`);
    return null;
  }
}

// ── Retrieval ───────────────────────────────────────────────────────────────

/**
 * Read previously stored content by its hash.  Returns `null` if not found.
 */
export async function readContent(hash: string): Promise<Buffer | null> {
  const prefix = hash.substring(0, 2);
  const filePath = path.join(storeDir(), prefix, hash);
  if (await fs.pathExists(filePath)) {
    return fs.readFile(filePath);
  }
  return null;
}

// ── Job persistence ─────────────────────────────────────────────────────────

const JOBS_FILE = "jobs.json";

export async function loadJobs<T>(): Promise<Map<string, T>> {
  const fp = path.join(jobsDir(), JOBS_FILE);
  if (await fs.pathExists(fp)) {
    const data = await fs.readJson(fp);
    return new Map(Object.entries(data));
  }
  return new Map();
}

export async function saveJobs<T>(jobs: Map<string, T>): Promise<void> {
  const fp = path.join(jobsDir(), JOBS_FILE);
  await fs.writeJson(fp, Object.fromEntries(jobs), { spaces: 2 });
}

// ── Utils ───────────────────────────────────────────────────────────────────

function guessExtension(mimeType: string, url: string): string {
  const typeMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/markdown": ".md",
  };
  if (typeMap[mimeType]) return typeMap[mimeType];

  // Fall back to URL extension
  try {
    const ext = path.extname(new URL(url).pathname);
    if (ext && ext.length <= 6) return ext;
  } catch {
    // ignore
  }
  return ".bin";
}
