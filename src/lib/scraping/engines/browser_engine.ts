/**
 * Browser Engine — Full Playwright-powered browser scraping.
 *
 * Uses Electron-local Chromium via findChromiumPath() from the existing
 * fetcher module. Falls back to Playwright-managed Chromium if not found.
 *
 * Best for: JavaScript-rendered SPAs, pages requiring interaction.
 */

import * as pw from "playwright-core";
import log from "electron-log";
import path from "node:path";
import { BaseEngine } from "./base_engine";
import type { EngineType, ProbeResult, ScrapeOptions, ScrapeResult, CookieEntry } from "../types";

const logger = log.scope("scraping:browser-engine");

let _browser: pw.Browser | null = null;
let _launchPromise: Promise<pw.Browser> | null = null;

/**
 * Find a usable Chromium/Chrome executable on the system.
 * Checks Playwright bundled path first, then common install locations.
 */
function findChromiumPath(): string | undefined {
  const fs = require("node:fs");

  // 1. Playwright bundled chromium
  try {
    const pwPath = pw.chromium.executablePath();
    if (pwPath && fs.existsSync(pwPath)) return pwPath;
  } catch { /* not installed */ }

  // 2. Platform-specific paths
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA ?? "";
    const progFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const progFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    candidates.push(
      path.join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(progFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(progFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
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

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }

  return undefined;
}

/**
 * Get or launch a shared browser instance.
 */
async function getBrowser(): Promise<pw.Browser> {
  if (_browser?.isConnected()) return _browser;

  if (_launchPromise) return _launchPromise;

  _launchPromise = (async () => {
    const executablePath = findChromiumPath();
    logger.info("Launching Chromium from:", executablePath ?? "(playwright default)");

    _browser = await pw.chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    _browser.on("disconnected", () => {
      _browser = null;
      _launchPromise = null;
    });

    return _browser;
  })();

  return _launchPromise;
}

export class BrowserEngine extends BaseEngine {
  readonly name: EngineType = "browser";

  canHandle(probe: ProbeResult): boolean {
    return probe.hasJavaScript && !probe.hasBotProtection;
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const start = Date.now();
    const timeout = options.timeout ?? 30_000;
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: options.userAgent ?? this.getDefaultUserAgent(),
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      proxy: options.proxy
        ? {
            server: `${options.proxy.type}://${options.proxy.host}:${options.proxy.port}`,
            username: options.proxy.username,
            password: options.proxy.password,
          }
        : undefined,
    });

    // Inject cookies
    if (options.cookies?.length) {
      await context.addCookies(
        options.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires ? c.expires / 1000 : undefined,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
        })),
      );
    }

    // Block resources for faster loads
    if (options.blockResources?.length) {
      await context.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (options.blockResources!.includes(resourceType as never)) {
          return route.abort();
        }
        return route.continue();
      });
    }

    const page = await context.newPage();

    try {
      // Set extra headers
      if (options.headers) {
        await page.setExtraHTTPHeaders(options.headers);
      }

      // Navigate
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      // Wait for selector if specified
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: Math.min(timeout, 10_000),
        }).catch(() => {
          logger.warn(`Selector ${options.waitForSelector} not found within timeout`);
        });
      }

      // Wait a bit for dynamic content
      await page.waitForTimeout(500);

      // Scroll to bottom for lazy loading
      if (options.scrollToBottom) {
        await autoScroll(page);
      }

      // Get final HTML
      const html = await page.content();

      // Screenshot
      let screenshotPath: string | undefined;
      if (options.screenshot) {
        const { app } = require("electron");
        const screenshotDir = path.join(app.getPath("userData"), "scraping-screenshots");
        require("node:fs").mkdirSync(screenshotDir, { recursive: true });
        screenshotPath = path.join(screenshotDir, `${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      // Collect cookies from context
      const contextCookies = await context.cookies();
      const cookies: CookieEntry[] = contextCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires ? c.expires * 1000 : undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite === "None" ? "None" : c.sameSite === "Lax" ? "Lax" : "Strict",
      }));

      // Response headers
      const responseHeaders: Record<string, string> = {};
      if (response) {
        const allHeaders = await response.allHeaders();
        for (const [k, v] of Object.entries(allHeaders)) {
          responseHeaders[k.toLowerCase()] = v;
        }
      }

      return this.buildResult(url, {
        html,
        statusCode: response?.status() ?? 200,
        finalUrl: page.url(),
        contentType: responseHeaders["content-type"] ?? "text/html",
        headers: responseHeaders,
        cookies,
        screenshotPath,
        fetchDurationMs: Date.now() - start,
        bytesReceived: Buffer.byteLength(html, "utf-8"),
      });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    if (_browser) {
      await _browser.close().catch(() => {});
      _browser = null;
      _launchPromise = null;
    }
  }
}

/**
 * Auto-scroll page to trigger lazy loading.
 */
async function autoScroll(page: pw.Page, maxScrolls = 20): Promise<void> {
  await page.evaluate(async (max: number) => {
    await new Promise<void>((resolve) => {
      let scrollCount = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrollCount++;
        if (
          scrollCount >= max ||
          window.innerHeight + window.scrollY >= document.body.scrollHeight
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  }, maxScrolls);
}
