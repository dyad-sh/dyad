/**
 * web_scraper tool — Scrape web content and create a dataset from natural language.
 * Uses the scraping engine v2 for fetch → extract → AI → media → tag → store.
 * Requires user approval (consent: "ask").
 */

import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  initEngine,
  createJob,
  startJob,
  listJobs,
} from "@/ipc/handlers/scraping/engine";
import { listTemplates, getTemplate } from "@/ipc/handlers/scraping/templates";
import type { ScrapingConfig, ScrapingJob } from "@/ipc/handlers/scraping/types";

const logger = log.scope("tool:web_scraper");

const webScraperSchema = z.object({
  url: z.string().url().describe("The URL to scrape (required)"),
  description: z
    .string()
    .optional()
    .describe("Natural language description of what to extract (e.g. 'get all product names and prices')"),
  templateId: z
    .string()
    .optional()
    .describe(
      "Optional template ID for pre-configured extraction (e.g. 'news-articles', 'ecommerce-products', 'job-listings', 'recipes')",
    ),
  crawl: z
    .boolean()
    .optional()
    .describe("Whether to crawl linked pages on the same domain (default: false)"),
  maxPages: z
    .number()
    .optional()
    .describe("Maximum pages to scrape when crawling (default: 10)"),
  aiExtraction: z
    .boolean()
    .optional()
    .describe("Whether to use AI to extract structured data (default: true)"),
  datasetName: z
    .string()
    .optional()
    .describe("Name for the resulting dataset (default: auto-generated from URL)"),
});

type WebScraperInput = z.infer<typeof webScraperSchema>;

export const webScraperTool: ToolDefinition<WebScraperInput> = {
  name: "web_scraper",
  description: `Scrape web pages and create structured datasets. Use this to:
- Scrape a single URL and extract text, images, metadata, and structured data
- Crawl an entire site (with maxPages limit) to build a comprehensive dataset
- Use AI extraction to pull specific fields from web content
- Apply built-in templates for common sources (news, e-commerce, jobs, recipes, academic papers, etc.)
- Auto-tag and classify scraped content

Available templates: ecommerce-products, news-articles, social-profiles, job-listings, 
recipes, academic-papers, real-estate, event-listings, forum-threads, documentation, 
podcast-episodes, video-metadata, financial-data, weather-data, government-data, legal-documents

The scraper respects robots.txt, applies rate limiting, and stores content with full provenance tracking.
Results are stored as dataset items in the local database with auto-generated tags and quality scores.`,

  inputSchema: webScraperSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) => {
    const parts = [`Scrape: ${args.url}`];
    if (args.crawl) parts.push(`(crawl up to ${args.maxPages ?? 10} pages)`);
    if (args.templateId) parts.push(`using template: ${args.templateId}`);
    if (args.description) parts.push(`— ${args.description}`);
    return parts.join(" ");
  },

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    const attrs: string[] = [];
    attrs.push(`url="${escapeXmlAttr(args.url ?? "")}"`);
    if (args.templateId) attrs.push(`template="${escapeXmlAttr(args.templateId)}"`);
    if (args.crawl) attrs.push(`crawl="true" maxPages="${args.maxPages ?? 10}"`);
    if (args.datasetName) attrs.push(`dataset="${escapeXmlAttr(args.datasetName)}"`);

    let xml = `<joy-web-scraper ${attrs.join(" ")}>`;
    if (args.description) {
      xml += `\n${escapeXmlContent(args.description)}`;
    }
    if (isComplete) {
      xml += "\n</joy-web-scraper>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const {
      url,
      description,
      templateId,
      crawl,
      maxPages,
      aiExtraction,
      datasetName,
    } = args;

    logger.info(`Web scraper tool invoked for: ${url}`);

    // Ensure the engine is initialized
    try {
      await initEngine();
    } catch {
      // Already initialized — ignore
    }

    // Build scraping configuration
    let templateConfig: Partial<ScrapingConfig> = {};
    if (templateId) {
      const tmpl = getTemplate(templateId);
      if (tmpl) {
        templateConfig = { ...tmpl.config, fields: tmpl.fields };
        logger.info(`Using template: ${templateId} (${tmpl.name})`);
      } else {
        logger.warn(`Template "${templateId}" not found, proceeding without it`);
      }
    }

    const config: ScrapingConfig = {
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
      autoTag: {
        enabled: true,
        detectSentiment: true,
        extractEntities: true,
        classifyTopics: true,
        assessQuality: true,
      },
      aiExtraction: {
        enabled: aiExtraction !== false,
        instructions: description,
        summarize: true,
      },
      rateLimit: {
        requestsPerSecond: 2,
        delayBetweenRequests: 1000,
        maxConcurrent: 1,
      },
      ...templateConfig,
    };

    // Enable crawling if requested
    if (crawl) {
      config.crawl = {
        enabled: true,
        maxDepth: 3,
        maxPages: maxPages ?? 10,
        followExternal: false,
      };
    }

    // Create and run the scraping job
    const jobName = datasetName || `Scrape: ${new URL(url).hostname}`;
    const job = createJob(jobName, config, undefined, templateId);

    logger.info(`Created scraping job: ${job.id} (${jobName})`);

    // Stream progress via XML
    ctx.onXmlStream(
      `<joy-web-scraper url="${escapeXmlAttr(url)}" status="running">\nStarting scrape of ${escapeXmlContent(url)}...`,
    );

    let result: ScrapingJob;
    try {
      result = await startJob(job.id);
    } catch (err) {
      const errorMsg = (err as Error).message;
      logger.error(`Scraping job failed: ${errorMsg}`);
      ctx.onXmlComplete(
        `<joy-web-scraper url="${escapeXmlAttr(url)}" status="failed">\nError: ${escapeXmlContent(errorMsg)}\n</joy-web-scraper>`,
      );
      return `Scraping failed: ${errorMsg}`;
    }

    // Build result summary
    const summary = buildResultSummary(result);

    ctx.onXmlComplete(
      `<joy-web-scraper url="${escapeXmlAttr(url)}" status="${result.status}" dataset="${escapeXmlAttr(result.datasetId ?? "")}">\n${escapeXmlContent(summary)}\n</joy-web-scraper>`,
    );

    logger.info(`Scraping job ${job.id} completed: ${result.status}`);
    return summary;
  },
};

function buildResultSummary(job: ScrapingJob): string {
  const lines: string[] = [];
  lines.push(`Scraping job "${job.name}" completed with status: ${job.status}`);
  lines.push("");
  lines.push("## Stats");
  lines.push(`- Pages scraped: ${job.stats.pagesScraped}`);
  lines.push(`- Items extracted: ${job.stats.itemsExtracted}`);
  lines.push(`- Media downloaded: ${job.stats.mediaDownloaded}`);
  lines.push(
    `- Data downloaded: ${(job.stats.bytesDownloaded / 1024).toFixed(1)} KB`,
  );
  lines.push(`- Duration: ${(job.stats.durationMs / 1000).toFixed(1)}s`);

  if (job.progress.failed > 0) {
    lines.push("");
    lines.push(`## Errors (${job.progress.failed})`);
    for (const err of job.errors.slice(0, 5)) {
      lines.push(`- ${err.url}: ${err.message}`);
    }
    if (job.errors.length > 5) {
      lines.push(`  ... and ${job.errors.length - 5} more`);
    }
  }

  if (job.datasetId) {
    lines.push("");
    lines.push(`Dataset ID: ${job.datasetId}`);
    lines.push(
      `The scraped data is now stored as dataset items. You can view and manage it in the Data Studio.`,
    );
  }

  return lines.join("\n");
}
