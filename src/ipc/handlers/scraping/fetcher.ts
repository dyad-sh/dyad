/**
 * Hybrid Fetcher — HTTP-first with Playwright fallback
 *
 * Strategy:
 *  1. Try Electron's net.request() (fast, no overhead)
 *  2. Detect if the page is a JS-rendered shell (SPA markers)
 *  3. If so, re-fetch with Playwright headless Chromium
 */

import { net } from "electron";
import log from "electron-log";
import type { ScrapingConfig } from "./types";

const logger = log.scope("scraping:fetcher");

// ── Types ───────────────────────────────────────────────────────────────────

export interface FetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  method: "http" | "playwright";
  durationMs: number;
  screenshotPath?: string;
  headers: Record<string, string>;
}

interface FetchOptions {
  url: string;
  config: ScrapingConfig;
  /** Force a specific fetch method instead of auto-detect */
  forceMethod?: "http" | "playwright";
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function fetchPage(opts: FetchOptions): Promise<FetchResult> {
  const start = Date.now();
  const method = opts.forceMethod ?? resolveMethod(opts.config);

  if (method === "playwright") {
    return fetchWithPlaywright(opts.url, opts.config, start);
  }

  // HTTP first
  const httpResult = await fetchWithHttp(opts.url, opts.config, start);

  // If hybrid mode, check if the page needs JS rendering
  if (
    opts.config.mode === "hybrid" &&
    needsJsRendering(httpResult.html)
  ) {
    logger.info(`SPA detected for ${opts.url}, falling back to Playwright`);
    return fetchWithPlaywright(opts.url, opts.config, start);
  }

  return httpResult;
}

// ── robots.txt ──────────────────────────────────────────────────────────────

const robotsCache = new Map<string, { allowed: Set<string>; disallowed: Set<string>; fetchedAt: number }>();

export async function isAllowedByRobots(url: string, userAgent = "JoyCreate-Scraper"): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const cacheKey = parsed.host;

    if (!robotsCache.has(cacheKey) || Date.now() - robotsCache.get(cacheKey)!.fetchedAt > 3600_000) {
      const res = await fetchRaw(robotsUrl, { timeout: 10_000 });
      const rules = parseRobotsTxt(res.content, userAgent);
      robotsCache.set(cacheKey, { ...rules, fetchedAt: Date.now() });
    }

    const cached = robotsCache.get(cacheKey)!;
    const pathStr = parsed.pathname + parsed.search;

    for (const disPath of cached.disallowed) {
      if (pathStr.startsWith(disPath)) {
        // Check if specifically allowed
        for (const alPath of cached.allowed) {
          if (pathStr.startsWith(alPath)) return true;
        }
        return false;
      }
    }
    return true;
  } catch {
    // If robots.txt can't be fetched, assume allowed
    return true;
  }
}

function parseRobotsTxt(content: string, ua: string): { allowed: Set<string>; disallowed: Set<string> } {
  const allowed = new Set<string>();
  const disallowed = new Set<string>();
  let isRelevantBlock = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [directive, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const dir = directive.trim().toLowerCase();

    if (dir === "user-agent") {
      isRelevantBlock = value === "*" || value.toLowerCase().includes(ua.toLowerCase());
    } else if (isRelevantBlock) {
      if (dir === "disallow" && value) disallowed.add(value);
      if (dir === "allow" && value) allowed.add(value);
    }
  }

  return { allowed, disallowed };
}

// ── HTTP fetcher (Electron net) ─────────────────────────────────────────────

async function fetchWithHttp(
  url: string,
  config: ScrapingConfig,
  startTime: number,
): Promise<FetchResult> {
  const result = await fetchRaw(url, {
    method: config.api?.method || "GET",
    headers: {
      "User-Agent": "JoyCreate-Scraper/2.0 (Dataset Collection)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...config.auth?.customHeaders,
      ...config.api?.headers,
      ...(config.auth?.type === "bearer" && config.auth.token
        ? { Authorization: `Bearer ${config.auth.token}` }
        : {}),
      ...(config.auth?.type === "cookie" && config.auth.cookies
        ? { Cookie: config.auth.cookies }
        : {}),
    },
    body: config.api?.body ? JSON.stringify(config.api.body) : undefined,
    timeout: 30_000,
  });

  return {
    html: result.content,
    finalUrl: url, // net.request doesn't expose redirect chain
    statusCode: result.status,
    contentType: result.contentType,
    method: "http",
    durationMs: Date.now() - startTime,
    headers: result.headers,
  };
}

