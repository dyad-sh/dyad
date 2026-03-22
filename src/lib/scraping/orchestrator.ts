/**
 * Scraping Orchestrator — Central coordinator for all scraping operations.
 *
 * Manages the full job lifecycle:
 *  1. Probe URL → select engine
 *  2. Fetch with engine (static/browser/stealth/api)
 *  3. Extract content (DOM + AI)
 *  4. Persist results to SQLite via Drizzle
 *  5. Track metrics + handle errors + retries
 *
 * Also manages the job queue, scheduled jobs, and crawl sessions.
 */

import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import {
  scrapingJobs,
  scrapingResults,
  scrapingSchedules,
  scrapingTemplates,
} from "@/db/schema";
import { probeUrl, selectEngine } from "./engine_selector";
import {
  StaticEngine,
  BrowserEngine,
  StealthEngine,
  APIEngine,
} from "./engines";
import { runExtraction, quickExtract } from "./extraction";
import {
  MetricsCollector,
  categorizeError,
  getRetryDelay,
  shouldRetry,
  DEFAULT_RETRY_STRATEGY,
} from "./monitoring";
import type {
  EngineType,
  ScrapeOptions,
  ScrapeResult,
  ScrapingEngine,
  RetryStrategy,
  ScrapingMetrics,
} from "./types";
import type { ScrapingConfig } from "@/ipc/handlers/scraping/types";

const logger = log.scope("scraping:orchestrator");

// ── Engine pool ─────────────────────────────────────────────────────────────

const engines: Record<string, ScrapingEngine> = {};

function getEngine(type: EngineType): ScrapingEngine {
  if (type === "auto") type = "static"; // resolved by caller
  if (!engines[type]) {
    switch (type) {
      case "static":
        engines[type] = new StaticEngine();
        break;
      case "browser":
        engines[type] = new BrowserEngine();
        break;
      case "stealth":
        engines[type] = new StealthEngine();
        break;
      case "api":
        engines[type] = new APIEngine();
        break;
      case "fetch":
        engines[type] = new StaticEngine(); // alias
        break;
    }
  }
  return engines[type];
}

/**
 * Dispose all engine resources (browser instances, etc.).
 */
export async function disposeEngines(): Promise<void> {
  for (const engine of Object.values(engines)) {
    await engine.dispose().catch(() => {});
  }
}

// ── Job Orchestration ───────────────────────────────────────────────────────

/**
 * Create a new scraping job and return its ID.
 */
export async function createJob(
  name: string,
  config: ScrapingConfig,
  opts?: {
    engine?: EngineType;
    templateId?: string;
    scheduleId?: string;
    datasetId?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();

  await db.insert(scrapingJobs).values({
    id,
    name,
    status: "queued",
    config: config as unknown as Record<string, unknown>,
    engine: opts?.engine ?? "auto",
    pagesTotal: 0,
    pagesDone: 0,
    recordsExtracted: 0,
    errorCount: 0,
    templateId: opts?.templateId,
    scheduleId: opts?.scheduleId,
    datasetId: opts?.datasetId,
  });

  logger.info(`Created scraping job ${id}: ${name}`);
  return id;
}

/**
 * Run a scraping job to completion.
 */
export async function runJob(jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(scrapingJobs)
    .where(eq(scrapingJobs.id, jobId))
    .limit(1);

  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "queued" && job.status !== "paused") {
    throw new Error(`Job ${jobId} is ${job.status}, cannot run`);
  }

  const config = job.config as unknown as ScrapingConfig;
  const metrics = new MetricsCollector();

  // Mark running
  await db
    .update(scrapingJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(scrapingJobs.id, jobId));

  try {
    // Resolve URLs to scrape
    const urls = resolveUrls(config);
    await db
      .update(scrapingJobs)
      .set({ pagesTotal: urls.length })
      .where(eq(scrapingJobs.id, jobId));

    // Resolve engine
    let engineType: EngineType = job.engine as EngineType;
    if (engineType === "auto" && urls.length > 0) {
      const probe = await probeUrl(urls[0]);
      engineType = selectEngine(probe);
    }

    const engine = getEngine(engineType);

    // Process each URL
    for (const url of urls) {
      // Check if cancelled
      const [current] = await db
        .select({ status: scrapingJobs.status })
        .from(scrapingJobs)
        .where(eq(scrapingJobs.id, jobId))
        .limit(1);

      if (current?.status === "cancelled" || current?.status === "paused") {
        break;
      }

      await processUrl(jobId, url, engine, config, metrics);
    }

    // Final status
    const [final] = await db
      .select({ status: scrapingJobs.status })
      .from(scrapingJobs)
      .where(eq(scrapingJobs.id, jobId))
      .limit(1);

    if (final?.status === "running") {
      await db
        .update(scrapingJobs)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(scrapingJobs.id, jobId));
    }
  } catch (err) {
    logger.error(`Job ${jobId} failed:`, err);
    await db
      .update(scrapingJobs)
      .set({
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(scrapingJobs.id, jobId));
  }
}

