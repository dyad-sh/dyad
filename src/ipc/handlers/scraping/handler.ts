/**
 * Unified Scraping IPC Handler
 *
 * Replaces both the old `scraper_handlers.ts` (scraper:* channels) and
 * `data_scraping_handlers.ts` (scraping:* channels) with a single
 * consolidated handler powered by the new engine.
 *
 * Channels:
 *   scraping:init               — initialise the engine (call once at startup)
 *   scraping:scrape-url         — quick single-URL scrape → dataset items
 *   scraping:preview            — preview scrape without persisting
 *   scraping:create-job         — create a batch scraping job
 *   scraping:start-job          — start (or resume) a job
 *   scraping:pause-job          — pause a running job
 *   scraping:cancel-job         — cancel a job
 *   scraping:delete-job         — delete a finished/cancelled job
 *   scraping:get-job            — get job by id
 *   scraping:list-jobs          — list all jobs
 *   scraping:templates          — list built-in templates
 *   scraping:detect-schema      — AI-detect extractable fields from sample URL
 *   scraping:auto-tag           — manually trigger auto-tag on text
 *   scraping:check-robots       — check if a URL is allowed by robots.txt
 *   scraping:parse-sitemap      — parse a sitemap URL
 *   scraping:parse-feed         — parse an RSS/Atom feed URL
 */

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log";
import { generateText } from "ai";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type { ScrapingConfig, ScrapingJob } from "./types";
import {
  initEngine,
  createJob,
  startJob,
  pauseJob,
  cancelJob,
  deleteJob,
  getJob,
  listJobs,
  scrapePreview,
  setProgressCallback,
} from "./engine";
import { listTemplates, getTemplate } from "./templates";
import { fetchPage, isAllowedByRobots } from "./fetcher";
import { extractPage, parseFeed, parseSitemap } from "./extractor";
import { detectSchema } from "./ai_extractor";
import { tagContent } from "./tagger";

const logger = log.scope("scraping:handler");

