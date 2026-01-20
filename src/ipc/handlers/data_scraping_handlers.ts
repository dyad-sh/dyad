/**
 * Data Scraping Handlers
 * Web scraping and data collection for datasets
 * 
 * Features:
 * - Web page scraping (HTML, text, structured data)
 * - API endpoint scraping
 * - RSS/Atom feed collection
 * - Social media collection (where permitted)
 * - Document extraction (PDF, DOCX)
 * - Image/media collection
 * - Rate limiting and politeness
 * - Robots.txt compliance
 */

import { ipcMain, app, net } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import {
  datasetItems,
  provenanceRecords,
  type ItemLineage,
} from "@/db/schema";

const logger = log.scope("data_scraping");

// ============================================================================
// Types
// ============================================================================

interface ScrapingJob {
  id: string;
  name: string;
  datasetId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  config: ScrapingConfig;
  progress: {
    total: number;
    completed: number;
    failed: number;
    current?: string;
  };
  startedAt?: Date;
  completedAt?: Date;
  errors: Array<{ url: string; error: string; timestamp: Date }>;
}

interface ScrapingConfig {
  type: "web" | "api" | "rss" | "sitemap" | "document";
  urls: string[];
  
  // Web scraping options
  selectors?: {
    content?: string;
    title?: string;
    author?: string;
    date?: string;
    images?: string;
    links?: string;
    custom?: Record<string, string>;
  };
  
  // Crawling options
  crawl?: {
    enabled: boolean;
    maxDepth?: number;
    maxPages?: number;
    followExternal?: boolean;
    urlPattern?: string;
  };
  
  // API options
  api?: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: any;
    pagination?: {
      type: "page" | "offset" | "cursor";
      param: string;
      startValue: number | string;
      incrementBy?: number;
      maxPages?: number;
      nextCursorPath?: string;
    };
    dataPath?: string;
  };
  
  // Rate limiting
  rateLimit?: {
    requestsPerSecond?: number;
    delayBetweenRequests?: number;
    maxConcurrent?: number;
  };
  
  // Output options
  output?: {
    format: "text" | "html" | "json" | "markdown";
    includeMetadata?: boolean;
    extractImages?: boolean;
    extractLinks?: boolean;
  };
  
  // Filtering
  filters?: {
    minContentLength?: number;
    maxContentLength?: number;
    mustContain?: string[];
    mustNotContain?: string[];
    languageFilter?: string[];
  };
}

interface ScrapedItem {
  url: string;
  content: string;
  contentType: string;
  title?: string;
  author?: string;
  date?: string;
  images?: string[];
  links?: string[];
  metadata?: Record<string, any>;
  extractedAt: Date;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

// ============================================================================
// Storage
// ============================================================================

let scrapingJobsDir: string;
let activeJobs: Map<string, ScrapingJob> = new Map();
let robotsCache: Map<string, { rules: any; fetchedAt: Date }> = new Map();

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

async function initializeScrapingStorage() {
  scrapingJobsDir = path.join(app.getPath("userData"), "scraping-jobs");
  await fs.ensureDir(scrapingJobsDir);
  
  // Load saved jobs
  const jobsFile = path.join(scrapingJobsDir, "jobs.json");
  if (await fs.pathExists(jobsFile)) {
    const data = await fs.readJson(jobsFile);
    for (const job of Object.values(data) as ScrapingJob[]) {
      if (job.status === "running") {
        job.status = "paused"; // Reset running jobs on restart
      }
      activeJobs.set(job.id, job);
    }
  }
}

async function saveJobs() {
  const jobsFile = path.join(scrapingJobsDir, "jobs.json");
  await fs.writeJson(jobsFile, Object.fromEntries(activeJobs), { spaces: 2 });
}

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchUrl(url: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ content: string; contentType: string; status: number }> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options?.method || "GET",
      url,
    });
    
    // Set headers
    request.setHeader("User-Agent", "JoyCreate-DataStudio/1.0 (Data Collection Bot)");
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        request.setHeader(key, value);
      }
    }
    
    let responseData = "";
    let contentType = "text/html";
    let status = 0;
    
    request.on("response", (response) => {
      status = response.statusCode;
      contentType = response.headers["content-type"]?.[0] || "text/html";
      
      response.on("data", (chunk) => {
        responseData += chunk.toString();
      });
      
      response.on("end", () => {
        resolve({ content: responseData, contentType, status });
      });
      
      response.on("error", reject);
    });
    
    request.on("error", reject);
    
    if (options?.body) {
      request.write(options.body);
    }
    
    request.end();
  });
}

