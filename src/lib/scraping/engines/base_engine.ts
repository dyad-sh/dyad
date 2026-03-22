/**
 * Base Engine — Abstract interface that all scraping engines implement.
 */

import type { EngineType, ProbeResult, ScrapeOptions, ScrapeResult, ScrapingEngine } from "../types";

export abstract class BaseEngine implements ScrapingEngine {
  abstract readonly name: EngineType;

  abstract canHandle(probe: ProbeResult): boolean;

  abstract scrape(url: string, options: ScrapeOptions): Promise<ScrapeResult>;

  async dispose(): Promise<void> {
    // Default no-op; override in engines that hold resources (browsers, pools)
  }

  /** Build a default User-Agent string */
  protected getDefaultUserAgent(): string {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  /** Build a baseline ScrapeResult from partial data */
  protected buildResult(
    url: string,
    partial: Partial<ScrapeResult> & { html: string; statusCode: number },
  ): ScrapeResult {
    return {
      url,
      finalUrl: partial.finalUrl ?? url,
      statusCode: partial.statusCode,
      contentType: partial.contentType ?? "text/html",
      html: partial.html,
      headers: partial.headers ?? {},
      cookies: partial.cookies ?? [],
      screenshotPath: partial.screenshotPath,
      engine: this.name,
      fetchDurationMs: partial.fetchDurationMs ?? 0,
      bytesReceived: partial.bytesReceived ?? Buffer.byteLength(partial.html, "utf-8"),
    };
  }
}
