/**
 * World-Class Scraping Engine — Core Type Definitions
 *
 * Extends and consolidates types from the V2 handler layer,
 * adding engine abstractions, crawler types, anti-bot, auth, proxy, and monitoring.
 */

// Re-export all existing V2 types for backward compatibility
export type {
  ScrapingSourceType,
  ScrapingMode,
  SelectorStrategy,
  FieldType,
  PaginationType,
  AuthType,
  JobStatus,
  ContentModality,
  ScrapingField,
  ScrapingConfig,
  ScrapedPage,
  ScrapedMedia,
  StructuredDataItem,
  ExtractedTable,
  PageMetadata,
  ScrapingJob,
  JobProgress,
  JobStats,
  ScrapingError,
  TaggingResult,
  AIExtractionResult,
  ScrapingTemplate,
  StoredContent,
  ScrapePreviewResult,
  ScrapeRequest,
  ScrapeUrlRequest,
  DetectSchemaRequest,
  AutoTagRequest,
} from "@/ipc/handlers/scraping/types";

// ── Engine types ────────────────────────────────────────────────────────────

export type EngineType = "static" | "browser" | "stealth" | "fetch" | "api" | "auto";

export interface ProbeResult {
  url: string;
  statusCode: number;
  contentType: string;
  headers: Record<string, string>;
  hasCloudflare: boolean;
  hasAkamai: boolean;
  hasBotProtection: boolean;
  isStaticHtml: boolean;
  hasJavaScript: boolean;
  isApiEndpoint: boolean;
  responseTimeMs: number;
  recommendedEngine: EngineType;
  confidence: number;
}

export interface ScrapeOptions {
  /** Override engine selection */
  engine?: EngineType;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Cookies to inject */
  cookies?: CookieEntry[];
  /** Proxy configuration */
  proxy?: ProxyConfig;
  /** Timeout in ms */
  timeout?: number;
  /** Wait for this CSS selector before extracting (browser/stealth only) */
  waitForSelector?: string;
  /** Screenshot the page after load */
  screenshot?: boolean;
  /** Block resource types for faster loads */
  blockResources?: ("image" | "stylesheet" | "font" | "media")[];
  /** Scroll to bottom to trigger lazy loading */
  scrollToBottom?: boolean;
  /** User-Agent override */
  userAgent?: string;
  /** Max response size in bytes (0 = unlimited) */
  maxResponseSize?: number;
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  html: string;
  headers: Record<string, string>;
  cookies: CookieEntry[];
  screenshotPath?: string;
  engine: EngineType;
  fetchDurationMs: number;
  bytesReceived: number;
}

export interface ScrapingEngine {
  readonly name: EngineType;
  canHandle(probe: ProbeResult): boolean;
  scrape(url: string, options: ScrapeOptions): Promise<ScrapeResult>;
  dispose(): Promise<void>;
}

// ── Crawler types ───────────────────────────────────────────────────────────

export type CrawlScope = "domain" | "subdomain" | "path" | "custom_regex";
export type CrawlStrategy = "bfs" | "dfs" | "priority";

export interface CrawlConfig {
  seeds: string[];
  maxDepth: number;
  maxPages: number;
  concurrency: number;
  scope: CrawlScope;
  scopePattern?: string;
  strategy: CrawlStrategy;
  followRedirects: boolean;
  respectRobots: boolean;
  delayMs: [number, number]; // [min, max] random delay
  engine: EngineType;
  filters: UrlFilter[];
  onPageDone?: (result: CrawlPageResult) => void;
}

export interface UrlFilter {
  type: "include" | "exclude";
  pattern: string; // regex or glob
}

export interface CrawlPageResult {
  url: string;
  depth: number;
  statusCode: number;
  linksFound: number;
  extractedRecords: number;
  error?: string;
}

