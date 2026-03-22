/**
 * Pagination Handler — Multi-strategy pagination detection and execution.
 *
 * Detects pagination type from HTML and executes appropriate strategy
 * to collect all pages of results.
 */

import * as cheerio from "cheerio";
import log from "electron-log";
import type { Page } from "playwright-core";
import type { PaginationDetection, PaginationStrategy } from "../types";

const logger = log.scope("scraping:pagination");

// ── Common "next" button selectors and text patterns ────────────────────────

const NEXT_SELECTORS = [
  'a[rel="next"]',
  'link[rel="next"]',
  ".pagination .next a",
  ".pagination a.next",
  ".pager .next a",
  ".pager__next a",
  "a.next-page",
  "a.nextpage",
  'nav[aria-label*="pagination"] a:last-child',
  ".page-numbers .next",
];

const NEXT_TEXT = [
  "next",
  "next page",
  "next →",
  "next »",
  "›",
  "»",
  "→",
  ">",
  "older",
  "newer",
];

const LOAD_MORE_SELECTORS = [
  'button[class*="load-more"]',
  'a[class*="load-more"]',
  'button[class*="show-more"]',
  '[data-testid*="load-more"]',
  ".load-more",
  ".show-more",
];

// ── Main detection ──────────────────────────────────────────────────────────

/**
 * Analyzes a page to detect what pagination strategy is in use.
 */
export function detectPagination(
  html: string,
  currentUrl: string,
): PaginationDetection {
  const $ = cheerio.load(html);

  // 1. Check for rel="next" link (most authoritative)
  const relNext = $('a[rel="next"], link[rel="next"]').first().attr("href");
  if (relNext) {
    try {
      const nextUrl = new URL(relNext, currentUrl).href;
      return {
        strategy: "next-button",
        confidence: 0.95,
        nextUrl,
        selector: 'a[rel="next"]',
      };
    } catch { /* invalid URL */ }
  }

  // 2. Check for common next button selectors
  for (const selector of NEXT_SELECTORS) {
    const el = $(selector).first();
    if (el.length && el.attr("href")) {
      try {
        return {
          strategy: "next-button",
          confidence: 0.85,
          nextUrl: new URL(el.attr("href")!, currentUrl).href,
          selector,
        };
      } catch { /* invalid URL */ }
    }
  }

  // 3. Check by link text
  const allLinks = $("a[href]");
  for (let i = 0; i < allLinks.length; i++) {
    const el = allLinks.eq(i);
    const text = el.text().trim().toLowerCase();
    if (NEXT_TEXT.includes(text) && el.attr("href")) {
      try {
        return {
          strategy: "next-button",
          confidence: 0.75,
          nextUrl: new URL(el.attr("href")!, currentUrl).href,
          selector: `a:contains("${el.text().trim()}")`,
        };
      } catch { /* invalid URL */ }
    }
  }

  // 4. Check for URL-based pagination pattern
  const urlPattern = detectUrlPattern(currentUrl, $);
  if (urlPattern) {
    return {
      strategy: "url-pattern",
      confidence: 0.8,
      pattern: urlPattern.pattern,
      nextUrl: urlPattern.nextUrl,
    };
  }

  // 5. Check for load-more buttons
  for (const selector of LOAD_MORE_SELECTORS) {
    if ($(selector).length > 0) {
      return {
        strategy: "load-more",
        confidence: 0.7,
        selector,
      };
    }
  }

  // 6. Check for infinite scroll indicators
  if (hasInfiniteScrollMarkers($)) {
    return {
      strategy: "infinite-scroll",
      confidence: 0.6,
    };
  }

  return { strategy: "none", confidence: 1.0 };
}

/**
 * Execute pagination on a Playwright page (for browser/stealth engines).
 * Yields pages of HTML as they are loaded.
 */
