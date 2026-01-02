/**
 * Data Scraper & Dataset Types
 * Types for web scraping and dataset management
 */

// Scraping job status
export type ScrapingStatus = "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";

// Data source types
export type DataSourceType = "url" | "sitemap" | "api" | "file" | "database" | "manual";

// Dataset format types
export type DatasetFormat = "json" | "csv" | "parquet" | "jsonl" | "xlsx" | "sqlite";

// Scraping mode
export type ScrapingMode = "local" | "api" | "hybrid";

// Selector types for scraping
export type SelectorType = "css" | "xpath" | "regex" | "json-path" | "ai-extract";

// Data field types
export type FieldType = "text" | "number" | "url" | "image" | "date" | "boolean" | "array" | "object";

// Scraping configuration
export interface ScrapingConfig {
  id: string;
  name: string;
  description?: string;
  
  // Source configuration
  sourceType: DataSourceType;
  sourceUrl?: string;
  sourceUrls?: string[];
  sitemapUrl?: string;
  
  // Scraping settings
  mode: ScrapingMode;
  maxPages?: number;
  maxDepth?: number;
  delay?: number; // ms between requests
  timeout?: number; // request timeout in ms
  userAgent?: string;
  respectRobotsTxt?: boolean;
  followRedirects?: boolean;
  
  // Pagination
  pagination?: {
    type: "next-button" | "page-number" | "infinite-scroll" | "cursor";
    selector?: string;
    maxPages?: number;
  };
  
  // Fields to extract
  fields: ScrapingField[];
  
  // Filters
  urlFilters?: {
    include?: string[];
    exclude?: string[];
  };
  
  // Authentication
  auth?: {
    type: "none" | "basic" | "bearer" | "cookie" | "custom";
    credentials?: Record<string, string>;
  };
  
  // Proxy settings
  proxy?: {
    enabled: boolean;
    url?: string;
    rotating?: boolean;
  };
  
  // AI extraction settings (for complex pages)
  aiExtraction?: {
    enabled: boolean;
    provider?: string;
    model?: string;
    prompt?: string;
  };
  
  // Rate limiting
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
  };
  
  // Schedule
  schedule?: {
    enabled: boolean;
    cron?: string;
    timezone?: string;
  };
  
  createdAt: string;
  updatedAt: string;
}

// Field configuration for extraction
export interface ScrapingField {
  id: string;
  name: string;
  type: FieldType;
  selector: string;
  selectorType: SelectorType;
  attribute?: string; // e.g., 'href', 'src'
  transform?: string; // transformation function
  required?: boolean;
  defaultValue?: any;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
  };
  nested?: ScrapingField[]; // for nested data
}

// Scraping job
export interface ScrapingJob {
  id: string;
  configId: string;
  configName: string;
  status: ScrapingStatus;
  mode: ScrapingMode;
  
  // Progress
  progress: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
  };
  
  // Stats
  stats: {
    startedAt?: string;
    completedAt?: string;
    duration?: number;
    bytesDownloaded?: number;
    pagesScraped?: number;
    itemsExtracted?: number;
    errorsCount?: number;
  };
  
  // Errors
  errors?: ScrapingError[];
  
  // Output
  outputDatasetId?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface ScrapingError {
  url: string;
  message: string;
  code?: string;
  timestamp: string;
}

// Dataset definition
export interface Dataset {
  id: string;
  name: string;
  description?: string;
  
  // Source info
  sourceType: "scraping" | "upload" | "api" | "manual" | "generated";
  sourceJobId?: string;
  
  // Schema
  schema: DatasetField[];
  
  // Stats
  stats: {
    rowCount: number;
    columnCount: number;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
  };
  
  // Storage
  format: DatasetFormat;
  filePath: string;
  
  // Metadata
  tags?: string[];
  category?: string;
  
  // Version tracking
  version: number;
  parentId?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface DatasetField {
  name: string;
  type: FieldType;
  nullable: boolean;
  description?: string;
  sampleValues?: any[];
}

// Dataset preview/sample
export interface DatasetPreview {
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

// Data transformation
export interface DataTransformation {
  id: string;
  name: string;
  type: "filter" | "map" | "aggregate" | "join" | "dedupe" | "sort" | "clean" | "enrich";
  config: Record<string, any>;
}

// Data pipeline
export interface DataPipeline {
  id: string;
  name: string;
  description?: string;
  
  // Source datasets
  sources: string[];
  
  // Transformations
  transformations: DataTransformation[];
  
  // Output
  outputFormat: DatasetFormat;
  outputName: string;
  
  // Schedule
  schedule?: {
    enabled: boolean;
    cron?: string;
  };
  
  createdAt: string;
  updatedAt: string;
}

// Scraping template
export interface ScrapingTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  
  // Pre-configured settings
  config: Partial<ScrapingConfig>;
  
  // Usage stats
  usageCount: number;
  rating: number;
  
  isBuiltin: boolean;
  createdAt: string;
}

// AI extraction result
export interface AIExtractionResult {
  success: boolean;
  data: Record<string, any>;
  confidence: number;
  tokens?: {
    input: number;
    output: number;
  };
}

// Export options
export interface DatasetExportOptions {
  format: DatasetFormat;
  includeHeaders?: boolean;
  delimiter?: string;
  encoding?: string;
  compression?: "none" | "gzip" | "zip";
  filters?: Record<string, any>;
  columns?: string[];
  limit?: number;
}

// Scraper status
export interface ScraperStatus {
  available: boolean;
  mode: ScrapingMode;
  activeJobs: number;
  queuedJobs: number;
  chromiumInstalled: boolean;
  chromiumPath?: string;
}
