/**
 * JoyCrawler — Multi-strategy site crawler with concurrency control.
 *
 * Supports BFS, DFS, and priority-based traversal. Uses the UrlFrontier
 * for deduplication and the PolitenessEngine for rate limiting.
 */

import * as cheerio from "cheerio";
import log from "electron-log";
import type {
  CrawlConfig,
  CrawlPageResult,
  CrawlSession,
  ScrapeOptions,
  ScrapeResult,
  ScrapingEngine,
} from "../types";
import { UrlFrontier } from "./url_frontier";
import {
  isUrlAllowed,
  randomDelay,
  waitForToken,
} from "../anti_bot/politeness_engine";

const logger = log.scope("scraping:crawler");

export class JoyCrawler {
  private frontier: UrlFrontier;
  private config: CrawlConfig;
  private engine: ScrapingEngine;
  private session: CrawlSession;
  private abortController = new AbortController();
  private activeWorkers = 0;

  constructor(config: CrawlConfig, engine: ScrapingEngine) {
    this.config = config;
    this.engine = engine;
    this.frontier = new UrlFrontier(config.maxPages * 2);
    this.session = {
      id: crypto.randomUUID(),
      config,
      status: "running",
      pagesVisited: 0,
      pagesQueued: 0,
      pagesErrored: 0,
      startedAt: new Date(),
      elapsedMs: 0,
    };
  }

  get sessionInfo(): CrawlSession {
    return {
      ...this.session,
      elapsedMs: Date.now() - this.session.startedAt.getTime(),
    };
  }

  /**
   * Start the crawl from seed URLs.
   */
  async crawl(): Promise<CrawlSession> {
    logger.info(`Starting crawl with ${this.config.seeds.length} seeds`);

    // Seed the frontier
    for (const seed of this.config.seeds) {
      this.frontier.add(seed, 0, 0);
      this.session.pagesQueued++;
    }

    // Run concurrent workers
    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.config.concurrency; i++) {
      workers.push(this.worker(i));
    }

    await Promise.all(workers);

    this.session.status =
      this.abortController.signal.aborted ? "cancelled" : "done";
    this.session.elapsedMs =
      Date.now() - this.session.startedAt.getTime();

    logger.info(
      `Crawl complete: ${this.session.pagesVisited} pages, ${this.session.pagesErrored} errors`,
    );

    return this.session;
  }

  /**
   * Pause the crawl.
   */
  pause(): void {
    this.session.status = "paused";
  }

  /**
   * Resume a paused crawl.
   */
  resume(): void {
    if (this.session.status === "paused") {
      this.session.status = "running";
    }
  }

  /**
   * Cancel the crawl entirely.
   */
  cancel(): void {
    this.abortController.abort();
    this.session.status = "cancelled";
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async worker(id: number): Promise<void> {
    while (!this.abortController.signal.aborted) {
      // Paused — wait
      if (this.session.status === "paused") {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      // Max pages reached
      if (this.session.pagesVisited >= this.config.maxPages) break;

      const entry = this.frontier.next();
      if (!entry) {
        // No more URLs — wait briefly for other workers to add some
        if (this.activeWorkers === 0) break;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Depth check
      if (entry.depth > this.config.maxDepth) continue;

      this.activeWorkers++;
      try {
        await this.processUrl(entry.url, entry.depth);
      } catch (err) {
        logger.warn(`Worker ${id} error on ${entry.url}: ${err}`);
        this.session.pagesErrored++;
      } finally {
        this.activeWorkers--;
      }

      // Politeness delay
      const [minDelay, maxDelay] = this.config.delayMs;
      await randomDelay(minDelay, maxDelay);
    }
  }

  private async processUrl(url: string, depth: number): Promise<void> {
    if (this.abortController.signal.aborted) return;

    // Robots.txt check
    if (this.config.respectRobots) {
      const allowed = await isUrlAllowed(url, true);
      if (!allowed) {
        logger.info(`Robots.txt disallows: ${url}`);
        return;
      }
    }

    // Rate limit
    const domain = new URL(url).hostname;
    await waitForToken(domain, 2);

    // Fetch
    const options: ScrapeOptions = {
      engine: this.config.engine === "auto" ? undefined : this.config.engine,
      timeout: 30_000,
      scrollToBottom: false,
    };

    let result: ScrapeResult;
    try {
      result = await this.engine.scrape(url, options);
    } catch (err) {
      this.session.pagesErrored++;
      const pageResult: CrawlPageResult = {
        url,
        depth,
        statusCode: 0,
        linksFound: 0,
        extractedRecords: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.config.onPageDone?.(pageResult);
      return;
    }

    this.session.pagesVisited++;

    // Extract links and add to frontier
    const links = this.extractLinks(result.html, result.finalUrl);
    const filteredLinks = links.filter((link) => this.isInScope(link));
    let added = 0;
    for (const link of filteredLinks) {
      const priority = this.computePriority(link, depth + 1);
      if (this.frontier.add(link, depth + 1, priority, url)) {
        added++;
        this.session.pagesQueued++;
      }
    }

    const pageResult: CrawlPageResult = {
      url,
      depth,
      statusCode: result.statusCode,
      linksFound: added,
      extractedRecords: 0, // Filled by orchestrator
    };

    this.config.onPageDone?.(pageResult);
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];
    const base = new URL(baseUrl);

    $("a[href]").each((_, el) => {
      try {
        const href = $(el).attr("href");
        if (!href) return;
        // Skip non-HTTP links
        if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

        const resolved = new URL(href, base).href;
        links.push(resolved);
      } catch {
        // Invalid URL — skip
      }
    });

    return links;
  }

  private isInScope(url: string): boolean {
    try {
      const parsed = new URL(url);
      const seedUrl = new URL(this.config.seeds[0]);

      // URL filters
      for (const filter of this.config.filters) {
        const regex = new RegExp(filter.pattern);
        const matches = regex.test(url);
        if (filter.type === "exclude" && matches) return false;
        if (filter.type === "include" && !matches) return false;
      }

      switch (this.config.scope) {
        case "domain":
          return parsed.hostname === seedUrl.hostname ||
            parsed.hostname.endsWith(`.${seedUrl.hostname}`);
        case "subdomain":
          return parsed.hostname === seedUrl.hostname;
        case "path":
          return (
            parsed.hostname === seedUrl.hostname &&
            parsed.pathname.startsWith(seedUrl.pathname)
          );
        case "custom_regex":
          return this.config.scopePattern
            ? new RegExp(this.config.scopePattern).test(url)
            : true;
        default:
          return true;
      }
    } catch {
      return false;
    }
  }

  private computePriority(url: string, depth: number): number {
    // Lower = higher priority
    let priority = depth;

    // Prefer pages over files
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".pdf") || path.endsWith(".zip") || path.endsWith(".exe")) {
      priority += 10;
    }

    // Prefer shorter URLs
    priority += Math.floor(url.length / 100);

    return priority;
  }
}