export function registerScrapingV2Handlers(): void {
  // ── Init ────────────────────────────────────────────────────────────

  ipcMain.handle("scraping:init", async () => {
    await initEngine();

    // Wire progress events → renderer
    setProgressCallback((jobId: string, job: ScrapingJob) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("scraping:job-progress", { jobId, job });
      }
    });

    return { ok: true };
  });

  // ── Quick single-URL scrape ─────────────────────────────────────────

  ipcMain.handle(
    "scraping:scrape-url",
    async (
      _event,
      args: {
        url: string;
        datasetId?: string;
        config?: Partial<ScrapingConfig>;
        templateId?: string;
      },
    ) => {
      const { url, datasetId, config, templateId } = args;

      // Merge template if provided
      let mergedConfig: Partial<ScrapingConfig> = config ?? {};
      if (templateId) {
        const tmpl = getTemplate(templateId);
        if (tmpl) {
          mergedConfig = {
            ...tmpl.config,
            fields: tmpl.fields,
            ...mergedConfig,
          };
        }
      }

      const fullConfig: ScrapingConfig = {
        sourceType: "web",
        mode: "hybrid",
        urls: [url],
        output: {
          format: "markdown",
          includeMetadata: true,
          extractImages: true,
          extractLinks: true,
          extractStructuredData: true,
          extractTables: true,
        },
        autoTag: { enabled: true },
        ...mergedConfig,
      };

      // Create + run a job synchronously for single URLs
      const job = createJob(`Scrape: ${url}`, fullConfig, datasetId, templateId);
      const result = await startJob(job.id);
      return result;
    },
  );

  // ── Preview ─────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:preview",
    async (
      _event,
      args: { url: string; config?: Partial<ScrapingConfig>; templateId?: string },
    ) => {
      let mergedConfig: Partial<ScrapingConfig> = args.config ?? {};
      if (args.templateId) {
        const tmpl = getTemplate(args.templateId);
        if (tmpl) {
          mergedConfig = { ...tmpl.config, fields: tmpl.fields, ...mergedConfig };
        }
      }
      return scrapePreview(args.url, mergedConfig);
    },
  );

  // ── Job CRUD ────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:create-job",
    async (
      _event,
      args: {
        name: string;
        config: ScrapingConfig;
        datasetId?: string;
        templateId?: string;
      },
    ) => {
      return createJob(args.name, args.config, args.datasetId, args.templateId);
    },
  );

  ipcMain.handle("scraping:start-job", async (_event, jobId: string) => {
    return startJob(jobId);
  });

  ipcMain.handle("scraping:pause-job", async (_event, jobId: string) => {
    return pauseJob(jobId);
  });

  ipcMain.handle("scraping:cancel-job", async (_event, jobId: string) => {
    return cancelJob(jobId);
  });

  ipcMain.handle("scraping:delete-job", async (_event, jobId: string) => {
    return deleteJob(jobId);
  });

  ipcMain.handle("scraping:get-job", async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return job;
  });

  ipcMain.handle(
    "scraping:list-jobs",
    async (_event, args?: { status?: string }) => {
      let jobs = listJobs();
      if (args?.status) {
        jobs = jobs.filter((j) => j.status === args.status);
      }
      return jobs;
    },
  );

  // ── Templates ───────────────────────────────────────────────────────

  ipcMain.handle("scraping:templates", async () => {
    return listTemplates();
  });

  // ── AI Schema Detection ─────────────────────────────────────────────

  ipcMain.handle(
    "scraping:detect-schema",
    async (_event, args: { url: string; instructions?: string }) => {
      // Fetch the page first
      const fetchResult = await fetchPage({
        url: args.url,
        config: { sourceType: "web", mode: "hybrid", urls: [args.url] },
      });
      const page = extractPage(fetchResult, {
        sourceType: "web",
        mode: "hybrid",
        urls: [args.url],
      });

      // Use AI to detect the extractable schema
      const fields = await detectSchema(page.content, args.instructions);
      return { url: args.url, fields };
    },
  );

  // ── Manual auto-tag ─────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:auto-tag",
    async (
      _event,
      args: { url: string; config?: Partial<ScrapingConfig> },
    ) => {
      const fetchResult = await fetchPage({
        url: args.url,
        config: { sourceType: "web", mode: "hybrid", urls: [args.url] },
      });
      const page = extractPage(fetchResult, {
        sourceType: "web",
        mode: "hybrid",
        urls: [args.url],
      });

      const config: ScrapingConfig = {
        sourceType: "web",
        mode: "hybrid",
        urls: [args.url],
        autoTag: { enabled: true, detectSentiment: true, extractEntities: true, classifyTopics: true },
        ...args.config,
      };
      return tagContent(page, config);
    },
  );

  // ── Utility: robots.txt ─────────────────────────────────────────────

  ipcMain.handle("scraping:check-robots", async (_event, url: string) => {
    const allowed = await isAllowedByRobots(url);
    return { url, allowed };
  });

  // ── Utility: sitemap parsing ────────────────────────────────────────

  ipcMain.handle(
    "scraping:parse-sitemap",
    async (_event, sitemapUrl: string) => {
      const fetchResult = await fetchPage({
        url: sitemapUrl,
        config: { sourceType: "web", mode: "http", urls: [sitemapUrl] },
      });
      return parseSitemap(fetchResult.html);
    },
  );

  // ── Utility: feed parsing ───────────────────────────────────────────

  ipcMain.handle("scraping:parse-feed", async (_event, feedUrl: string) => {
    const fetchResult = await fetchPage({
      url: feedUrl,
      config: { sourceType: "web", mode: "http", urls: [feedUrl] },
    });
    return parseFeed(fetchResult.html);
  });

  // ── NLP Configuration ─────────────────────────────────────────────

  ipcMain.handle(
    "scraping:nlp-configure",
    async (_event, args: { query: string }) => {
      const { query } = args;
      const templates = listTemplates();
      const templateList = templates
        .map((t) => `- ${t.id}: ${t.name} — ${t.description}`)
        .join("\n");

      try {
        const settings = readSettings();
        const { modelClient } = await getModelClient(
          settings.selectedModel,
          settings,
        );

        const result = await generateText({
          model: modelClient.model,
          system: `You are a web scraping configuration assistant. Given a user's natural language request, return a JSON object with scraping configuration parameters.

Available templates:
${templateList}

Return ONLY valid JSON with these optional fields:
- url: string (the URL to scrape, extract from the user's description)
- sourceType: "web" | "rss" | "sitemap"
- mode: "http" | "playwright" | "hybrid"
- templateId: string (one of the template IDs listed above, if applicable)
- aiExtraction: boolean
- crawl: boolean
- crawlDepth: number (1-10)
- crawlMaxPages: number (1-1000)
- autoTag: boolean
- autoRun: boolean (true if the user's intent is clearly to start scraping immediately)
- description: string (a brief description of what to extract)

If you cannot determine a URL from the request, set url to an empty string.
Always set aiExtraction to true if the user wants structured data extraction.
Return ONLY the JSON object, no markdown, no explanation.`,
          prompt: query,
          maxOutputTokens: 1024,
          temperature: 0.1,
        });

        // Parse the JSON response
        let config: Record<string, unknown> = {};
        try {
          const cleaned = result.text
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim();
          config = JSON.parse(cleaned);
        } catch {
          // Try to extract JSON from the response
          const jsonMatch = result.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            config = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("Could not parse AI response into configuration");
          }
        }

        return config;
      } catch (err) {
        // If AI is not available, try basic URL extraction
        const urlMatch = query.match(
          /https?:\/\/[^\s,;"')]+/i,
        );
        const hasCrawl = /crawl|all pages|entire site|whole site/i.test(query);
        const hasAi = /extract|structure|fields|data|prices|title/i.test(query);

        // Try to match template keywords
        let matchedTemplate = "";
        if (/product|shop|price|ecommerce|e-commerce/i.test(query)) matchedTemplate = "ecommerce-products";
        else if (/news|article|blog/i.test(query)) matchedTemplate = "news-articles";
        else if (/job|career|hiring|position/i.test(query)) matchedTemplate = "job-listings";
        else if (/recipe|cook|ingredient/i.test(query)) matchedTemplate = "recipes";
        else if (/paper|academic|research|arxiv/i.test(query)) matchedTemplate = "academic-papers";
        else if (/real.?estate|property|house|apartment/i.test(query)) matchedTemplate = "real-estate";
        else if (/event|meetup|conference/i.test(query)) matchedTemplate = "event-listings";
        else if (/forum|thread|discussion/i.test(query)) matchedTemplate = "forum-threads";
        else if (/doc|documentation|api|reference/i.test(query)) matchedTemplate = "documentation";

        return {
          url: urlMatch ? urlMatch[0] : "",
          crawl: hasCrawl,
          crawlMaxPages: hasCrawl ? 20 : undefined,
          aiExtraction: hasAi,
          autoTag: true,
          templateId: matchedTemplate || undefined,
          autoRun: !!urlMatch,
        };
      }
    },
  );

  logger.info("Scraping v2 handlers registered");
}
