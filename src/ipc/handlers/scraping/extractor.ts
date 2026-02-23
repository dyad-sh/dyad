/**
 * DOM-Based Content Extractor
 *
 * Replaces all regex-based HTML extraction with cheerio (fast DOM parser).
 * Supports CSS selectors, structured data extraction (JSON-LD, OpenGraph,
 * microdata), table extraction, link/image extraction, and article extraction
 * via @mozilla/readability + turndown for Markdown conversion.
 */

import * as cheerio from "cheerio";
import TurndownService from "turndown";
import log from "electron-log";
import type {
  ScrapedPage,
  ScrapedMedia,
  StructuredDataItem,
  ExtractedTable,
  PageMetadata,
  ScrapingConfig,
  ScrapingField,
} from "./types";
import type { FetchResult } from "./fetcher";

const logger = log.scope("scraping:extractor");

// ── Main extraction entry point ─────────────────────────────────────────────

export function extractPage(
  fetchResult: FetchResult,
  config: ScrapingConfig,
): ScrapedPage {
  const $ = cheerio.load(fetchResult.html);
  const start = Date.now();

  // Core content extraction
  const article = extractArticle(fetchResult.html);
  const title = extractTitle($, config);
  const content = resolveContent($, config, article, fetchResult.html);
  const author = extractAuthor($, config);
  const publishedDate = extractDate($, config);
  const language = detectLanguage($);

  // Metadata
  const metadata = extractMetadata($);
  const excerpt = article?.excerpt ?? metadata.description ?? "";
  const siteName = article?.siteName ?? extractSiteName($);

  // Media & links
  const images = config.output?.extractImages !== false
    ? extractImages($, fetchResult.finalUrl)
    : [];
  const audio = config.output?.extractMedia
    ? extractAudio($, fetchResult.finalUrl)
    : [];
  const video = config.output?.extractMedia
    ? extractVideo($, fetchResult.finalUrl)
    : [];
  const links = config.output?.extractLinks !== false
    ? extractLinks($, fetchResult.finalUrl)
    : [];

  // Structured data
  const structuredData = config.output?.extractStructuredData !== false
    ? extractStructuredData($)
    : [];

  // Tables
  const tables = config.output?.extractTables
    ? extractTables($)
    : [];

  // User-defined field extraction
  const fields = config.fields?.length
    ? extractFields($, config.fields)
    : {};

  return {
    url: fetchResult.finalUrl,
    finalUrl: fetchResult.finalUrl,
    statusCode: fetchResult.statusCode,
    contentType: fetchResult.contentType,
    html: fetchResult.html,
    content,
    title,
    author,
    publishedDate,
    excerpt,
    siteName,
    language,
    images,
    audio,
    video,
    links,
    structuredData,
    tables,
    fields,
    metadata,
    fetchedAt: new Date(),
    fetchMethod: fetchResult.method,
    fetchDurationMs: fetchResult.durationMs,
    screenshotPath: fetchResult.screenshotPath,
  };
}

// ── Article extraction (Readability) ────────────────────────────────────────

interface ReadabilityArticle {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  excerpt: string;
  siteName: string | null;
  publishedTime: string | null;
}

