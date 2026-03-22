/**
 * Extraction Pipeline — Unified wrapper around V2 extractors.
 *
 * Bridges the new engine layer with existing extraction code:
 * - extractPage (DOM-based: cheerio + readability + turndown)
 * - extractFields (CSS/XPath selector-based)
 * - AI extraction (Vercel AI SDK + Ollama)
 * - parseFeed / parseSitemap (RSS/Atom/sitemap.xml)
 */

import log from "electron-log";
import * as cheerio from "cheerio";
import type { FetchResult } from "@/ipc/handlers/scraping/fetcher";
import type { ScrapingConfig, ScrapedPage, ScrapingField } from "@/ipc/handlers/scraping/types";
import { extractPage, extractFields, parseFeed, parseSitemap } from "@/ipc/handlers/scraping/extractor";
import type { ScrapeResult } from "../types";

const logger = log.scope("scraping:extraction-pipeline");

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExtractionInput {
  /** Raw scrape result from an engine */
  scrapeResult: ScrapeResult;
  /** Extraction configuration (CSS selectors, field definitions, etc.) */
  config: ScrapingConfig;
  /** Whether to run AI extraction after DOM extraction */
  useAI?: boolean;
  /** Custom fields to extract (overrides config.fields) */
  fields?: ScrapingField[];
}

export interface ExtractionOutput {
  /** Full page extraction result */
  page: ScrapedPage;
  /** Structured field extractions (if fields were specified) */
  fieldData?: Record<string, unknown>[];
  /** Feed items (if URL was RSS/Atom) */
  feedItems?: ReturnType<typeof parseFeed>;
  /** Sitemap URLs (if URL was a sitemap) */
  sitemapUrls?: ReturnType<typeof parseSitemap>;
  /** Extraction duration in ms */
  durationMs: number;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Run the full extraction pipeline on a scrape result.
 */
export async function runExtraction(input: ExtractionInput): Promise<ExtractionOutput> {
  const start = Date.now();
  const { scrapeResult, config } = input;

  // Bridge ScrapeResult to FetchResult (the shape V2 extractors expect)
  const fetchResult: FetchResult = {
    html: scrapeResult.html,
    finalUrl: scrapeResult.finalUrl,
    statusCode: scrapeResult.statusCode,
    contentType: scrapeResult.contentType,
    method: scrapeResult.engine === "static" || scrapeResult.engine === "api" ? "http" : "playwright",
    durationMs: scrapeResult.fetchDurationMs,
    screenshotPath: scrapeResult.screenshotPath,
    headers: scrapeResult.headers,
  };

  // Detect content type for specialized extraction
  const ct = scrapeResult.contentType.toLowerCase();
  const isXml = ct.includes("xml");
  const isRss = isXml && (scrapeResult.html.includes("<rss") || scrapeResult.html.includes("<feed"));
  const isSitemap = isXml && scrapeResult.html.includes("<urlset");

  // Feed/sitemap extraction
  let feedItems: ReturnType<typeof parseFeed> | undefined;
  let sitemapUrls: ReturnType<typeof parseSitemap> | undefined;

  if (isRss) {
    feedItems = parseFeed(scrapeResult.html);
    logger.info(`Parsed ${feedItems.length} feed items from ${scrapeResult.finalUrl}`);
  }

  if (isSitemap) {
    sitemapUrls = parseSitemap(scrapeResult.html);
    logger.info(`Parsed ${sitemapUrls.length} sitemap URLs from ${scrapeResult.finalUrl}`);
  }

  // Core page extraction
  const page = extractPage(fetchResult, config);

  // Field-based extraction
  let fieldData: Record<string, unknown>[] | undefined;
  const fields = input.fields ?? config.fields;
  if (fields && fields.length > 0) {
    const $ = cheerio.load(scrapeResult.html);
    const record = extractFields($, fields);
    fieldData = [record];
    logger.info(`Extracted field record from ${scrapeResult.finalUrl}`);
  }

  return {
    page,
    fieldData,
    feedItems,
    sitemapUrls,
    durationMs: Date.now() - start,
  };
}

/**
 * Quick text extraction — returns just the markdown/text content.
 */
export function quickExtract(html: string, url: string): { title: string; text: string; markdown: string } {
  const config: ScrapingConfig = {
    sourceType: "web",
    urls: [url],
    mode: "http",
    fields: [],
    output: {
      format: "markdown",
      extractImages: false,
      extractLinks: false,
    },
  };

  const fetchResult: FetchResult = {
    html,
    finalUrl: url,
    statusCode: 200,
    contentType: "text/html",
    method: "http",
    durationMs: 0,
    headers: {},
  };

  const page = extractPage(fetchResult, config);
  return {
    title: page.title ?? "",
    text: page.content ?? "",
    markdown: page.content ?? "",
  };
}
