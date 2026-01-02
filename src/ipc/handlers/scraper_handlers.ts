/**
 * Data Scraper & Dataset IPC Handlers
 * Local-first web scraping and dataset management
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { db } from "@/db";
import type {
  ScrapingConfig,
  ScrapingJob,
  ScrapingStatus,
  Dataset,
  DatasetPreview,
  DatasetField,
  ScrapingField,
  ScraperStatus,
  DatasetExportOptions,
  AIExtractionResult,
  ScrapingTemplate,
} from "@/types/scraper_types";

const logger = log.scope("scraper_handlers");

// In-memory job tracking
const activeJobs: Map<string, ScrapingJob> = new Map();
const jobQueue: string[] = [];

// Chromium/Puppeteer status
let chromiumPath: string | null = null;

/**
 * Get the data directory for scraper
 */
function getScraperDataDir(): string {
  return path.join(app.getPath("userData"), "scraper-data");
}

/**
 * Get datasets directory
 */
function getDatasetsDir(): string {
  return path.join(getScraperDataDir(), "datasets");
}

/**
 * Get configs directory
 */
function getConfigsDir(): string {
  return path.join(getScraperDataDir(), "configs");
}

/**
 * Get jobs directory
 */
function getJobsDir(): string {
  return path.join(getScraperDataDir(), "jobs");
}

/**
 * Initialize scraper directories
 */
