/**
 * Monitoring — Real-time metrics collection and error handling.
 */

import log from "electron-log";
import type { ErrorCategory, RetryStrategy, ScrapingMetrics, ScrapingWarning } from "../types";

const logger = log.scope("scraping:monitoring");

// ── Metrics Collector ───────────────────────────────────────────────────────

export class MetricsCollector {
  private startTime = Date.now();
  private pageCount = 0;
  private recordCount = 0;
  private errorCount = 0;
  private totalLoadTimeMs = 0;
  private totalBytes = 0;
  private extractionSuccesses = 0;
  private extractionAttempts = 0;
  private aiConfidenceSum = 0;
  private aiConfidenceCount = 0;
  private warnings: ScrapingWarning[] = [];

  recordPageLoad(durationMs: number, bytes: number): void {
    this.pageCount++;
    this.totalLoadTimeMs += durationMs;
    this.totalBytes += bytes;
  }

  recordExtraction(success: boolean, recordsExtracted: number, aiConfidence?: number): void {
    this.extractionAttempts++;
    if (success) {
      this.extractionSuccesses++;
      this.recordCount += recordsExtracted;
    }
    if (aiConfidence !== undefined) {
      this.aiConfidenceSum += aiConfidence;
      this.aiConfidenceCount++;
    }
  }

  recordError(): void {
    this.errorCount++;
  }

  addWarning(warning: ScrapingWarning): void {
    this.warnings.push(warning);
    if (warning.level === "critical") {
      logger.error(`Critical warning: ${warning.message}`);
    }
  }

  getMetrics(): ScrapingMetrics {
    const elapsed = (Date.now() - this.startTime) / 1000 || 1;
    return {
      pagesPerSecond: this.pageCount / elapsed,
      recordsPerSecond: this.recordCount / elapsed,
      errorRate: this.pageCount > 0 ? this.errorCount / (this.pageCount + this.errorCount) : 0,
      avgPageLoadTimeMs: this.pageCount > 0 ? this.totalLoadTimeMs / this.pageCount : 0,
      bandwidthBytesTotal: this.totalBytes,
      extractionSuccessRate:
        this.extractionAttempts > 0 ? this.extractionSuccesses / this.extractionAttempts : 0,
      avgAIConfidenceScore:
        this.aiConfidenceCount > 0 ? this.aiConfidenceSum / this.aiConfidenceCount : 0,
      memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
      activeBrowserInstances: 0, // Updated externally
    };
  }

  getWarnings(): ScrapingWarning[] {
    return [...this.warnings];
  }

  reset(): void {
    this.startTime = Date.now();
    this.pageCount = 0;
    this.recordCount = 0;
    this.errorCount = 0;
    this.totalLoadTimeMs = 0;
    this.totalBytes = 0;
    this.extractionSuccesses = 0;
    this.extractionAttempts = 0;
    this.aiConfidenceSum = 0;
    this.aiConfidenceCount = 0;
    this.warnings = [];
  }
}

// ── Error Handler ───────────────────────────────────────────────────────────

/**
 * Categorize an error for retry/reporting.
 */
export function categorizeError(error: unknown): ErrorCategory {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (msg.includes("timeout") || msg.includes("timed out")) return "network_timeout";
  if (msg.includes("enotfound") || msg.includes("dns")) return "dns_failure";
  if (msg.includes("captcha")) return "captcha";
  if (msg.includes("429") || msg.includes("rate limit")) return "rate_limited";
  if (msg.includes("403") || msg.includes("blocked") || msg.includes("banned")) return "ip_blocked";
  if (msg.includes("401") || msg.includes("login") || msg.includes("auth")) return "login_required";
  if (msg.includes("extract")) return "extraction_failed";
  if (msg.includes("storage") || msg.includes("disk") || msg.includes("write")) return "storage_error";
  if (/\b[45]\d{2}\b/.test(msg)) return "http_error";
  if (msg.includes("script") || msg.includes("evaluate")) return "js_error";
  return "unknown";
}

/**
 * Calculate retry delay with exponential backoff and optional jitter.
 */
export function getRetryDelay(strategy: RetryStrategy, attempt: number): number {
  const baseDelay = strategy.baseDelayMs * Math.pow(strategy.backoffMultiplier, attempt);
  const delay = Math.min(baseDelay, strategy.maxDelayMs);

  if (strategy.jitter) {
    return delay + Math.random() * delay * 0.5;
  }
  return delay;
}

/**
 * Default retry strategy.
 */
export const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitter: true,
  switchProxy: true,
  switchEngine: false,
};

/**
 * Determine if an error category should be retried.
 */
export function shouldRetry(category: ErrorCategory): boolean {
  switch (category) {
    case "network_timeout":
    case "dns_failure":
    case "http_error":
    case "rate_limited":
      return true;
    case "captcha":
    case "ip_blocked":
    case "login_required":
    case "extraction_failed":
    case "storage_error":
    case "js_error":
    case "unknown":
      return false;
  }
}