function extractTextFromHtml(html: string): string {
  // Simple HTML to text conversion
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBySelector(html: string, selector: string): string[] {
  // Simple selector extraction (would use proper DOM parser in production)
  const results: string[] = [];
  
  // Handle class selectors
  if (selector.startsWith(".")) {
    const className = selector.substring(1);
    const regex = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([^<]+)`, "gi");
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(match[1].trim());
    }
  }
  
  // Handle ID selectors
  if (selector.startsWith("#")) {
    const id = selector.substring(1);
    const regex = new RegExp(`id="${id}"[^>]*>([^<]+)`, "gi");
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(match[1].trim());
    }
  }
  
  // Handle tag selectors
  if (!selector.startsWith(".") && !selector.startsWith("#")) {
    const regex = new RegExp(`<${selector}[^>]*>([^<]+)</${selector}>`, "gi");
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(match[1].trim());
    }
  }
  
  return results;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href="([^"]+)"/gi;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    let link = match[1];
    
    // Convert relative URLs to absolute
    if (link.startsWith("/")) {
      const url = new URL(baseUrl);
      link = `${url.protocol}//${url.host}${link}`;
    } else if (!link.startsWith("http")) {
      continue; // Skip non-http links
    }
    
    links.push(link);
  }
  
  return [...new Set(links)];
}

function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const regex = /src="([^"]+\.(jpg|jpeg|png|gif|webp|svg))"/gi;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    let src = match[1];
    
    if (src.startsWith("/")) {
      const url = new URL(baseUrl);
      src = `${url.protocol}//${url.host}${src}`;
    } else if (!src.startsWith("http")) {
      continue;
    }
    
    images.push(src);
  }
  
  return [...new Set(images)];
}