function extractArticle(html: string): ReadabilityArticle | null {
  try {
    // Readability requires a DOM document — we create one from the JSDOM-free
    // cheerio approach by building a minimal document-like object.
    // Note: @mozilla/readability v0.5+ supports passing HTML string directly.
    const { Readability } = require("@mozilla/readability");
    const { JSDOM } = requireJsdomFallback();

    if (!JSDOM) {
      // Use basic fallback if jsdom isn't available
      return null;
    }

    const dom = new JSDOM(html, { url: "https://localhost" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article;
  } catch (err) {
    logger.debug(`Readability extraction failed: ${(err as Error).message}`);
    return null;
  }
}

function requireJsdomFallback(): { JSDOM: any } {
  try {
    // jsdom may not be installed — readability also works with linkedom
    return require("jsdom");
  } catch {
    try {
      return require("linkedom");
    } catch {
      return { JSDOM: null };
    }
  }
}

// ── Title extraction ────────────────────────────────────────────────────────

function extractTitle($: cheerio.CheerioAPI, config: ScrapingConfig): string {
  // User-defined selector first
  if (config.selectors?.title) {
    const text = $(config.selectors.title).first().text().trim();
    if (text) return text;
  }

  // Try common title sources
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle) return ogTitle.trim();

  const h1 = $("h1").first().text().trim();
  if (h1) return h1;

  const titleTag = $("title").first().text().trim();
  if (titleTag) return titleTag;

  return "";
}

// ── Author extraction ───────────────────────────────────────────────────────

function extractAuthor($: cheerio.CheerioAPI, config: ScrapingConfig): string | undefined {
  if (config.selectors?.author) {
    const text = $(config.selectors.author).first().text().trim();
    if (text) return text;
  }

  const metaAuthor = $('meta[name="author"]').attr("content");
  if (metaAuthor) return metaAuthor.trim();

  const articleAuthor = $('meta[property="article:author"]').attr("content");
  if (articleAuthor) return articleAuthor.trim();

  const byline = $('[rel="author"], .author, .byline, [itemprop="author"]').first().text().trim();
  if (byline) return byline;

  return undefined;
}

// ── Date extraction ─────────────────────────────────────────────────────────

function extractDate($: cheerio.CheerioAPI, config: ScrapingConfig): string | undefined {
  if (config.selectors?.date) {
    const text = $(config.selectors.date).first().text().trim();
    if (text) return text;
  }

  const articleTime = $('meta[property="article:published_time"]').attr("content");
  if (articleTime) return articleTime;

  const time = $("time[datetime]").first().attr("datetime");
  if (time) return time;

  const dateMeta = $('meta[name="date"]').attr("content");
  if (dateMeta) return dateMeta;

  return undefined;
}

// ── Language detection ──────────────────────────────────────────────────────

function detectLanguage($: cheerio.CheerioAPI): string | undefined {
  const htmlLang = $("html").attr("lang");
  if (htmlLang) return htmlLang.split("-")[0].toLowerCase();

  const contentLang = $('meta[http-equiv="content-language"]').attr("content");
  if (contentLang) return contentLang.split("-")[0].toLowerCase();

  const ogLocale = $('meta[property="og:locale"]').attr("content");
  if (ogLocale) return ogLocale.split("_")[0].toLowerCase();

  return undefined;
}

// ── Content extraction with format support ──────────────────────────────────

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function resolveContent(
  $: cheerio.CheerioAPI,
  config: ScrapingConfig,
  article: ReadabilityArticle | null,
  rawHtml: string,
): string {
  const format = config.output?.format ?? "markdown";

  // If user specified a content selector, use it
  if (config.selectors?.content) {
    const el = $(config.selectors.content).first();
    if (el.length) {
      const html = el.html() ?? "";
      return formatContent(html, format);
    }
  }

  // Use Readability result if available
  if (article?.content) {
    if (format === "text") return article.textContent;
    if (format === "html") return article.content;
    return formatContent(article.content, format);
  }

  // Fallback: extract <main>, <article>, or <body>
  const mainEl = $("main, article, [role='main']").first();
  const sourceHtml = mainEl.length ? mainEl.html() ?? "" : $("body").html() ?? rawHtml;

  return formatContent(sourceHtml, format);
}

function formatContent(html: string, format: string): string {
  switch (format) {
    case "html":
      return html;
    case "text":
      return cheerio
        .load(html)("body")
        .text()
        .replace(/\s+/g, " ")
        .trim();
    case "json":
      return html; // caller will structure it
    case "markdown":
    default:
      return turndown.turndown(html);
  }
}

// ── Metadata extraction ─────────────────────────────────────────────────────

function extractMetadata($: cheerio.CheerioAPI): PageMetadata {
  return {
    description: $('meta[name="description"]').attr("content")
      ?? $('meta[property="og:description"]').attr("content"),
    keywords: ($('meta[name="keywords"]').attr("content") || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    canonicalUrl: $('link[rel="canonical"]').attr("href"),
    ogTitle: $('meta[property="og:title"]').attr("content"),
    ogDescription: $('meta[property="og:description"]').attr("content"),
    ogImage: $('meta[property="og:image"]').attr("content"),
    ogType: $('meta[property="og:type"]').attr("content"),
    twitterCard: $('meta[name="twitter:card"]').attr("content"),
    favicon: $('link[rel="icon"], link[rel="shortcut icon"]').attr("href"),
    robotsMeta: $('meta[name="robots"]').attr("content"),
  };
}

// ── Structured data extraction ──────────────────────────────────────────────

function extractStructuredData($: cheerio.CheerioAPI): StructuredDataItem[] {
  const items: StructuredDataItem[] = [];

  // JSON-LD
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const text = $(el).html();
      if (text) {
        const data = JSON.parse(text);
        items.push({ type: "json-ld", data: Array.isArray(data) ? { "@graph": data } : data });
      }
    } catch {
      // malformed JSON-LD — skip
    }
  });

  // Open Graph
  const ogData: Record<string, unknown> = {};
  $("meta[property^='og:']").each((_i, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content");
    if (prop && content) ogData[prop] = content;
  });
  if (Object.keys(ogData).length) {
    items.push({ type: "opengraph", data: ogData });
  }

  // Twitter Card
  const twitterData: Record<string, unknown> = {};
  $("meta[name^='twitter:']").each((_i, el) => {
    const name = $(el).attr("name");
    const content = $(el).attr("content");
    if (name && content) twitterData[name] = content;
  });
  if (Object.keys(twitterData).length) {
    items.push({ type: "twitter-card", data: twitterData });
  }

  return items;
}

