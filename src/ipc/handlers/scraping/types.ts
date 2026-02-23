/**
 * Unified Scraping Engine — Type definitions
 *
 * Single source of truth for all scraping-related types.
 * Absorbs types from both legacy scraper_handlers.ts and data_scraping_handlers.ts.
 */

// ── Source & mode enums ─────────────────────────────────────────────────────

export type ScrapingSourceType =
  | "web"
  | "api"
  | "rss"
  | "sitemap"
  | "document";

export type ScrapingMode = "http" | "playwright" | "hybrid";

export type SelectorStrategy = "css" | "xpath" | "json-path" | "ai-extract";

export type FieldType =
  | "text"
  | "number"
  | "url"
  | "image"
  | "date"
  | "boolean"
  | "array"
  | "object"
  | "html";

export type PaginationType =
  | "next-button"
  | "page-number"
  | "infinite-scroll"
  | "cursor"
  | "offset";

export type AuthType = "none" | "basic" | "bearer" | "cookie" | "custom";

export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ContentModality = "text" | "image" | "audio" | "video" | "context";

// ── Field definitions ───────────────────────────────────────────────────────

export interface ScrapingField {
  id: string;
  name: string;
  type: FieldType;
  selector?: string;
  selectorStrategy: SelectorStrategy;
  attribute?: string; // e.g. "href", "src" for attribute extraction
  transform?: string; // e.g. "trim", "lowercase", "regex:..."
  required?: boolean;
  defaultValue?: string;
  nested?: ScrapingField[]; // for hierarchical extraction
}

// ── Scraping configuration ──────────────────────────────────────────────────

export interface ScrapingConfig {
  sourceType: ScrapingSourceType;
  mode: ScrapingMode;
  urls: string[];

  // Field extraction
  fields?: ScrapingField[];

  // CSS selectors for common content areas (quick config)
  selectors?: {
    content?: string;
    title?: string;
    author?: string;
    date?: string;
    images?: string;
    links?: string;
    custom?: Record<string, string>;
  };

  // Crawl options
  crawl?: {
    enabled: boolean;
    maxDepth?: number;
    maxPages?: number;
    followExternal?: boolean;
    urlIncludePattern?: string;
    urlExcludePattern?: string;
  };

  // API options
  api?: {
    method?: "GET" | "POST" | "PUT";
    headers?: Record<string, string>;
    body?: unknown;
    pagination?: {
      type: PaginationType;
      param: string;
      startValue: number | string;
      incrementBy?: number;
      maxPages?: number;
      nextCursorPath?: string;
    };
    dataPath?: string; // JSON path to data array
  };

  // Authentication
  auth?: {
    type: AuthType;
    username?: string;
    password?: string;
    token?: string;
    cookies?: string;
    customHeaders?: Record<string, string>;
  };

  // Rate limiting & politeness
  rateLimit?: {
    requestsPerSecond?: number;
    delayBetweenRequests?: number;
    maxConcurrent?: number;
  };

  // Output configuration
  output?: {
    format: "text" | "html" | "json" | "markdown";
    includeMetadata?: boolean;
    extractImages?: boolean;
    extractMedia?: boolean; // audio/video
    extractLinks?: boolean;
    extractStructuredData?: boolean; // JSON-LD, microdata, OpenGraph
    extractTables?: boolean;
  };

  // Content filtering
  filters?: {
    minContentLength?: number;
    maxContentLength?: number;
    mustContain?: string[];
    mustNotContain?: string[];
    languageFilter?: string[];
    mimeTypeFilter?: string[];
  };

  // Proxy support
  proxy?: {
    url: string;
    username?: string;
    password?: string;
  };

  // Playwright-specific options
  playwrightOptions?: {
    waitForSelector?: string;
    waitForTimeout?: number; // ms after load
    scrollToBottom?: boolean;
    clickSelectors?: string[]; // e.g. "load more" buttons
    screenshot?: boolean;
    blockResources?: ("image" | "stylesheet" | "font" | "media")[];
  };

  // AI extraction configuration
  aiExtraction?: {
    enabled: boolean;
    instructions?: string; // natural language extraction instructions
    outputSchema?: Record<string, unknown>; // expected JSON schema
    preferLocal?: boolean; // prefer local LLM over cloud
    summarize?: boolean;
  };

  // Auto-tagging configuration
  autoTag?: {
    enabled: boolean;
    detectLanguage?: boolean;
    detectSentiment?: boolean;
    extractEntities?: boolean;
    classifyTopics?: boolean;
    assessQuality?: boolean;
    customCategories?: string[]; // user-defined categories
  };

