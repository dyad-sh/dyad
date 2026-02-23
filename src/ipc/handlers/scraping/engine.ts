/**
 * Scraping Engine Orchestrator
 *
 * Coordinates the full pipeline:
 *   1. Job creation & management (queue, pause, resume, cancel)
 *   2. URL resolution (single, crawl, sitemap, RSS)
 *   3. Rate limiting & concurrency control
 *   4. Per-URL pipeline: fetch → extract → media → AI → tag → store
 *   5. Dataset item creation in SQLite
 *   6. Progress events via IPC
 */

import { app } from "electron";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import {
  datasetItems,
  studioDatasets,
  provenanceRecords,
  type ItemLineage,
} from "@/db/schema";
import type {
  ScrapingConfig,
  ScrapingJob,
  ScrapedPage,
  ScrapingError,
  JobProgress,
  JobStats,
  TaggingResult,
  ScrapePreviewResult,
  ContentModality,
} from "./types";
import { fetchPage, isAllowedByRobots } from "./fetcher";
import { extractPage, parseFeed, parseSitemap } from "./extractor";
import { extractAndStoreMedia, guessModality } from "./media_extractor";
import { aiExtract } from "./ai_extractor";
import { tagContent } from "./tagger";
import { storeText, initStorage, saveJobs, loadJobs } from "./storage";

const logger = log.scope("scraping:engine");

// ── State ───────────────────────────────────────────────────────────────────

const activeJobs = new Map<string, ScrapingJob>();
const jobAbortControllers = new Map<string, AbortController>();

// Progress callback — set by the IPC handler to emit events to the renderer
let _progressCallback: ((jobId: string, job: ScrapingJob) => void) | null = null;

export function setProgressCallback(cb: (jobId: string, job: ScrapingJob) => void): void {
  _progressCallback = cb;
}

function emitProgress(jobId: string): void {
  const job = activeJobs.get(jobId);
  if (job && _progressCallback) {
    _progressCallback(jobId, { ...job });
  }
}

// ── Initialisation ──────────────────────────────────────────────────────────

export async function initEngine(): Promise<void> {
  await initStorage();

  // Restore persisted jobs (mark any that were "running" as "paused")
  const saved = await loadJobs<ScrapingJob>();
  for (const [id, job] of saved) {
    if (job.status === "running") {
      job.status = "paused";
    }
    activeJobs.set(id, job);
  }

  logger.info(`Scraping engine initialised, ${activeJobs.size} persisted jobs loaded`);
}

// ── Job CRUD ────────────────────────────────────────────────────────────────

export function createJob(
  name: string,
  config: ScrapingConfig,
  datasetId?: string,
  templateId?: string,
): ScrapingJob {
  const job: ScrapingJob = {
    id: uuidv4(),
    name,
    datasetId,
    templateId,
    status: "pending",
    config,
    progress: { total: 0, completed: 0, failed: 0, skipped: 0 },
    errors: [],
    stats: {
      pagesScraped: 0,
      itemsExtracted: 0,
      bytesDownloaded: 0,
      mediaDownloaded: 0,
      durationMs: 0,
      averagePageTimeMs: 0,
    },
  };

  activeJobs.set(job.id, job);
  persistJobs();
  return job;
}

export function getJob(id: string): ScrapingJob | undefined {
  return activeJobs.get(id);
}