// ── Image extraction ────────────────────────────────────────────────────────

function extractImages($: cheerio.CheerioAPI, baseUrl: string): ScrapedMedia[] {
  const images: ScrapedMedia[] = [];
  const seen = new Set<string>();

  $("img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
    if (!src) return;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);

    images.push({
      url: resolved,
      alt: $(el).attr("alt") || undefined,
      title: $(el).attr("title") || undefined,
      width: parseInt($(el).attr("width") || "0", 10) || undefined,
      height: parseInt($(el).attr("height") || "0", 10) || undefined,
    });
  });

  // Also check <picture> > source
  $("picture source").each((_i, el) => {
    const srcset = $(el).attr("srcset");
    if (!srcset) return;
    const firstSrc = srcset.split(",")[0]?.trim().split(/\s+/)[0];
    if (!firstSrc) return;
    const resolved = resolveUrl(firstSrc, baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      images.push({
        url: resolved,
        mimeType: $(el).attr("type") || undefined,
      });
    }
  });

  return images;
}

// ── Audio extraction ────────────────────────────────────────────────────────

function extractAudio($: cheerio.CheerioAPI, baseUrl: string): ScrapedMedia[] {
  const media: ScrapedMedia[] = [];
  const seen = new Set<string>();

  $("audio, audio source").each((_i, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    media.push({ url: resolved, mimeType: $(el).attr("type") || undefined });
  });

  return media;
}

// ── Video extraction ────────────────────────────────────────────────────────

function extractVideo($: cheerio.CheerioAPI, baseUrl: string): ScrapedMedia[] {
  const media: ScrapedMedia[] = [];
  const seen = new Set<string>();

  $("video, video source").each((_i, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    media.push({
      url: resolved,
      mimeType: $(el).attr("type") || undefined,
      width: parseInt($(el).attr("width") || "0", 10) || undefined,
      height: parseInt($(el).attr("height") || "0", 10) || undefined,
    });
  });

  // iframe embeds (YouTube, Vimeo, etc.)
  $("iframe").each((_i, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/.test(src)) {
      const resolved = resolveUrl(src, baseUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        media.push({ url: resolved, mimeType: "video/embed" });
      }
    }
  });

  return media;
}

// ── Link extraction ─────────────────────────────────────────────────────────

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    // Skip non-http and anchor-only links
    if (!resolved.startsWith("http")) return;
    seen.add(resolved);
    links.push(resolved);
  });

  return links;
}

// ── Table extraction ────────────────────────────────────────────────────────

function extractTables($: cheerio.CheerioAPI): ExtractedTable[] {
  const tables: ExtractedTable[] = [];

  $("table").each((_i, el) => {
    const table = $(el);
    const caption = table.find("caption").first().text().trim() || undefined;

    const headers: string[] = [];
    table.find("thead th, thead td, tr:first-child th").each((_j, th) => {
      headers.push($(th).text().trim());
    });

    const rows: string[][] = [];
    const rowSelector = headers.length ? "tbody tr, tr:not(:first-child)" : "tr";
    table.find(rowSelector).each((_j, tr) => {
      const cells: string[] = [];
      $(tr)
        .find("td, th")
        .each((_k, td) => {
          cells.push($(td).text().trim());
        });
      if (cells.length) rows.push(cells);
    });

    if (rows.length || headers.length) {
      tables.push({ headers, rows, caption });
    }
  });

  return tables;
}

// ── User-defined field extraction ───────────────────────────────────────────