// ── Playwright fetcher ──────────────────────────────────────────────────────

let _playwrightAvailable: boolean | null = null;

async function isPlaywrightAvailable(): Promise<boolean> {
  if (_playwrightAvailable !== null) return _playwrightAvailable;
  try {
    await import("playwright-core");
    _playwrightAvailable = true;
  } catch {
    _playwrightAvailable = false;
    logger.warn("playwright-core not available — JS rendering disabled");
  }
  return _playwrightAvailable;
}

async function fetchWithPlaywright(
  url: string,
  config: ScrapingConfig,
  startTime: number,
): Promise<FetchResult> {
  if (!(await isPlaywrightAvailable())) {
    logger.warn("Playwright not available, falling back to HTTP");
    return fetchWithHttp(url, config, startTime);
  }

  const pw = await import("playwright-core");

  // Try to find an installed Chromium
  const executablePath = await findChromiumPath();
  if (!executablePath) {
    logger.warn("No Chromium found for Playwright, falling back to HTTP");
    return fetchWithHttp(url, config, startTime);
  }

  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent: "JoyCreate-Scraper/2.0 (Dataset Collection)",
      viewport: { width: 1280, height: 800 },
      ...(config.proxy
        ? {
          proxy: {
            server: config.proxy.url,
            username: config.proxy.username,
            password: config.proxy.password,
          },
        }
        : {}),
    });

    const page = await context.newPage();

    // Block optional resources for speed
    if (config.playwrightOptions?.blockResources?.length) {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (config.playwrightOptions?.blockResources?.includes(resourceType as "image" | "stylesheet" | "font" | "media")) {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Set auth cookies if provided
    if (config.auth?.type === "cookie" && config.auth.cookies) {
      const parsed = new URL(url);
      const cookies = config.auth.cookies.split(";").map((c) => {
        const [name, ...valParts] = c.trim().split("=");
        return {
          name: name.trim(),
          value: valParts.join("=").trim(),
          domain: parsed.hostname,
          path: "/",
        };
      });
      await context.addCookies(cookies);
    }

    // Navigate — use domcontentloaded to avoid hanging on persistent connections
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    // Best-effort wait for idle network (don't block forever)
    await page.waitForLoadState("networkidle").catch(() => {
      // Sites with analytics/websockets may never reach networkidle
    });

    // Wait for additional selectors if specified
    if (config.playwrightOptions?.waitForSelector) {
      await page.waitForSelector(config.playwrightOptions.waitForSelector, {
        timeout: config.playwrightOptions.waitForTimeout ?? 10_000,
      });
    } else if (config.playwrightOptions?.waitForTimeout) {
      await page.waitForTimeout(config.playwrightOptions.waitForTimeout);
    }

    // Scroll to bottom for lazy-loaded content
    if (config.playwrightOptions?.scrollToBottom) {
      await autoScroll(page);
    }

    // Click "load more" buttons
    if (config.playwrightOptions?.clickSelectors?.length) {
      for (const sel of config.playwrightOptions.clickSelectors) {
        try {
          const btn = page.locator(sel);
          let clicks = 0;
          while ((await btn.count()) > 0 && clicks < 10) {
            await btn.first().click();
            await page.waitForTimeout(1_000);
            clicks++;
          }
        } catch {
          // button gone or selector invalid — continue
        }
      }
    }

    const html = await page.content();
    const finalUrl = page.url();
    const statusCode = response?.status() ?? 200;
    const contentType = response?.headers()?.["content-type"] ?? "text/html";

    // Optional screenshot
    let screenshotPath: string | undefined;
    if (config.playwrightOptions?.screenshot) {
      const { app: electronApp } = await import("electron");
      const ssDir = path.join(electronApp.getPath("userData"), "scraping-screenshots");
      await ensureDir(ssDir);
      screenshotPath = path.join(ssDir, `${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    const responseHeaders: Record<string, string> = {};
    if (response) {
      const headerObj = response.headers();
      for (const [k, v] of Object.entries(headerObj)) {
        responseHeaders[k] = String(v);
      }
    }

    return {
      html,
      finalUrl,
      statusCode,
      contentType,
      method: "playwright",
      durationMs: Date.now() - startTime,
      screenshotPath,
      headers: responseHeaders,
    };
  } finally {
    await browser.close();
  }
}

// ── SPA detection heuristic ─────────────────────────────────────────────────

const SPA_MARKERS = [
  /<div\s+id="(?:root|app|__next|__nuxt)"[^>]*>\s*<\/div>/i,
  /<div\s+id="(?:root|app|__next|__nuxt)"[^>]*><\/div>/i,
  /window\.__NEXT_DATA__/i,
  /window\.__NUXT__/i,
  /__remixContext/i,
  /data-reactroot/i,
  /ng-version/i,
];

function needsJsRendering(html: string): boolean {
  // If very small body, likely SPA shell
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyText = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (bodyText.length < 100) return true;
  }

  // Check for known SPA framework markers
  for (const marker of SPA_MARKERS) {
    if (marker.test(html)) return true;
  }

  // Lots of <noscript> content relative to body = JS-dependent
  const noscriptMatches = html.match(/<noscript/gi);
  if (noscriptMatches && noscriptMatches.length > 2) return true;

  return false;
}

// ── Chromium path detection ─────────────────────────────────────────────────

async function findChromiumPath(): Promise<string | null> {
  // Common locations by platform
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    candidates.push(
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Chromium\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  }

  // Also check Playwright's bundled browsers
  try {
    const pw = await import("playwright-core");
    const execPath = (pw.chromium as any).executablePath?.();
    if (execPath) candidates.unshift(execPath);
  } catch {
    // ignore
  }

  const fsExtra = await import("fs-extra");
  for (const p of candidates) {
    if (await fsExtra.pathExists(p)) {
      logger.info(`Found Chromium at ${p}`);
      return p;
    }
  }

  logger.warn("No Chromium installation found");
  return null;
}

// ── Auto-scroll for lazy-loaded content ─────────────────────────────────────

async function autoScroll(page: any): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const maxScrolls = 50;
      let scrolls = 0;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrolls++;
        if (totalHeight >= scrollHeight || scrolls >= maxScrolls) {
          clearInterval(timer);
          window.scrollTo(0, 0); // scroll back to top
          resolve();
        }
      }, 200);
    });
  });
}

// ── Low-level fetch using Electron's net module ─────────────────────────────

interface RawFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface RawFetchResult {
  content: string;
  contentType: string;
  status: number;
  headers: Record<string, string>;
}

export function fetchRaw(url: string, options: RawFetchOptions = {}): Promise<RawFetchResult> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: (options.method || "GET") as any,
      url,
    });

    // Timeout
    const timer = options.timeout
      ? setTimeout(() => {
        request.abort();
        reject(new Error(`Request timeout after ${options.timeout}ms: ${url}`));
      }, options.timeout)
      : null;

    // Headers
    request.setHeader("User-Agent", "JoyCreate-Scraper/2.0 (Dataset Collection)");
    request.setHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        request.setHeader(key, value);
      }
    }

    let responseData = "";
    let contentType = "text/html";
    let status = 0;
    const responseHeaders: Record<string, string> = {};

    request.on("response", (response) => {
      status = response.statusCode;
      const ct = response.headers["content-type"];
      contentType = Array.isArray(ct) ? ct[0] : ct || "text/html";

      for (const [k, v] of Object.entries(response.headers)) {
        responseHeaders[k] = Array.isArray(v) ? v[0] : (v ?? "");
      }

      response.on("data", (chunk) => {
        responseData += chunk.toString();
      });

      response.on("end", () => {
        if (timer) clearTimeout(timer);
        resolve({ content: responseData, contentType, status, headers: responseHeaders });
      });

      response.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });

    request.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveMethod(config: ScrapingConfig): "http" | "playwright" {
  if (config.mode === "playwright") return "playwright";
  if (config.mode === "http") return "http";
  return "http"; // hybrid starts with http
}

// resolve path import for screenshot
import * as path from "path";
import { ensureDir } from "fs-extra";