export function listJobs(): ScrapingJob[] {
  return [...activeJobs.values()].sort(
    (a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );
}

export function cancelJob(id: string): boolean {
  const job = activeJobs.get(id);
  if (!job) return false;
  job.status = "cancelled";
  job.completedAt = new Date().toISOString();
  jobAbortControllers.get(id)?.abort();
  jobAbortControllers.delete(id);
  persistJobs();
  emitProgress(id);
  return true;
}

export function pauseJob(id: string): boolean {
  const job = activeJobs.get(id);
  if (!job || job.status !== "running") return false;
  job.status = "paused";
  jobAbortControllers.get(id)?.abort();
  jobAbortControllers.delete(id);
  persistJobs();
  emitProgress(id);
  return true;
}

export function deleteJob(id: string): boolean {
  cancelJob(id);
  activeJobs.delete(id);
  persistJobs();
  return true;
}

// ── Run a job ───────────────────────────────────────────────────────────────

export async function startJob(jobId: string): Promise<ScrapingJob> {
  const job = activeJobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "running") throw new Error(`Job ${jobId} is already running`);

  job.status = "running";
  job.startedAt = new Date().toISOString();

  const abortController = new AbortController();
  jobAbortControllers.set(jobId, abortController);
  persistJobs();
  emitProgress(jobId);

  try {
    // Ensure dataset exists
    if (!job.datasetId) {
      job.datasetId = await ensureDataset(job.name);
    }

    // Resolve URLs to scrape
    const urls = await resolveUrls(job.config, abortController.signal);
    job.progress.total = urls.length;
    emitProgress(jobId);

    // Process each URL
    const delayMs = job.config.rateLimit?.delayBetweenRequests ?? 1000;

    for (const url of urls) {
      if (abortController.signal.aborted) break;

      job.progress.currentUrl = url;
      emitProgress(jobId);

      try {
        // Check robots.txt
        const allowed = await isAllowedByRobots(url);
        if (!allowed) {
          job.progress.skipped++;
          logger.info(`Skipped (robots.txt): ${url}`);
          continue;
        }

        // Full per-URL pipeline
        await processUrl(url, job, abortController.signal);
        job.progress.completed++;
      } catch (err) {
        job.progress.failed++;
        const error: ScrapingError = {
          url,
          message: (err as Error).message,
          timestamp: new Date().toISOString(),
          retryable: isRetryable(err as Error),
        };
        job.errors.push(error);
        logger.warn(`Failed to scrape ${url}: ${error.message}`);
      }

      emitProgress(jobId);

      // Rate limiting
      if (!abortController.signal.aborted && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    job.status = abortController.signal.aborted ? "cancelled" : "completed";
  } catch (err) {
    job.status = "failed";
    job.errors.push({
      url: "engine",
      message: (err as Error).message,
      timestamp: new Date().toISOString(),
      retryable: false,
    });
    logger.error(`Job ${jobId} failed: ${(err as Error).message}`);
  }

  job.completedAt = new Date().toISOString();
  job.stats.durationMs = Date.now() - new Date(job.startedAt!).getTime();
  if (job.stats.pagesScraped > 0) {
    job.stats.averagePageTimeMs = Math.round(
      job.stats.durationMs / job.stats.pagesScraped,
    );
  }

  jobAbortControllers.delete(jobId);
  persistJobs();
  emitProgress(jobId);

  return job;
}

// ── Per-URL pipeline ────────────────────────────────────────────────────────

async function processUrl(
  url: string,
  job: ScrapingJob,
  _signal: AbortSignal,
): Promise<void> {
  const config = job.config;

  // 1. Fetch
  const fetchResult = await fetchPage({ url, config });
  job.stats.pagesScraped++;

  // 2. Extract content
  const page = extractPage(fetchResult, config);

  // 3. AI extraction (if enabled)
  let aiData: Record<string, unknown> = {};
  if (config.aiExtraction?.enabled) {
    const aiResult = await aiExtract(page.content, config);
    if (aiResult.success) {
      aiData = aiResult.data;
    }
  }

  // 4. Download media
  const mediaResults = await extractAndStoreMedia(page, config);
  job.stats.mediaDownloaded += mediaResults.images.length + mediaResults.audio.length + mediaResults.video.length;
  job.stats.bytesDownloaded += mediaResults.totalBytes;

  // 5. Auto-tag
  const tags = await tagContent(page, config);

  // 6. Store content + create dataset item
  const stored = await storeText(page.content, "text/markdown");
  job.stats.bytesDownloaded += stored.size;

  // Create the main text item
  await insertDatasetItem({
    datasetId: job.datasetId!,
    modality: "text",
    content: stored,
    sourceUrl: url,
    tags,
    title: page.title,
    fields: { ...page.fields, ...aiData },
    tables: page.tables,
    structuredData: page.structuredData,
  });
  job.stats.itemsExtracted++;

  // Create items for downloaded media
  for (const img of mediaResults.images) {
    await insertDatasetItem({
      datasetId: job.datasetId!,
      modality: "image",
      content: img.stored,
      sourceUrl: img.media.url,
      tags,
      title: img.media.alt || img.media.title,
    });
    job.stats.itemsExtracted++;
  }

  for (const aud of mediaResults.audio) {
    await insertDatasetItem({
      datasetId: job.datasetId!,
      modality: "audio",
      content: aud.stored,
      sourceUrl: aud.media.url,
      tags,
    });
    job.stats.itemsExtracted++;
  }

  for (const vid of mediaResults.video) {
    await insertDatasetItem({
      datasetId: job.datasetId!,
      modality: "video",
      content: vid.stored,
      sourceUrl: vid.media.url,
      tags,
    });
    job.stats.itemsExtracted++;
  }
}

// ── URL resolution ──────────────────────────────────────────────────────────

async function resolveUrls(config: ScrapingConfig, signal: AbortSignal): Promise<string[]> {
  const urls = new Set<string>();

  if (config.sourceType === "sitemap") {
    for (const sitemapUrl of config.urls) {
      if (signal.aborted) break;
      try {
        const res = await fetchPage({ url: sitemapUrl, config: { ...config, mode: "http" } });
        const entries = parseSitemap(res.html);
        for (const entry of entries) {
          urls.add(entry.loc);
        }
      } catch (err) {
        logger.warn(`Failed to parse sitemap ${sitemapUrl}: ${(err as Error).message}`);
      }
    }
  } else if (config.sourceType === "rss") {
    for (const feedUrl of config.urls) {
      if (signal.aborted) break;
      try {
        const res = await fetchPage({ url: feedUrl, config: { ...config, mode: "http" } });
        const items = parseFeed(res.html);
        for (const item of items) {
          if (item.link) urls.add(item.link);
        }
      } catch (err) {
        logger.warn(`Failed to parse feed ${feedUrl}: ${(err as Error).message}`);
      }
    }
  } else if (config.crawl?.enabled) {
    // Breadth-first crawl starting from seed URLs
    const visited = new Set<string>();
    const queue = [...config.urls];
    const maxPages = config.crawl.maxPages ?? 100;
    const maxDepth = config.crawl.maxDepth ?? 3;

    // Track depth per URL
    const depthMap = new Map<string, number>();
    for (const u of config.urls) {
      depthMap.set(u, 0);
    }

    while (queue.length > 0 && urls.size < maxPages) {
      if (signal.aborted) break;

      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const depth = depthMap.get(url) ?? 0;
      if (depth > maxDepth) continue;

      // Apply URL filters
      if (config.crawl.urlIncludePattern) {
        if (!new RegExp(config.crawl.urlIncludePattern).test(url)) continue;
      }
      if (config.crawl.urlExcludePattern) {
        if (new RegExp(config.crawl.urlExcludePattern).test(url)) continue;
      }

      urls.add(url);

      // Discover links from this page (only for crawl)
      if (depth < maxDepth) {
        try {
          const res = await fetchPage({ url, config: { ...config, mode: "http" } });
          const page = extractPage(res, config);
          for (const link of page.links) {
            if (!visited.has(link) && !queue.includes(link)) {
              // Check same-domain unless followExternal
              if (!config.crawl.followExternal) {
                const baseHost = new URL(config.urls[0]).hostname;
                const linkHost = new URL(link).hostname;
                if (linkHost !== baseHost) continue;
              }
              queue.push(link);
              depthMap.set(link, depth + 1);
            }
          }
        } catch {
          // Skip failed pages during crawl discovery
        }

        // Rate limit during crawl discovery
        await sleep(config.rateLimit?.delayBetweenRequests ?? 500);
      }
    }
  } else {
    // Simple URL list
    for (const u of config.urls) {
      urls.add(u);
    }
  }

  return [...urls];
}

// ── Quick single-URL scrape (preview) ───────────────────────────────────────

export async function scrapePreview(
  url: string,
  config: Partial<ScrapingConfig>,
): Promise<ScrapePreviewResult> {
  const fullConfig: ScrapingConfig = {
    sourceType: "web",
    mode: "hybrid",
    urls: [url],
    output: { format: "markdown", includeMetadata: true, extractImages: true, extractLinks: true, extractStructuredData: true, extractTables: true },
    autoTag: { enabled: true },
    ...config,
  };

  const fetchResult = await fetchPage({ url, config: fullConfig });
  const page = extractPage(fetchResult, fullConfig);

  // AI field extraction
  let extractedFields = page.fields;
  if (fullConfig.aiExtraction?.enabled) {
    const aiResult = await aiExtract(page.content, fullConfig);
    if (aiResult.success) {
      extractedFields = { ...extractedFields, ...aiResult.data };
    }
  }

  // Auto-tag
  const tagResults = await tagContent(page, fullConfig);

  return {
    url,
    page,
    extractedFields,
    tagResults,
  };
}

// ── Dataset helpers ─────────────────────────────────────────────────────────

async function ensureDataset(name: string): Promise<string> {
  const id = uuidv4();
  await db.insert(studioDatasets).values({
    id,
    name: `Scraped: ${name}`,
    description: `Dataset created by web scraper job "${name}"`,
    datasetType: "custom",
    supportedModalities: JSON.stringify(["text", "image", "audio", "video"]) as any,
    publishStatus: "draft",
    tags: JSON.stringify(["scraped", "web-data"]) as any,
  });
  return id;
}

interface InsertItemParams {
  datasetId: string;
  modality: ContentModality;
  content: { hash: string; size: number; contentUri: string };
  sourceUrl: string;
  tags: TaggingResult;
  title?: string;
  fields?: Record<string, unknown>;
  tables?: any[];
  structuredData?: any[];
}

async function insertDatasetItem(params: InsertItemParams): Promise<void> {
  const itemId = uuidv4();

  const labelsJson = {
    tags: params.tags.keywords.slice(0, 30),
    categories: [
      params.tags.domainCategory,
      params.tags.contentType,
      params.tags.mimeCategory,
    ].filter(Boolean) as string[],
    caption: params.title,
    customLabels: {
      ...(params.tags.sentiment ? { sentiment: params.tags.sentiment } : {}),
      ...(params.tags.entities?.length ? { entities: params.tags.entities } : {}),
      ...(params.tags.topics?.length ? { topics: params.tags.topics } : {}),
      ...(params.tags.customCategories ? { customCategories: params.tags.customCategories } : {}),
      ...(params.fields && Object.keys(params.fields).length ? { extractedFields: params.fields } : {}),
      ...(params.tables?.length ? { tables: params.tables } : {}),
      ...(params.structuredData?.length ? { structuredData: params.structuredData } : {}),
    },
  };

  const qualitySignals = {
    languageConfidence: params.tags.languageConfidence,
    overallQuality: params.tags.qualityScore,
    customSignals: {
      ...(params.tags.sentiment ? { sentimentScore: params.tags.sentiment.score } : {}),
    },
  };

  const lineage: ItemLineage = {
    transformations: ["web-scrape", "auto-tag"],
  };

  await db.insert(datasetItems).values({
    id: itemId,
    datasetId: params.datasetId,
    modality: params.modality,
    contentHash: params.content.hash,
    byteSize: params.content.size,
    sourceType: "scraped",
    sourcePath: params.sourceUrl,
    generator: "hybrid",
    lineageJson: JSON.stringify(lineage) as any,
    contentUri: params.content.contentUri,
    labelsJson: JSON.stringify(labelsJson) as any,
    qualitySignalsJson: JSON.stringify(qualitySignals) as any,
    license: "unknown",
    split: "unassigned",
  });

  // Provenance
  await db.insert(provenanceRecords).values({
    id: uuidv4(),
    itemId,
    action: "imported",
    actorType: "pipeline",
    actorId: "JoyCreate-Scraper/2.0",
    outputHash: params.content.hash,
    parametersJson: {
      sourceUrl: params.sourceUrl,
      language: params.tags.language,
      contentType: params.tags.contentType,
      domainCategory: params.tags.domainCategory,
    } as any,
  });

  // Update dataset item count
  try {
    const dataset = await db.select().from(studioDatasets).where(eq(studioDatasets.id, params.datasetId)).get();
    if (dataset) {
      await db.update(studioDatasets)
        .set({
          itemCount: (dataset.itemCount ?? 0) + 1,
          totalBytes: (dataset.totalBytes ?? 0) + params.content.size,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, params.datasetId));
    }
  } catch (err) {
    logger.warn(`Failed to update dataset stats: ${(err as Error).message}`);
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("econnreset") || msg.includes("429");
}

async function persistJobs(): Promise<void> {
  try {
    await saveJobs(activeJobs);
  } catch (err) {
    logger.warn(`Failed to persist jobs: ${(err as Error).message}`);
  }
}