export function extractFields(
  $: cheerio.CheerioAPI,
  fields: ScrapingField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.selectorStrategy === "ai-extract") continue; // handled by ai_extractor

    const rawValues = extractFieldValues($, field);

    if (field.type === "array") {
      result[field.name] = rawValues.map((v) => applyTransform(v, field.transform));
    } else {
      const value = rawValues[0] ?? field.defaultValue ?? null;
      result[field.name] = applyTransform(value, field.transform);
    }

    // Nested extraction
    if (field.nested?.length && field.selector) {
      const nested: Record<string, unknown>[] = [];
      $(field.selector).each((_i, container) => {
        const sub$: any = cheerio.load($.html(container));
        nested.push(extractFields(sub$, field.nested!));
      });
      result[field.name] = nested;
    }
  }

  return result;
}

function extractFieldValues($: cheerio.CheerioAPI, field: ScrapingField): string[] {
  if (!field.selector) return [];
  const values: string[] = [];

  $(field.selector).each((_i, el) => {
    let value: string;
    if (field.attribute) {
      value = $(el).attr(field.attribute) || "";
    } else if (field.type === "html") {
      value = $(el).html() || "";
    } else {
      value = $(el).text().trim();
    }
    if (value) values.push(value);
  });

  return values;
}

function applyTransform(value: string | null, transform?: string): unknown {
  if (!value || !transform) return value;

  switch (transform) {
    case "trim":
      return value.trim();
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "number":
      return parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
    case "boolean":
      return ["true", "yes", "1"].includes(value.toLowerCase());
    default:
      // regex: pattern
      if (transform.startsWith("regex:")) {
        const pattern = transform.slice(6);
        const match = value.match(new RegExp(pattern));
        return match?.[1] ?? match?.[0] ?? value;
      }
      return value;
  }
}

// ── Feed parsing (RSS / Atom) ───────────────────────────────────────────────

export interface FeedItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  guid?: string;
  categories?: string[];
  enclosureUrl?: string;
  enclosureType?: string;
}

export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: FeedItem[] = [];

  // RSS 2.0
  $("item").each((_i, el) => {
    const item = $(el);
    items.push({
      title: item.find("title").first().text().trim(),
      link: item.find("link").first().text().trim(),
      description: item.find("description").first().text().trim() || undefined,
      pubDate: item.find("pubDate").first().text().trim() || undefined,
      author: item.find("author, dc\\:creator").first().text().trim() || undefined,
      guid: item.find("guid").first().text().trim() || undefined,
      categories: item.find("category").map((_j, c) => $(c).text().trim()).get(),
      enclosureUrl: item.find("enclosure").attr("url") || undefined,
      enclosureType: item.find("enclosure").attr("type") || undefined,
    });
  });

  // Atom
  if (!items.length) {
    $("entry").each((_i, el) => {
      const entry = $(el);
      items.push({
        title: entry.find("title").first().text().trim(),
        link: entry.find('link[rel="alternate"]').attr("href")
          || entry.find("link").first().attr("href")
          || "",
        description: entry.find("summary, content").first().text().trim() || undefined,
        pubDate: entry.find("published, updated").first().text().trim() || undefined,
        author: entry.find("author name").first().text().trim() || undefined,
        guid: entry.find("id").first().text().trim() || undefined,
        categories: entry.find("category").map((_j, c) => $(c).attr("term") || $(c).text().trim()).get(),
      });
    });
  }

  return items;
}

// ── Sitemap parsing ─────────────────────────────────────────────────────────

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export function parseSitemap(xml: string): SitemapUrl[] {
  const $ = cheerio.load(xml, { xml: true });
  const urls: SitemapUrl[] = [];

  $("url").each((_i, el) => {
    const loc = $(el).find("loc").text().trim();
    if (loc) {
      urls.push({
        loc,
        lastmod: $(el).find("lastmod").text().trim() || undefined,
        changefreq: $(el).find("changefreq").text().trim() || undefined,
        priority: $(el).find("priority").text().trim() || undefined,
      });
    }
  });

  // Sitemap index
  $("sitemap").each((_i, el) => {
    const loc = $(el).find("loc").text().trim();
    if (loc) {
      urls.push({ loc, lastmod: $(el).find("lastmod").text().trim() || undefined });
    }
  });

  return urls;
}

// ── Site name extraction ────────────────────────────────────────────────────

function extractSiteName($: cheerio.CheerioAPI): string | undefined {
  const ogSite = $('meta[property="og:site_name"]').attr("content");
  if (ogSite) return ogSite.trim();

  const appName = $('meta[name="application-name"]').attr("content");
  if (appName) return appName.trim();

  return undefined;
}

// ── URL resolution ──────────────────────────────────────────────────────────

function resolveUrl(href: string, baseUrl: string): string | null {
  if (!href || href.startsWith("data:") || href.startsWith("javascript:") || href.startsWith("#")) {
    return null;
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}