export interface CrawlSession {
  id: string;
  config: CrawlConfig;
  status: "running" | "paused" | "done" | "cancelled";
  pagesVisited: number;
  pagesQueued: number;
  pagesErrored: number;
  startedAt: Date;
  elapsedMs: number;
}

// ── Pagination types ────────────────────────────────────────────────────────

export type PaginationStrategy =
  | "next-button"
  | "url-pattern"
  | "infinite-scroll"
  | "load-more"
  | "api-intercept"
  | "none";

export interface PaginationDetection {
  strategy: PaginationStrategy;
  confidence: number;
  nextUrl?: string;
  pattern?: string;
  selector?: string;
  apiEndpoint?: string;
}

// ── Anti-bot types ──────────────────────────────────────────────────────────

export interface StealthConfig {
  spoofWebdriver: boolean;
  spoofPlugins: boolean;
  spoofLanguages: boolean;
  spoofChrome: boolean;
  spoofPermissions: boolean;
  randomizeCanvas: boolean;
  randomizeAudioContext: boolean;
  spoofWebGL: boolean;
  spoofScreen: boolean;
  humanMouse: boolean;
  humanTyping: boolean;
  humanScroll: boolean;
  randomViewport: boolean;
  randomUserAgent: boolean;
  persistCookies: boolean;
}

export interface CaptchaDetection {
  detected: boolean;
  type?: "recaptcha-v2" | "recaptcha-v3" | "hcaptcha" | "cloudflare-turnstile" | "image" | "audio" | "unknown";
  selector?: string;
  siteKey?: string;
}

// ── Auth types ──────────────────────────────────────────────────────────────

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SavedSession {
  id: string;
  name: string;
  domain: string;
  cookies: CookieEntry[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  userAgent?: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface LoginConfig {
  url: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  waitForSelector?: string;
  captchaHandler?: "manual" | "ai";
}

// ── Proxy types ─────────────────────────────────────────────────────────────

export type ProxyType = "http" | "https" | "socks4" | "socks5";
export type ProxyRotation = "round-robin" | "random" | "per-domain" | "on-block";

export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
}

export interface ProxyManagerConfig {
  proxies: ProxyConfig[];
  rotation: ProxyRotation;
  healthCheckIntervalMs?: number;
  failoverThreshold?: number;
}

export interface ProxyHealth {
  proxy: ProxyConfig;
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: Date;
  failCount: number;
}

// ── Monitoring types ────────────────────────────────────────────────────────

export interface ScrapingMetrics {
  pagesPerSecond: number;
  recordsPerSecond: number;
  errorRate: number;
  avgPageLoadTimeMs: number;
  bandwidthBytesTotal: number;
  extractionSuccessRate: number;
  avgAIConfidenceScore: number;
  memoryUsageMB: number;
  activeBrowserInstances: number;
}

export type ErrorCategory =
  | "network_timeout"
  | "dns_failure"
  | "http_error"
  | "js_error"
  | "captcha"
  | "ip_blocked"
  | "login_required"
  | "rate_limited"
  | "extraction_failed"
  | "storage_error"
  | "unknown";

export interface RetryStrategy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  switchProxy: boolean;
  switchEngine: boolean;
}

// ── Export types ─────────────────────────────────────────────────────────────

export type ExportFormat =
  | "json"
  | "jsonl"
  | "csv"
  | "xlsx"
  | "parquet"
  | "markdown"
  | "sqlite";

export interface ExportOptions {
  format: ExportFormat;
  outputPath: string;
  fields?: string[];
  delimiter?: string; // csv only
  pretty?: boolean;   // json only
  sheetName?: string; // xlsx only
}

// ── Guardrails types ────────────────────────────────────────────────────────

export interface PIIDetectionResult {
  hasPII: boolean;
  findings: PIIFinding[];
}

export interface PIIFinding {
  type: "email" | "phone" | "ssn" | "credit_card" | "name_address" | "ip_address";
  value: string;
  field: string;
  confidence: number;
}

export interface ScrapingWarning {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