async function initScraperDirs() {
  await fs.ensureDir(getScraperDataDir());
  await fs.ensureDir(getDatasetsDir());
  await fs.ensureDir(getConfigsDir());
  await fs.ensureDir(getJobsDir());
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Simple HTTP fetch with options
 */
async function fetchPage(url: string, options: {
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
} = {}): Promise<{ html: string; status: number; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": options.userAgent || "JoyCreate-Scraper/1.0",
        ...options.headers,
      },
    });
    
    const html = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    return {
      html,
      status: response.status,
      headers,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse HTML and extract data using CSS selectors
 */
function extractWithSelector(html: string, selector: string, attribute?: string): string[] {
  // Simple regex-based extraction for common patterns
  // In production, use cheerio or JSDOM
  const results: string[] = [];
  
  if (selector.startsWith("//")) {
    // XPath - not supported in simple mode
    logger.warn("XPath selectors require full browser mode");
    return results;
  }
  
  // Basic CSS selector patterns
  const tagMatch = selector.match(/^(\w+)/);
  const classMatch = selector.match(/\.([^\s.#\[]+)/g);
  const idMatch = selector.match(/#([^\s.#\[]+)/);
  
  // Very simple extraction - for proper extraction use cheerio
  if (tagMatch) {
    const tag = tagMatch[1];
    const regex = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, "gis");
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (attribute === "href") {
        const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
        if (hrefMatch) results.push(hrefMatch[1]);
      } else if (attribute === "src") {
        const srcMatch = match[0].match(/src=["']([^"']+)["']/i);
        if (srcMatch) results.push(srcMatch[1]);
      } else {
        // Extract text content
        const text = match[1].replace(/<[^>]+>/g, "").trim();
        if (text) results.push(text);
      }
    }
  }
  
  return results;
}

/**
 * Extract data from HTML using field configuration
 */
function extractFields(html: string, fields: ScrapingField[]): Record<string, any> {
  const data: Record<string, any> = {};
  
  for (const field of fields) {
    try {
      const values = extractWithSelector(html, field.selector, field.attribute);
      
      if (field.type === "array") {
        data[field.name] = values;
      } else {
        data[field.name] = values[0] || field.defaultValue || null;
      }
      
      // Type conversion
      if (field.type === "number" && data[field.name] !== null) {
        data[field.name] = parseFloat(String(data[field.name]).replace(/[^0-9.-]/g, "")) || null;
      } else if (field.type === "boolean" && data[field.name] !== null) {
        data[field.name] = ["true", "1", "yes"].includes(String(data[field.name]).toLowerCase());
      }
    } catch (error) {
      logger.warn(`Failed to extract field ${field.name}:`, error);
      data[field.name] = field.defaultValue || null;
    }
  }
  
  return data;
}

/**
 * AI-powered extraction using local or API model
 */
async function aiExtract(
  html: string,
  fields: ScrapingField[],
  config: ScrapingConfig["aiExtraction"]
): Promise<AIExtractionResult> {
  // This would integrate with the existing language model system
  // For now, return a placeholder
  logger.info("AI extraction requested - using fallback to selector-based extraction");
  
  return {
    success: false,
    data: {},
    confidence: 0,
  };
}

/**
 * Run a scraping job
 */
async function runScrapingJob(job: ScrapingJob, config: ScrapingConfig): Promise<void> {
  logger.info(`Starting scraping job ${job.id} for config ${config.name}`);
  
  job.status = "running";
  job.stats.startedAt = new Date().toISOString();
  activeJobs.set(job.id, job);
  
  const results: Record<string, any>[] = [];
  const errors: { url: string; message: string; timestamp: string }[] = [];
  
  // Get URLs to scrape
  let urls: string[] = [];
  if (config.sourceUrl) {
    urls = [config.sourceUrl];
  } else if (config.sourceUrls) {
    urls = config.sourceUrls;
  }
  
  // Apply max pages limit
  if (config.maxPages && urls.length > config.maxPages) {
    urls = urls.slice(0, config.maxPages);
  }
  
  job.progress.total = urls.length;
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    
    // Check if job was cancelled (re-check from map to get latest status)
    const currentJob = activeJobs.get(job.id);
    if (currentJob && (currentJob.status === "cancelled" || currentJob.status === "paused")) {
      break;
    }
    
    try {
      // Add delay between requests
      if (i > 0 && config.delay) {
        await new Promise(resolve => setTimeout(resolve, config.delay));
      }
      
      // Fetch page
      const { html, status } = await fetchPage(url, {
        timeout: config.timeout,
        userAgent: config.userAgent,
      });
      
      if (status !== 200) {
        throw new Error(`HTTP ${status}`);
      }
      
      // Extract data
      let data: Record<string, any>;
      
      if (config.aiExtraction?.enabled) {
        const aiResult = await aiExtract(html, config.fields, config.aiExtraction);
        if (aiResult.success) {
          data = aiResult.data;
        } else {
          data = extractFields(html, config.fields);
        }
      } else {
        data = extractFields(html, config.fields);
      }
      
      // Add source URL
      data._sourceUrl = url;
      data._scrapedAt = new Date().toISOString();
      
      results.push(data);
      job.progress.completed++;
      job.stats.pagesScraped = (job.stats.pagesScraped || 0) + 1;
      job.stats.itemsExtracted = results.length;
      
    } catch (error) {
      logger.error(`Failed to scrape ${url}:`, error);
      errors.push({
        url,
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
      job.progress.failed++;
      job.stats.errorsCount = (job.stats.errorsCount || 0) + 1;
    }
    
    // Update job in memory
    activeJobs.set(job.id, { ...job });
  }
  
  // Save results as dataset
  if (results.length > 0) {
    const dataset = await createDatasetFromResults(job, config, results);
    job.outputDatasetId = dataset.id;
  }
  
  // Update job status
  job.status = job.progress.failed === job.progress.total ? "failed" : "completed";
  job.stats.completedAt = new Date().toISOString();
  job.stats.duration = Date.now() - new Date(job.stats.startedAt!).getTime();
  job.errors = errors.length > 0 ? errors : undefined;
  
  // Save job to disk
  const jobPath = path.join(getJobsDir(), `${job.id}.json`);
  await fs.writeJson(jobPath, job, { spaces: 2 });
  
  // Remove from active jobs
  activeJobs.delete(job.id);
  
  logger.info(`Completed scraping job ${job.id}: ${results.length} items extracted`);
}

/**
 * Create dataset from scraping results
 */
async function createDatasetFromResults(
  job: ScrapingJob,
  config: ScrapingConfig,
  results: Record<string, any>[]
): Promise<Dataset> {
  const datasetId = generateId();
  const datasetDir = getDatasetsDir();
  const filePath = path.join(datasetDir, `${datasetId}.json`);
  
  // Infer schema from results
  const schema: DatasetField[] = [];
  if (results.length > 0) {
    const sample = results[0];
    for (const [key, value] of Object.entries(sample)) {
      schema.push({
        name: key,
        type: inferFieldType(value),
        nullable: true,
        sampleValues: results.slice(0, 5).map(r => r[key]),
      });
    }
  }
  
  // Save data
  await fs.writeJson(filePath, results, { spaces: 2 });
  const stats = await fs.stat(filePath);
  
  const dataset: Dataset = {
    id: datasetId,
    name: `${config.name} - ${new Date().toLocaleDateString()}`,
    description: `Scraped from ${config.sourceUrl || "multiple URLs"}`,
    sourceType: "scraping",
    sourceJobId: job.id,
    schema,
    stats: {
      rowCount: results.length,
      columnCount: schema.length,
      sizeBytes: stats.size,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    format: "json",
    filePath,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  // Save dataset metadata
  const metaPath = path.join(datasetDir, `${datasetId}.meta.json`);
  await fs.writeJson(metaPath, dataset, { spaces: 2 });
  
  return dataset;
}

/**
 * Infer field type from value
 */
function inferFieldType(value: any): "text" | "number" | "url" | "image" | "date" | "boolean" | "array" | "object" {
  if (value === null || value === undefined) return "text";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  
  const str = String(value);
  if (/^https?:\/\//.test(str)) {
    if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(str)) return "image";
    return "url";
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return "date";
  if (/^-?\d+\.?\d*$/.test(str)) return "number";
  
  return "text";
}

/**
 * Convert dataset to different format
 */
async function convertDataset(
  data: Record<string, any>[],
  format: "csv" | "jsonl"
): Promise<string> {
  if (format === "csv") {
    if (data.length === 0) return "";
    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        if (typeof val === "string" && (val.includes(",") || val.includes("\n") || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      }).join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  }
  
  if (format === "jsonl") {
    return data.map(row => JSON.stringify(row)).join("\n");
  }
  
  return JSON.stringify(data, null, 2);
}

// Built-in scraping templates
const builtinTemplates: ScrapingTemplate[] = [
  {
    id: "ecommerce-products",
    name: "E-commerce Products",
    description: "Extract product listings from e-commerce sites",
    category: "E-commerce",
    config: {
      fields: [
        { id: "1", name: "title", type: "text", selector: "h1, .product-title", selectorType: "css" },
        { id: "2", name: "price", type: "number", selector: ".price, .product-price", selectorType: "css" },
        { id: "3", name: "image", type: "url", selector: ".product-image img", selectorType: "css", attribute: "src" },
        { id: "4", name: "description", type: "text", selector: ".description, .product-description", selectorType: "css" },
      ],
    },
    usageCount: 0,
    rating: 4.5,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "news-articles",
    name: "News Articles",
    description: "Extract articles from news websites",
    category: "News",
    config: {
      fields: [
        { id: "1", name: "title", type: "text", selector: "h1, .article-title", selectorType: "css" },
        { id: "2", name: "author", type: "text", selector: ".author, .byline", selectorType: "css" },
        { id: "3", name: "date", type: "date", selector: "time, .publish-date", selectorType: "css" },
        { id: "4", name: "content", type: "text", selector: "article, .article-content", selectorType: "css" },
      ],
    },
    usageCount: 0,
    rating: 4.3,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "social-profiles",
    name: "Social Media Profiles",
    description: "Extract public profile information",
    category: "Social",
    config: {
      fields: [
        { id: "1", name: "name", type: "text", selector: ".profile-name, h1", selectorType: "css" },
        { id: "2", name: "bio", type: "text", selector: ".bio, .description", selectorType: "css" },
        { id: "3", name: "followers", type: "number", selector: ".followers-count", selectorType: "css" },
        { id: "4", name: "avatar", type: "url", selector: ".avatar img, .profile-image", selectorType: "css", attribute: "src" },
      ],
    },
    usageCount: 0,
    rating: 4.0,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "job-listings",
    name: "Job Listings",
    description: "Extract job postings from career sites",
    category: "Jobs",
    config: {
      fields: [
        { id: "1", name: "title", type: "text", selector: ".job-title, h1", selectorType: "css" },
        { id: "2", name: "company", type: "text", selector: ".company-name", selectorType: "css" },
        { id: "3", name: "location", type: "text", selector: ".location", selectorType: "css" },
        { id: "4", name: "salary", type: "text", selector: ".salary", selectorType: "css" },
        { id: "5", name: "description", type: "text", selector: ".job-description", selectorType: "css" },
      ],
    },
    usageCount: 0,
    rating: 4.2,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "reviews",
    name: "Reviews & Ratings",
    description: "Extract reviews and ratings",
    category: "Reviews",
    config: {
      fields: [
        { id: "1", name: "author", type: "text", selector: ".reviewer-name, .author", selectorType: "css" },
        { id: "2", name: "rating", type: "number", selector: ".rating, .stars", selectorType: "css" },
        { id: "3", name: "title", type: "text", selector: ".review-title", selectorType: "css" },
        { id: "4", name: "content", type: "text", selector: ".review-content, .review-text", selectorType: "css" },
        { id: "5", name: "date", type: "date", selector: ".review-date", selectorType: "css" },
      ],
    },
    usageCount: 0,
    rating: 4.1,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Register all scraper IPC handlers
 */
export function registerScraperHandlers() {
  // Initialize directories
  initScraperDirs();

  // Get scraper status
  ipcMain.handle("scraper:status", async (): Promise<ScraperStatus> => {
    return {
      available: true,
      mode: "local",
      activeJobs: activeJobs.size,
      queuedJobs: jobQueue.length,
      chromiumInstalled: !!chromiumPath,
      chromiumPath: chromiumPath || undefined,
    };
  });

  // List scraping configs
  ipcMain.handle("scraper:config:list", async (): Promise<ScrapingConfig[]> => {
    const configDir = getConfigsDir();
    await fs.ensureDir(configDir);
    
    const files = await fs.readdir(configDir);
    const configs: ScrapingConfig[] = [];
    
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const config = await fs.readJson(path.join(configDir, file));
          configs.push(config);
        } catch (error) {
          logger.warn(`Failed to read config ${file}:`, error);
        }
      }
    }
    
    return configs.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  // Create/save scraping config
  ipcMain.handle("scraper:config:save", async (_, config: ScrapingConfig): Promise<ScrapingConfig> => {
    const configDir = getConfigsDir();
    await fs.ensureDir(configDir);
    
    if (!config.id) {
      config.id = generateId();
      config.createdAt = new Date().toISOString();
    }
    config.updatedAt = new Date().toISOString();
    
    const filePath = path.join(configDir, `${config.id}.json`);
    await fs.writeJson(filePath, config, { spaces: 2 });
    
    return config;
  });

  // Delete scraping config
  ipcMain.handle("scraper:config:delete", async (_, configId: string): Promise<void> => {
    const filePath = path.join(getConfigsDir(), `${configId}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
  });

  // Get scraping templates
  ipcMain.handle("scraper:templates", async (): Promise<ScrapingTemplate[]> => {
    return builtinTemplates;
  });

  // Start scraping job
  ipcMain.handle("scraper:job:start", async (_, configId: string): Promise<ScrapingJob> => {
    const configPath = path.join(getConfigsDir(), `${configId}.json`);
    if (!await fs.pathExists(configPath)) {
      throw new Error("Scraping config not found");
    }
    
    const config: ScrapingConfig = await fs.readJson(configPath);
    
    const job: ScrapingJob = {
      id: generateId(),
      configId,
      configName: config.name,
      status: "pending",
      mode: config.mode,
      progress: {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
      },
      stats: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Run job asynchronously
    runScrapingJob(job, config).catch(error => {
      logger.error(`Job ${job.id} failed:`, error);
      job.status = "failed";
    });
    
    return job;
  });

  // Get job status
  ipcMain.handle("scraper:job:status", async (_, jobId: string): Promise<ScrapingJob | null> => {
    // Check active jobs
    if (activeJobs.has(jobId)) {
      return activeJobs.get(jobId)!;
    }
    
    // Check saved jobs
    const jobPath = path.join(getJobsDir(), `${jobId}.json`);
    if (await fs.pathExists(jobPath)) {
      return fs.readJson(jobPath);
    }
    
    return null;
  });

  // List jobs
  ipcMain.handle("scraper:job:list", async (): Promise<ScrapingJob[]> => {
    const jobDir = getJobsDir();
    await fs.ensureDir(jobDir);
    
    const files = await fs.readdir(jobDir);
    const jobs: ScrapingJob[] = [];
    
    // Add active jobs
    activeJobs.forEach(job => jobs.push(job));
    
    // Add saved jobs
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const job = await fs.readJson(path.join(jobDir, file));
          if (!activeJobs.has(job.id)) {
            jobs.push(job);
          }
        } catch (error) {
          logger.warn(`Failed to read job ${file}:`, error);
        }
      }
    }
    
    return jobs.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });

  // Cancel job
  ipcMain.handle("scraper:job:cancel", async (_, jobId: string): Promise<void> => {
    if (activeJobs.has(jobId)) {
      const job = activeJobs.get(jobId)!;
      job.status = "cancelled";
      activeJobs.set(jobId, job);
    }
  });

  // List datasets
  ipcMain.handle("scraper:dataset:list", async (): Promise<Dataset[]> => {
    const datasetDir = getDatasetsDir();
    await fs.ensureDir(datasetDir);
    
    const files = await fs.readdir(datasetDir);
    const datasets: Dataset[] = [];
    
    for (const file of files) {
      if (file.endsWith(".meta.json")) {
        try {
          const dataset = await fs.readJson(path.join(datasetDir, file));
          datasets.push(dataset);
        } catch (error) {
          logger.warn(`Failed to read dataset ${file}:`, error);
        }
      }
    }
    
    return datasets.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });

  // Get dataset
  ipcMain.handle("scraper:dataset:get", async (_, datasetId: string): Promise<Dataset | null> => {
    const metaPath = path.join(getDatasetsDir(), `${datasetId}.meta.json`);
    if (await fs.pathExists(metaPath)) {
      return fs.readJson(metaPath);
    }
    return null;
  });

  // Preview dataset
  ipcMain.handle("scraper:dataset:preview", async (_, datasetId: string, limit: number = 100): Promise<DatasetPreview> => {
    const metaPath = path.join(getDatasetsDir(), `${datasetId}.meta.json`);
    if (!await fs.pathExists(metaPath)) {
      throw new Error("Dataset not found");
    }
    
    const dataset: Dataset = await fs.readJson(metaPath);
    const data: Record<string, any>[] = await fs.readJson(dataset.filePath);
    
    const rows = data.slice(0, limit);
    const columns = dataset.schema.map(f => f.name);
    
    return {
      columns,
      rows,
      totalRows: data.length,
    };
  });

  // Export dataset
  ipcMain.handle("scraper:dataset:export", async (_, datasetId: string, options: DatasetExportOptions): Promise<string> => {
    const metaPath = path.join(getDatasetsDir(), `${datasetId}.meta.json`);
    if (!await fs.pathExists(metaPath)) {
      throw new Error("Dataset not found");
    }
    
    const dataset: Dataset = await fs.readJson(metaPath);
    let data: Record<string, any>[] = await fs.readJson(dataset.filePath);
    
    // Apply filters
    if (options.columns) {
      data = data.map(row => {
        const filtered: Record<string, any> = {};
        for (const col of options.columns!) {
          if (col in row) filtered[col] = row[col];
        }
        return filtered;
      });
    }
    
    if (options.limit) {
      data = data.slice(0, options.limit);
    }
    
    // Convert format
    const exported = await convertDataset(data, options.format as "csv" | "jsonl");
    
    // Save to temp file
    const tempDir = path.join(app.getPath("temp"), "joycreate-exports");
    await fs.ensureDir(tempDir);
    const exportPath = path.join(tempDir, `${dataset.name.replace(/[^a-zA-Z0-9]/g, "-")}.${options.format}`);
    await fs.writeFile(exportPath, exported, "utf-8");
    
    return exportPath;
  });

  // Delete dataset
  ipcMain.handle("scraper:dataset:delete", async (_, datasetId: string): Promise<void> => {
    const metaPath = path.join(getDatasetsDir(), `${datasetId}.meta.json`);
    const dataPath = path.join(getDatasetsDir(), `${datasetId}.json`);
    
    if (await fs.pathExists(metaPath)) await fs.remove(metaPath);
    if (await fs.pathExists(dataPath)) await fs.remove(dataPath);
  });

  // Create dataset from manual input
  ipcMain.handle("scraper:dataset:create", async (_, params: {
    name: string;
    description?: string;
    data: Record<string, any>[];
    format?: "json" | "csv";
  }): Promise<Dataset> => {
    const datasetId = generateId();
    const datasetDir = getDatasetsDir();
    const filePath = path.join(datasetDir, `${datasetId}.json`);
    
    // Infer schema
    const schema: DatasetField[] = [];
    if (params.data.length > 0) {
      const sample = params.data[0];
      for (const [key, value] of Object.entries(sample)) {
        schema.push({
          name: key,
          type: inferFieldType(value),
          nullable: true,
          sampleValues: params.data.slice(0, 5).map(r => r[key]),
        });
      }
    }
    
    // Save data
    await fs.writeJson(filePath, params.data, { spaces: 2 });
    const stats = await fs.stat(filePath);
    
    const dataset: Dataset = {
      id: datasetId,
      name: params.name,
      description: params.description,
      sourceType: "manual",
      schema,
      stats: {
        rowCount: params.data.length,
        columnCount: schema.length,
        sizeBytes: stats.size,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      format: "json",
      filePath,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Save metadata
    const metaPath = path.join(datasetDir, `${datasetId}.meta.json`);
    await fs.writeJson(metaPath, dataset, { spaces: 2 });
    
    return dataset;
  });

  // Import dataset from file
  ipcMain.handle("scraper:dataset:import", async (_, filePath: string): Promise<Dataset> => {
    if (!await fs.pathExists(filePath)) {
      throw new Error("File not found");
    }
    
    const ext = path.extname(filePath).toLowerCase();
    let data: Record<string, any>[];
    
    if (ext === ".json") {
      data = await fs.readJson(filePath);
      if (!Array.isArray(data)) {
        data = [data];
      }
    } else if (ext === ".csv") {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      if (lines.length < 2) {
        throw new Error("CSV file is empty");
      }
      
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      data = lines.slice(1).map(line => {
        const values = line.split(",");
        const row: Record<string, any> = {};
        headers.forEach((h, i) => {
          row[h] = values[i]?.trim().replace(/^"|"$/g, "") || null;
        });
        return row;
      });
    } else if (ext === ".jsonl") {
      const content = await fs.readFile(filePath, "utf-8");
      data = content.split("\n")
        .filter(l => l.trim())
        .map(l => JSON.parse(l));
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }
    
    const name = path.basename(filePath, ext);
    
    // Use the create handler
    return ipcMain.emit("scraper:dataset:create", null, {
      name,
      data,
    }) as any;
  });

  // Quick scrape single URL
  ipcMain.handle("scraper:quick-scrape", async (_, url: string, fields: ScrapingField[]): Promise<Record<string, any>> => {
    const { html } = await fetchPage(url);
    return extractFields(html, fields);
  });

  logger.info("Scraper IPC handlers registered");
}