async function processUrl(
  jobId: string,
  url: string,
  engine: ScrapingEngine,
  config: ScrapingConfig,
  metrics: MetricsCollector,
  retryStrategy: RetryStrategy = DEFAULT_RETRY_STRATEGY,
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryStrategy.maxRetries; attempt++) {
    try {
      // Fetch
      const scrapeResult = await engine.scrape(url, {
        timeout: 30_000,
        scrollToBottom: config.mode === "playwright" || config.mode === "hybrid",
      });

      metrics.recordPageLoad(scrapeResult.fetchDurationMs, scrapeResult.bytesReceived);

      // Extract
      const extraction = await runExtraction({
        scrapeResult,
        config,
      });

      metrics.recordExtraction(true, extraction.fieldData?.length ?? 1);

      // Store result
      const resultId = crypto.randomUUID();
      await db.insert(scrapingResults).values({
        id: resultId,
        jobId,
        url,
        statusCode: scrapeResult.statusCode,
        data: {
          title: extraction.page.title,
          content: extraction.page.content,
          excerpt: extraction.page.excerpt,
          author: extraction.page.author,
          publishedDate: extraction.page.publishedDate,
          images: extraction.page.images?.length ?? 0,
          links: extraction.page.links?.length ?? 0,
          fields: extraction.fieldData,
          feedItems: extraction.feedItems?.length,
          sitemapUrls: extraction.sitemapUrls?.length,
        } as Record<string, unknown>,
        extractionEngine: engine.name,
        screenshotPath: scrapeResult.screenshotPath,
        confidence: 1.0,
      });

      // Update job progress
      await db
        .update(scrapingJobs)
        .set({
          pagesDone: (await getJobProgress(jobId)).pagesDone + 1,
          recordsExtracted:
            (await getJobProgress(jobId)).recordsExtracted +
            (extraction.fieldData?.length ?? 1),
        })
        .where(eq(scrapingJobs.id, jobId));

      return; // Success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const category = categorizeError(err);
      metrics.recordError();

      if (!shouldRetry(category) || attempt >= retryStrategy.maxRetries) {
        break;
      }

      const delay = getRetryDelay(retryStrategy, attempt);
      logger.warn(
        `Retry ${attempt + 1}/${retryStrategy.maxRetries} for ${url} (${category}), waiting ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // All retries exhausted
  await db
    .update(scrapingJobs)
    .set({
      errorCount: (await getJobProgress(jobId)).errorCount + 1,
      lastError: lastError?.message ?? "Unknown error",
    })
    .where(eq(scrapingJobs.id, jobId));
}

// ── Quick Scrape (single URL, no job) ───────────────────────────────────────

export interface QuickScrapeResult {
  url: string;
  title: string;
  text: string;
  markdown: string;
  engine: EngineType;
  durationMs: number;
}

/**
 * Quick scrape a single URL without creating a job.
 */
export async function quickScrape(
  url: string,
  opts?: ScrapeOptions,
): Promise<QuickScrapeResult> {
  const start = Date.now();

  // Auto-select engine
  let engineType: EngineType = opts?.engine ?? "auto";
  if (engineType === "auto") {
    const probe = await probeUrl(url);
    engineType = selectEngine(probe);
  }

  const engine = getEngine(engineType);
  const result = await engine.scrape(url, opts ?? {});
  const extracted = quickExtract(result.html, result.finalUrl);

  return {
    url: result.finalUrl,
    title: extracted.title,
    text: extracted.text,
    markdown: extracted.markdown,
    engine: engineType,
    durationMs: Date.now() - start,
  };
}

// ── Job Management Queries ──────────────────────────────────────────────────

export async function getJob(jobId: string) {
  const [job] = await db
    .select()
    .from(scrapingJobs)
    .where(eq(scrapingJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function listJobs(status?: string) {
  if (status) {
    return db
      .select()
      .from(scrapingJobs)
      .where(eq(scrapingJobs.status, status as any))
      .orderBy(scrapingJobs.createdAt);
  }
  return db.select().from(scrapingJobs).orderBy(scrapingJobs.createdAt);
}

export async function cancelJob(jobId: string): Promise<void> {
  await db
    .update(scrapingJobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(scrapingJobs.id, jobId));
}

export async function pauseJob(jobId: string): Promise<void> {
  await db
    .update(scrapingJobs)
    .set({ status: "paused" })
    .where(eq(scrapingJobs.id, jobId));
}

export async function resumeJob(jobId: string): Promise<void> {
  // Requeue and re-run
  await db
    .update(scrapingJobs)
    .set({ status: "queued" })
    .where(eq(scrapingJobs.id, jobId));
}

export async function deleteJob(jobId: string): Promise<void> {
  // Results cascade-delete via FK
  await db.delete(scrapingJobs).where(eq(scrapingJobs.id, jobId));
}

async function getJobProgress(jobId: string) {
  const [job] = await db
    .select({
      pagesDone: scrapingJobs.pagesDone,
      recordsExtracted: scrapingJobs.recordsExtracted,
      errorCount: scrapingJobs.errorCount,
    })
    .from(scrapingJobs)
    .where(eq(scrapingJobs.id, jobId))
    .limit(1);
  return job ?? { pagesDone: 0, recordsExtracted: 0, errorCount: 0 };
}

// ── Results Queries ─────────────────────────────────────────────────────────

export async function getJobResults(jobId: string) {
  return db
    .select()
    .from(scrapingResults)
    .where(eq(scrapingResults.jobId, jobId));
}

export async function getResult(resultId: string) {
  const [result] = await db
    .select()
    .from(scrapingResults)
    .where(eq(scrapingResults.id, resultId))
    .limit(1);
  return result ?? null;
}

// ── Schedule Management ─────────────────────────────────────────────────────

export async function createSchedule(
  name: string,
  jobConfig: Record<string, unknown>,
  cronExpression: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(scrapingSchedules).values({
    id,
    name,
    jobConfig,
    cronExpression,
    enabled: true,
  });
  return id;
}

export async function listSchedules() {
  return db.select().from(scrapingSchedules);
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<void> {
  await db
    .update(scrapingSchedules)
    .set({ enabled })
    .where(eq(scrapingSchedules.id, id));
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.delete(scrapingSchedules).where(eq(scrapingSchedules.id, id));
}

// ── Template Management ─────────────────────────────────────────────────────

export async function createTemplate(
  name: string,
  description: string,
  category: string,
  config: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(scrapingTemplates).values({
    id,
    name,
    description,
    category,
    config,
  });
  return id;
}

export async function listTemplates() {
  return db.select().from(scrapingTemplates);
}

export async function getTemplate(id: string) {
  const [template] = await db
    .select()
    .from(scrapingTemplates)
    .where(eq(scrapingTemplates.id, id))
    .limit(1);
  return template ?? null;
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.delete(scrapingTemplates).where(eq(scrapingTemplates.id, id));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveUrls(config: ScrapingConfig): string[] {
  if (config.urls && config.urls.length > 0) {
    return config.urls;
  }
  return [];
}