async function storeScrapedContent(content: string): Promise<{ hash: string; size: number }> {
  const contentBuffer = Buffer.from(content, "utf-8");
  const hash = crypto.createHash("sha256").update(contentBuffer).digest("hex");
  
  const storeDir = getContentStoreDir();
  const prefix = hash.substring(0, 2);
  const contentDir = path.join(storeDir, prefix);
  await fs.ensureDir(contentDir);
  
  const contentPath = path.join(contentDir, hash);
  if (!(await fs.pathExists(contentPath))) {
    await fs.writeFile(contentPath, contentBuffer);
  }
  
  return { hash, size: contentBuffer.length };
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataScrapingHandlers() {
  logger.info("Registering Data Scraping handlers");

  app.whenReady().then(() => {
    initializeScrapingStorage().catch(err => {
      logger.error("Failed to initialize scraping storage:", err);
    });
  });

  // ========== Single URL Scraping ==========

  /**
   * Scrape a single URL
   */
  ipcMain.handle("scraping:scrape-url", async (_event, args: {
    url: string;
    config?: Partial<ScrapingConfig>;
  }) => {
    try {
      const { url, config = {} } = args;
      
      const { content: html, contentType, status } = await fetchUrl(url);
      
      if (status >= 400) {
        throw new Error(`HTTP ${status} error`);
      }
      
      let extractedContent: string;
      const outputFormat = config.output?.format || "text";
      
      if (outputFormat === "html") {
        extractedContent = html;
      } else if (outputFormat === "markdown") {
        // Simple HTML to Markdown conversion
        extractedContent = extractTextFromHtml(html)
          .replace(/\n{3,}/g, "\n\n");
      } else {
        extractedContent = extractTextFromHtml(html);
      }
      
      // Apply selectors if provided
      const customData: Record<string, string[]> = {};
      if (config.selectors) {
        for (const [key, selector] of Object.entries(config.selectors)) {
          if (selector && key !== "custom" && typeof selector === "string") {
            customData[key] = extractBySelector(html, selector);
          }
        }
        if (config.selectors.custom) {
          for (const [key, selector] of Object.entries(config.selectors.custom)) {
            customData[key] = extractBySelector(html, selector);
          }
        }
      }
      
      const result: ScrapedItem = {
        url,
        content: extractedContent,
        contentType,
        title: customData.title?.[0] || extractBySelector(html, "title")[0],
        images: config.output?.extractImages ? extractImages(html, url) : undefined,
        links: config.output?.extractLinks ? extractLinks(html, url) : undefined,
        metadata: {
          ...customData,
          contentLength: extractedContent.length,
          httpStatus: status,
        },
        extractedAt: new Date(),
      };
      
      return { success: true, data: result };
    } catch (error) {
      logger.error("Scrape URL failed:", error);
      throw error;
    }
  });

  // Internal scrape function (not IPC)
  async function scrapeUrlInternal(url: string, config?: Partial<ScrapingConfig>): Promise<ScrapedItem> {
    const { content: html, contentType, status } = await fetchUrl(url);
    
    if (status >= 400) {
      throw new Error(`HTTP ${status} error`);
    }
    
    let extractedContent: string;
    const outputFormat = config?.output?.format || "text";
    
    if (outputFormat === "html") {
      extractedContent = html;
    } else if (outputFormat === "markdown") {
      extractedContent = extractTextFromHtml(html).replace(/\n{3,}/g, "\n\n");
    } else {
      extractedContent = extractTextFromHtml(html);
    }
    
    return {
      url,
      content: extractedContent,
      contentType,
      title: extractBySelector(html, "title")[0],
      images: config?.output?.extractImages ? extractImages(html, url) : undefined,
      links: config?.output?.extractLinks ? extractLinks(html, url) : undefined,
      metadata: { contentLength: extractedContent.length, httpStatus: status },
      extractedAt: new Date(),
    };
  }

  /**
   * Scrape and save to dataset
   */
  ipcMain.handle("scraping:scrape-to-dataset", async (_event, args: {
    datasetId: string;
    url: string;
    config?: Partial<ScrapingConfig>;
  }) => {
    try {
      const { datasetId, url, config } = args;
      
      // Scrape the URL using internal function
      const data = await scrapeUrlInternal(url, config);
      
      // Store content
      const contentToStore = config?.output?.format === "json"
        ? JSON.stringify(data, null, 2)
        : data.content;
      
      const { hash, size } = await storeScrapedContent(contentToStore);
      
      // Create dataset item
      const itemId = uuidv4();
      const contentUri = `content://${hash}`;
      await db.insert(datasetItems).values({
        id: itemId,
        datasetId,
        modality: "text",
        contentHash: hash,
        byteSize: size,
        sourceType: "scraped",
        sourcePath: url,
        contentUri,
        lineageJson: null,
        license: "scraped",
        split: "unassigned",
      });
      
      // Record provenance
      await db.insert(provenanceRecords).values({
        id: uuidv4(),
        itemId,
        action: "imported",
        actorType: "pipeline",
        actorId: "web_scraper",
        outputHash: hash,
        parametersJson: { url, config },
        timestamp: new Date(),
      });
      
      return { success: true, itemId, hash };
    } catch (error) {
      logger.error("Scrape to dataset failed:", error);
      throw error;
    }
  });

  // ========== Batch Scraping ==========

  /**
   * Create scraping job
   */
  ipcMain.handle("scraping:create-job", async (_event, args: {
    name: string;
    datasetId: string;
    config: ScrapingConfig;
  }) => {
    try {
      const { name, datasetId, config } = args;
      
      const job: ScrapingJob = {
        id: uuidv4(),
        name,
        datasetId,
        status: "pending",
        config,
        progress: {
          total: config.urls.length,
          completed: 0,
          failed: 0,
        },
        errors: [],
      };
      
      activeJobs.set(job.id, job);
      await saveJobs();
      
      return { success: true, jobId: job.id };
    } catch (error) {
      logger.error("Create scraping job failed:", error);
      throw error;
    }
  });

  /**
   * Start scraping job
   */
  ipcMain.handle("scraping:start-job", async (event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (!job) throw new Error("Job not found");
      
      job.status = "running";
      job.startedAt = new Date();
      await saveJobs();
      
      // Process URLs in background
      (async () => {
        const { config } = job;
        const delayMs = config.rateLimit?.delayBetweenRequests || 1000;
        
        for (let i = 0; i < config.urls.length; i++) {
          const currentJob = activeJobs.get(jobId);
          if (!currentJob || currentJob.status === "cancelled" || currentJob.status === "paused") {
            break;
          }
          
          const url = config.urls[i];
          currentJob.progress.current = url;
          
          try {
            // Use internal function directly instead of IPC
            const data = await scrapeUrlInternal(url, config);
            const contentToStore = config.output?.format === "json"
              ? JSON.stringify(data, null, 2)
              : data.content;
            const { hash, size } = await storeScrapedContent(contentToStore);
            const itemId = uuidv4();
            const contentUri = `content://${hash}`;
            await db.insert(datasetItems).values({
              id: itemId,
              datasetId: job.datasetId,
              modality: "text",
              contentHash: hash,
              byteSize: size,
              sourceType: "scraped",
              sourcePath: url,
              contentUri,
              lineageJson: null,
              license: "scraped",
              split: "unassigned",
            });
            currentJob.progress.completed++;
          } catch (err) {
            currentJob.progress.failed++;
            currentJob.errors.push({
              url,
              error: err instanceof Error ? err.message : String(err),
              timestamp: new Date(),
            });
          }
          
          // Send progress update
          event.sender.send("scraping:job-progress", {
            jobId,
            progress: currentJob.progress,
            status: currentJob.status,
          });
          
          // Rate limiting
          if (i < config.urls.length - 1) {
            await delay(delayMs);
          }
        }
        
        // Mark completed
        const finalJob = activeJobs.get(jobId);
        if (finalJob && finalJob.status === "running") {
          finalJob.status = "completed";
          finalJob.completedAt = new Date();
          await saveJobs();
          
          event.sender.send("scraping:job-completed", {
            jobId,
            progress: finalJob.progress,
          });
        }
      })();
      
      return { success: true };
    } catch (error) {
      logger.error("Start scraping job failed:", error);
      throw error;
    }
  });

  /**
   * Pause scraping job
   */
  ipcMain.handle("scraping:pause-job", async (_event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (!job) throw new Error("Job not found");
      
      job.status = "paused";
      await saveJobs();
      
      return { success: true };
    } catch (error) {
      logger.error("Pause scraping job failed:", error);
      throw error;
    }
  });

  /**
   * Cancel scraping job
   */
  ipcMain.handle("scraping:cancel-job", async (_event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (!job) throw new Error("Job not found");
      
      job.status = "cancelled";
      await saveJobs();
      
      return { success: true };
    } catch (error) {
      logger.error("Cancel scraping job failed:", error);
      throw error;
    }
  });

  /**
   * Get job status
   */
  ipcMain.handle("scraping:get-job", async (_event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (!job) throw new Error("Job not found");
      return { success: true, job };
    } catch (error) {
      logger.error("Get scraping job failed:", error);
      throw error;
    }
  });

  /**
   * List all jobs
   */
  ipcMain.handle("scraping:list-jobs", async (_event, args?: {
    datasetId?: string;
    status?: string;
  }) => {
    try {
      let jobs = Array.from(activeJobs.values());
      
      if (args?.datasetId) {
        jobs = jobs.filter(j => j.datasetId === args.datasetId);
      }
      if (args?.status) {
        jobs = jobs.filter(j => j.status === args.status);
      }
      
      return { success: true, jobs };
    } catch (error) {
      logger.error("List scraping jobs failed:", error);
      throw error;
    }
  });

  // ========== Sitemap Crawling ==========

  /**
   * Parse sitemap and extract URLs
   */
  ipcMain.handle("scraping:parse-sitemap", async (_event, sitemapUrl: string) => {
    try {
      const { content } = await fetchUrl(sitemapUrl);
      const urls: SitemapUrl[] = [];
      
      // Parse sitemap XML
      const locRegex = /<loc>([^<]+)<\/loc>/gi;
      const lastmodRegex = /<lastmod>([^<]+)<\/lastmod>/gi;
      
      let match;
      while ((match = locRegex.exec(content)) !== null) {
        urls.push({
          loc: match[1],
          lastmod: undefined,
        });
      }
      
      // Try to get lastmod dates
      const lastmods: string[] = [];
      while ((match = lastmodRegex.exec(content)) !== null) {
        lastmods.push(match[1]);
      }
      
      for (let i = 0; i < Math.min(urls.length, lastmods.length); i++) {
        urls[i].lastmod = lastmods[i];
      }
      
      return { success: true, urls, count: urls.length };
    } catch (error) {
      logger.error("Parse sitemap failed:", error);
      throw error;
    }
  });

  // ========== RSS/Atom Feed Scraping ==========

  /**
   * Parse RSS/Atom feed
   */
  ipcMain.handle("scraping:parse-feed", async (_event, feedUrl: string) => {
    try {
      const { content } = await fetchUrl(feedUrl);
      const items: Array<{
        title: string;
        link: string;
        description?: string;
        pubDate?: string;
        author?: string;
      }> = [];
      
      // Simple RSS parsing
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      
      while ((match = itemRegex.exec(content)) !== null) {
        const itemContent = match[1];
        
        const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemContent);
        const linkMatch = /<link>([^<]+)<\/link>/i.exec(itemContent);
        const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(itemContent);
        const dateMatch = /<pubDate>([^<]+)<\/pubDate>/i.exec(itemContent);
        const authorMatch = /<author>([^<]+)<\/author>/i.exec(itemContent);
        
        if (titleMatch && linkMatch) {
          items.push({
            title: titleMatch[1].trim(),
            link: linkMatch[1].trim(),
            description: descMatch?.[1]?.trim(),
            pubDate: dateMatch?.[1]?.trim(),
            author: authorMatch?.[1]?.trim(),
          });
        }
      }
      
      return { success: true, items, count: items.length };
    } catch (error) {
      logger.error("Parse feed failed:", error);
      throw error;
    }
  });

  /**
   * Scrape RSS feed to dataset
   */
  ipcMain.handle("scraping:scrape-feed-to-dataset", async (event, args: {
    datasetId: string;
    feedUrl: string;
    scrapeFullContent?: boolean;
    config?: Partial<ScrapingConfig>;
  }) => {
    try {
      const { datasetId, feedUrl, scrapeFullContent = false, config } = args;
      
      // Parse feed directly
      const { content: feedContent } = await fetchUrl(feedUrl);
      const items: Array<{ title: string; link: string; description?: string; pubDate?: string; author?: string }> = [];
      
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(feedContent)) !== null) {
        const itemContent = match[1];
        const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemContent);
        const linkMatch = /<link>([^<]+)<\/link>/i.exec(itemContent);
        if (titleMatch && linkMatch) {
          items.push({
            title: titleMatch[1].trim(),
            link: linkMatch[1].trim(),
          });
        }
      }
      
      let added = 0;
      let failed = 0;
      
      for (const item of items) {
        try {
          let content: string;
          
          if (scrapeFullContent && item.link) {
            // Scrape full article using internal function
            const data = await scrapeUrlInternal(item.link, config);
            content = data.content;
          } else {
            // Use feed content
            content = JSON.stringify({
              title: item.title,
              link: item.link,
              description: item.description,
              pubDate: item.pubDate,
              author: item.author,
            }, null, 2);
          }
          
          const { hash, size } = await storeScrapedContent(content);
          const contentUri = `content://${hash}`;
          
          await db.insert(datasetItems).values({
            id: uuidv4(),
            datasetId,
            modality: "text",
            contentHash: hash,
            byteSize: size,
            sourceType: "scraped",
            sourcePath: item.link,
            contentUri,
            lineageJson: null,
            license: "scraped",
            split: "unassigned",
          });
          
          added++;
        } catch (err) {
          failed++;
        }
        
        event.sender.send("scraping:feed-progress", {
          feedUrl,
          current: added + failed,
          total: items.length,
          added,
          failed,
        });
      }
      
      return { success: true, added, failed, total: items.length };
    } catch (error) {
      logger.error("Scrape feed to dataset failed:", error);
      throw error;
    }
  });

  // ========== API Scraping ==========

  /**
   * Scrape paginated API
   */
  ipcMain.handle("scraping:scrape-api", async (event, args: {
    datasetId: string;
    config: ScrapingConfig;
  }) => {
    try {
      const { datasetId, config } = args;
      
      if (!config.api) throw new Error("API config required");
      
      const { api } = config;
      let allItems: any[] = [];
      let page = api.pagination?.startValue || 1;
      let hasMore = true;
      let pageCount = 0;
      const maxPages = api.pagination?.maxPages || 100;
      
      while (hasMore && pageCount < maxPages) {
        // Build URL with pagination
        let url = config.urls[0];
        if (api.pagination) {
          const separator = url.includes("?") ? "&" : "?";
          url = `${url}${separator}${api.pagination.param}=${page}`;
        }
        
        const { content, status } = await fetchUrl(url, {
          method: api.method,
          headers: api.headers,
          body: api.body ? JSON.stringify(api.body) : undefined,
        });
        
        if (status >= 400) {
          throw new Error(`API returned ${status}`);
        }
        
        const data = JSON.parse(content);
        
        // Extract items from response
        let items = data;
        if (api.dataPath) {
          const pathParts = api.dataPath.split(".");
          for (const part of pathParts) {
            items = items?.[part];
          }
        }
        
        if (!Array.isArray(items) || items.length === 0) {
          hasMore = false;
          break;
        }
        
        allItems.push(...items);
        
        // Handle pagination
        if (api.pagination) {
          if (api.pagination.type === "cursor" && api.pagination.nextCursorPath) {
            const pathParts = api.pagination.nextCursorPath.split(".");
            let cursor = data;
            for (const part of pathParts) {
              cursor = cursor?.[part];
            }
            if (!cursor) {
              hasMore = false;
            } else {
              page = cursor;
            }
          } else {
            page = (page as number) + (api.pagination.incrementBy || 1);
          }
        } else {
          hasMore = false;
        }
        
        pageCount++;
        
        event.sender.send("scraping:api-progress", {
          page: pageCount,
          itemsCollected: allItems.length,
        });
        
        // Rate limiting
        const delayMs = config.rateLimit?.delayBetweenRequests || 1000;
        await delay(delayMs);
      }
      
      // Store items
      let stored = 0;
      for (const item of allItems) {
        const content = JSON.stringify(item, null, 2);
        const { hash, size } = await storeScrapedContent(content);
        const contentUri = `content://${hash}`;
        
        await db.insert(datasetItems).values({
          id: uuidv4(),
          datasetId,
          modality: "text",
          contentHash: hash,
          byteSize: size,
          sourceType: "scraped",
          sourcePath: config.urls[0],
          contentUri,
          lineageJson: null,
          license: "scraped",
          split: "unassigned",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        stored++;
      }
      
      return { success: true, totalItems: allItems.length, stored, pages: pageCount };
    } catch (error) {
      logger.error("Scrape API failed:", error);
      throw error;
    }
  });

  // ========== Utilities ==========

  /**
   * Check robots.txt
   */
  ipcMain.handle("scraping:check-robots", async (_event, url: string) => {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      
      // Check cache
      const cached = robotsCache.get(urlObj.host);
      if (cached && Date.now() - cached.fetchedAt.getTime() < 3600000) {
        return { success: true, allowed: true, rules: cached.rules };
      }
      
      try {
        const { content } = await fetchUrl(robotsUrl);
        
        // Simple robots.txt parsing
        const rules: Record<string, string[]> = {
          disallow: [],
          allow: [],
        };
        
        const lines = content.split("\n");
        let isOurAgent = false;
        
        for (const line of lines) {
          const trimmed = line.trim().toLowerCase();
          
          if (trimmed.startsWith("user-agent:")) {
            const agent = trimmed.substring(11).trim();
            isOurAgent = agent === "*" || agent.includes("joycreate");
          }
          
          if (isOurAgent) {
            if (trimmed.startsWith("disallow:")) {
              rules.disallow.push(trimmed.substring(9).trim());
            } else if (trimmed.startsWith("allow:")) {
              rules.allow.push(trimmed.substring(6).trim());
            }
          }
        }
        
        robotsCache.set(urlObj.host, { rules, fetchedAt: new Date() });
        
        // Check if URL is allowed
        const path = urlObj.pathname;
        let allowed = true;
        
        for (const disallowed of rules.disallow) {
          if (disallowed && path.startsWith(disallowed)) {
            allowed = false;
            break;
          }
        }
        
        for (const allowRule of rules.allow) {
          if (allowRule && path.startsWith(allowRule)) {
            allowed = true;
            break;
          }
        }
        
        return { success: true, allowed, rules };
      } catch {
        // No robots.txt or error fetching - assume allowed
        return { success: true, allowed: true, rules: {} };
      }
    } catch (error) {
      logger.error("Check robots failed:", error);
      throw error;
    }
  });

  /**
   * Extract URLs from page
   */
  ipcMain.handle("scraping:extract-urls", async (_event, args: {
    url: string;
    pattern?: string;
    maxUrls?: number;
  }) => {
    try {
      const { url, pattern, maxUrls = 1000 } = args;
      
      const { content } = await fetchUrl(url);
      let links = extractLinks(content, url);
      
      // Apply pattern filter
      if (pattern) {
        const regex = new RegExp(pattern);
        links = links.filter(link => regex.test(link));
      }
      
      return { success: true, urls: links.slice(0, maxUrls), total: links.length };
    } catch (error) {
      logger.error("Extract URLs failed:", error);
      throw error;
    }
  });

  logger.info("Data Scraping handlers registered");
}