  // Scheduling (when used as a connector)
  schedule?: {
    type: "once" | "hourly" | "daily" | "weekly" | "custom";
    intervalMinutes?: number;
    cronExpression?: string;
  };
}

// ── Scraped data structures ─────────────────────────────────────────────────

export interface ScrapedPage {
  url: string;
  finalUrl?: string; // after redirects
  statusCode: number;
  contentType: string;
  html?: string;
  content: string; // cleaned text or markdown
  title?: string;
  author?: string;
  publishedDate?: string;
  excerpt?: string;
  siteName?: string;
  language?: string;
  images: ScrapedMedia[];
  audio: ScrapedMedia[];
  video: ScrapedMedia[];
  links: string[];
  structuredData: StructuredDataItem[];
  tables: ExtractedTable[];
  fields: Record<string, unknown>; // extracted by user-defined fields
  metadata: PageMetadata;
  fetchedAt: Date;
  fetchMethod: "http" | "playwright";
  fetchDurationMs: number;
  screenshotPath?: string;
}

export interface ScrapedMedia {
  url: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  byteSize?: number;
  localPath?: string;   // after download
  contentHash?: string;  // after storage
  thumbnailPath?: string;
  duration?: number; // for audio/video in seconds
}

export interface StructuredDataItem {
  type: "json-ld" | "opengraph" | "twitter-card" | "microdata" | "rdfa";
  data: Record<string, unknown>;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  sourceSelector?: string;
}

export interface PageMetadata {
  description?: string;
  keywords?: string[];
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  twitterCard?: string;
  favicon?: string;
  robotsMeta?: string;
}

// ── Job tracking ────────────────────────────────────────────────────────────

export interface ScrapingJob {
  id: string;
  name: string;
  datasetId?: string;
  templateId?: string;
  status: JobStatus;
  config: ScrapingConfig;
  progress: JobProgress;
  startedAt?: string;
  completedAt?: string;
  errors: ScrapingError[];
  stats: JobStats;
}

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentUrl?: string;
}

export interface JobStats {
  pagesScraped: number;
  itemsExtracted: number;
  bytesDownloaded: number;
  mediaDownloaded: number;
  durationMs: number;
  averagePageTimeMs: number;
}

export interface ScrapingError {
  url: string;
  message: string;
  code?: string;
  timestamp: string;
  retryable: boolean;
}

// ── Tagging & classification ────────────────────────────────────────────────

export interface TaggingResult {
  // Rule-based tags (always populated)
  mimeCategory?: string;
  domainCategory?: string;
  contentType?: string; // article, product, profile, listing, etc.
  language?: string;
  languageConfidence?: number;
  keywords: string[];

  // AI-powered tags (populated when LLM available)
  sentiment?: { label: "positive" | "negative" | "neutral" | "mixed"; score: number };
  topics?: Array<{ name: string; confidence: number }>;
  entities?: Array<{ text: string; type: string; confidence: number }>;
  summary?: string;
  qualityScore?: number;
  customCategories?: Record<string, number>; // category → confidence
}

// ── AI extraction result ────────────────────────────────────────────────────

export interface AIExtractionResult {
  success: boolean;
  data: Record<string, unknown>;
  confidence: number;
  tokensUsed?: { input: number; output: number };
  provider?: string;
  summary?: string;
  inferredSchema?: ScrapingField[];
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface ScrapingTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  config: Partial<ScrapingConfig>;
  fields: ScrapingField[];
  autoTagRules?: Partial<ScrapingConfig["autoTag"]>;
  sampleOutput?: Record<string, unknown>;
  isBuiltin: boolean;
}

// ── Storage types ───────────────────────────────────────────────────────────

export interface StoredContent {
  hash: string;
  size: number;
  storagePath: string;
  mimeType: string;
  contentUri: string; // "content://<hash>"
}

// ── Preview types ───────────────────────────────────────────────────────────

export interface ScrapePreviewResult {
  url: string;
  page: ScrapedPage;
  extractedFields: Record<string, unknown>;
  suggestedFields?: ScrapingField[];
  tagResults?: TaggingResult;
  warning?: string;
}

// ── IPC request / response shapes ───────────────────────────────────────────

export interface ScrapeRequest {
  config: ScrapingConfig;
  datasetId?: string;
  datasetName?: string;
  jobName?: string;
  autoCreateDataset?: boolean;
}

export interface ScrapeUrlRequest {
  url: string;
  config?: Partial<ScrapingConfig>;
}

export interface DetectSchemaRequest {
  url: string;
  sampleHtml?: string;
  instructions?: string;
}

export interface AutoTagRequest {
  datasetId: string;
  itemIds?: string[];
  options?: ScrapingConfig["autoTag"];
}