export async function* executeBrowserPagination(
  page: Page,
  detection: PaginationDetection,
  maxPages: number,
): AsyncGenerator<{ html: string; url: string; pageNum: number }> {
  let pageNum = 1;

  // Yield the current (first) page
  yield {
    html: await page.content(),
    url: page.url(),
    pageNum,
  };

  while (pageNum < maxPages) {
    let navigated = false;

    switch (detection.strategy) {
      case "next-button": {
        if (!detection.selector) break;
        const nextEl = await page.$(detection.selector);
        if (!nextEl) break;
        const href = await nextEl.getAttribute("href");
        if (!href) {
          // It might be a button — try clicking
          await nextEl.click();
          await page.waitForLoadState("networkidle").catch(() => {});
          navigated = true;
        } else {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {}),
            nextEl.click(),
          ]);
          navigated = true;
        }
        break;
      }
      case "url-pattern": {
        if (!detection.nextUrl) break;
        await page.goto(detection.nextUrl, { waitUntil: "networkidle" });
        navigated = true;
        // Detect next URL from loaded page
        const newHtml = await page.content();
        const newDetection = detectPagination(newHtml, page.url());
        detection = { ...detection, nextUrl: newDetection.nextUrl };
        break;
      }
      case "load-more": {
        if (!detection.selector) break;
        const btn = await page.$(detection.selector);
        if (!btn) break;
        const visible = await btn.isVisible();
        if (!visible) break;
        await btn.click();
        await page.waitForLoadState("networkidle").catch(() => {});
        navigated = true;
        break;
      }
      case "infinite-scroll": {
        const prevHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight > prevHeight) navigated = true;
        break;
      }
      default:
        break;
    }

    if (!navigated) break;
    pageNum++;

    yield {
      html: await page.content(),
      url: page.url(),
      pageNum,
    };
  }
}

/**
 * Execute static pagination by modifying the URL pattern.
 * Returns URLs for subsequent pages.
 */
export function generatePaginationUrls(
  detection: PaginationDetection,
  maxPages: number,
): string[] {
  if (detection.strategy !== "url-pattern" || !detection.pattern) return [];

  const urls: string[] = [];
  for (let page = 2; page <= maxPages; page++) {
    urls.push(detection.pattern.replace("{page}", String(page)));
  }
  return urls;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectUrlPattern(
  currentUrl: string,
  $: cheerio.CheerioAPI,
): { pattern: string; nextUrl: string } | null {
  // Check for page=N or /page/N patterns in pagination links
  const paginationLinks: string[] = [];
  $('a[href*="page="], a[href*="/page/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) paginationLinks.push(href);
  });

  if (paginationLinks.length < 2) return null;

  // Try to find page number pattern
  const pageRegex = /[?&]page=(\d+)|\/page\/(\d+)/;
  const numbers: number[] = [];

  for (const link of paginationLinks) {
    const match = link.match(pageRegex);
    if (match) {
      numbers.push(Number.parseInt(match[1] || match[2], 10));
    }
  }

  if (numbers.length === 0) return null;

  const currentPage = numbers.includes(1) ? 1 : Math.min(...numbers) - 1;
  const nextPage = currentPage + 1;

  // Build pattern from the first link that matches
  const templateLink = paginationLinks[0];
  try {
    const fullUrl = new URL(templateLink, currentUrl);
    const pattern = fullUrl.href.replace(/page[=/](\d+)/, "page$1").replace(/page\d+/, "page/{page}");
    const nextUrl = fullUrl.href.replace(
      pageRegex,
      (m, p1, p2) => m.replace(p1 || p2, String(nextPage)),
    );
    return { pattern, nextUrl };
  } catch {
    return null;
  }
}

function hasInfiniteScrollMarkers($: cheerio.CheerioAPI): boolean {
  // Check for infinite scroll libraries/markers
  const markers = [
    '[class*="infinite"]',
    '[data-infinite]',
    '[data-infinite-scroll]',
    '[class*="lazy-load"]',
    'script[src*="infinite-scroll"]',
    '[data-page]',
  ];

  return markers.some((sel) => $(sel).length > 0);
}
