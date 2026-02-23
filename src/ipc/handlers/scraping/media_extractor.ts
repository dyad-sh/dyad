/**
 * Media Extractor — Downloads and stores images, audio, and video
 *
 * Handles:
 *  - Image downloading with metadata extraction
 *  - Audio/video URL resolution and downloading
 *  - Thumbnail generation (placeholder — can be extended with sharp/canvas)
 *  - Content-addressed storage via storage.ts
 */

import log from "electron-log";
import type { ScrapedMedia, ScrapedPage, ScrapingConfig, ContentModality } from "./types";
import { downloadAndStoreMedia, storeText } from "./storage";
import type { StoredContent } from "./types";

const logger = log.scope("scraping:media");

// ── Types ───────────────────────────────────────────────────────────────────

export interface MediaDownloadResult {
  media: ScrapedMedia;
  stored: StoredContent;
  modality: ContentModality;
}

export interface MediaExtractionSummary {
  images: MediaDownloadResult[];
  audio: MediaDownloadResult[];
  video: MediaDownloadResult[];
  totalBytes: number;
  failedDownloads: number;
}

// ── Configuration ───────────────────────────────────────────────────────────

interface MediaConfig {
  maxImageBytes: number;
  maxAudioBytes: number;
  maxVideoBytes: number;
  maxImagesPerPage: number;
  maxMediaPerPage: number;
  downloadImages: boolean;
  downloadAudio: boolean;
  downloadVideo: boolean;
  concurrency: number;
}

function resolveMediaConfig(config: ScrapingConfig): MediaConfig {
  return {
    maxImageBytes: 10 * 1024 * 1024,      // 10 MB per image
    maxAudioBytes: 100 * 1024 * 1024,      // 100 MB per audio
    maxVideoBytes: 500 * 1024 * 1024,      // 500 MB per video
    maxImagesPerPage: 50,
    maxMediaPerPage: 20,
    downloadImages: config.output?.extractImages !== false,
    downloadAudio: config.output?.extractMedia === true,
    downloadVideo: config.output?.extractMedia === true,
    concurrency: 3,
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function extractAndStoreMedia(
  page: ScrapedPage,
  config: ScrapingConfig,
): Promise<MediaExtractionSummary> {
  const mc = resolveMediaConfig(config);
  const results: MediaExtractionSummary = {
    images: [],
    audio: [],
    video: [],
    totalBytes: 0,
    failedDownloads: 0,
  };

  // Download images
  if (mc.downloadImages && page.images.length) {
    const imagesToProcess = page.images.slice(0, mc.maxImagesPerPage);
    const imageResults = await downloadBatch(imagesToProcess, mc.maxImageBytes, mc.concurrency);
    for (const r of imageResults) {
      if (r) {
        results.images.push({ ...r, modality: "image" });
        results.totalBytes += r.stored.size;
      } else {
        results.failedDownloads++;
      }
    }
  }

  // Download audio
  if (mc.downloadAudio && page.audio.length) {
    const audioToProcess = page.audio.slice(0, mc.maxMediaPerPage);
    const audioResults = await downloadBatch(audioToProcess, mc.maxAudioBytes, mc.concurrency);
    for (const r of audioResults) {
      if (r) {
        results.audio.push({ ...r, modality: "audio" });
        results.totalBytes += r.stored.size;
      } else {
        results.failedDownloads++;
      }
    }
  }

  // Download video
  if (mc.downloadVideo && page.video.length) {
    const videoToProcess = page.video.slice(0, mc.maxMediaPerPage);
    // Skip embed URLs (YouTube, etc.) — can't download directly
    const downloadable = videoToProcess.filter(
      (v) => v.mimeType !== "video/embed",
    );
    const videoResults = await downloadBatch(downloadable, mc.maxVideoBytes, mc.concurrency);
    for (const r of videoResults) {
      if (r) {
        results.video.push({ ...r, modality: "video" });
        results.totalBytes += r.stored.size;
      } else {
        results.failedDownloads++;
      }
    }

    // Store embed URLs as text references
    const embeds = videoToProcess.filter((v) => v.mimeType === "video/embed");
    for (const embed of embeds) {
      const stored = await storeText(
        JSON.stringify({ embedUrl: embed.url, type: "video-embed" }),
        "application/json",
      );
      results.video.push({
        media: { ...embed, contentHash: stored.hash },
        stored,
        modality: "video",
      });
    }
  }

  logger.info(
    `Media extraction: ${results.images.length} images, ` +
    `${results.audio.length} audio, ${results.video.length} video, ` +
    `${results.failedDownloads} failed, ${(results.totalBytes / 1024).toFixed(0)} KB`,
  );

  return results;
}

// ── Batch downloader with concurrency control ───────────────────────────────

async function downloadBatch(
  items: ScrapedMedia[],
  maxBytes: number,
  concurrency: number,
): Promise<(Omit<MediaDownloadResult, "modality"> | null)[]> {
  const results: (Omit<MediaDownloadResult, "modality"> | null)[] = [];
  const queue = [...items];

  async function worker(): Promise<void> {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        const stored = await downloadAndStoreMedia(item.url, maxBytes);
        if (stored) {
          const enrichedMedia: ScrapedMedia = {
            ...item,
            contentHash: stored.hash,
            byteSize: stored.size,
            mimeType: stored.mimeType || item.mimeType,
            localPath: stored.storagePath,
          };
          results.push({ media: enrichedMedia, stored });
        } else {
          results.push(null);
        }
      } catch (err) {
        logger.warn(`Failed to download ${item.url}: ${(err as Error).message}`);
        results.push(null);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ── Utility: guess modality from MIME type or URL ───────────────────────────

export function guessModality(mimeType?: string, url?: string): ContentModality {
  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType === "video/embed") return "video";
  }
  if (url) {
    const ext = url.split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp"].includes(ext)) return "image";
    if (["mp3", "ogg", "wav", "flac", "aac", "wma", "m4a"].includes(ext)) return "audio";
    if (["mp4", "webm", "ogv", "avi", "mov", "mkv", "m4v"].includes(ext)) return "video";
  }
  return "text";
}
