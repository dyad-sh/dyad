/**
 * Stealth Engine — Playwright with all anti-detection patches applied.
 *
 * Extends BrowserEngine with stealth evasion techniques to bypass
 * Cloudflare, Akamai, DataDome, PerimeterX, and similar protections.
 */

import * as pw from "playwright-core";
import log from "electron-log";
import path from "node:path";
import { BaseEngine } from "./base_engine";
import { applyStealthPatches, type StealthContext } from "../anti_bot/stealth_patches";
import type { EngineType, ProbeResult, ScrapeOptions, ScrapeResult, CookieEntry, StealthConfig } from "../types";

const logger = log.scope("scraping:stealth-engine");

let _browser: pw.Browser | null = null;
let _launchPromise: Promise<pw.Browser> | null = null;

/** Realistic viewport sizes from real device data */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 1600, height: 900 },
  { width: 1680, height: 1050 },
];

/** Realistic desktop User-Agents */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
];

function findChromiumPath(): string | undefined {
  const fs = require("node:fs");
  try {
    const pwPath = pw.chromium.executablePath();
    if (pwPath && fs.existsSync(pwPath)) return pwPath;
  } catch { /* not installed */ }

  const candidates: string[] = [];
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA ?? "";
    const progFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    candidates.push(
      path.join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium");
  }

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return undefined;
}

async function getBrowser(): Promise<pw.Browser> {
  if (_browser?.isConnected()) return _browser;
  if (_launchPromise) return _launchPromise;

  _launchPromise = (async () => {
    const executablePath = findChromiumPath();
    logger.info("Launching stealth Chromium from:", executablePath ?? "(playwright default)");

    _browser = await pw.chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--flag-switches-begin",
        "--flag-switches-end",
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

export class StealthEngine extends BaseEngine {
  readonly name: EngineType = "stealth";

  private defaultStealth: StealthConfig = {
    spoofWebdriver: true,
    spoofPlugins: true,
    spoofLanguages: true,
    spoofChrome: true,
    spoofPermissions: true,
    randomizeCanvas: true,
    randomizeAudioContext: true,
    spoofWebGL: true,
    spoofScreen: true,
    humanMouse: true,
    humanTyping: true,
    humanScroll: true,
    randomViewport: true,
    randomUserAgent: true,
    persistCookies: true,
  };

  canHandle(probe: ProbeResult): boolean {
    return probe.hasBotProtection || probe.hasCloudflare || probe.hasAkamai;
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const start = Date.now();
    const timeout = options.timeout ?? 45_000; // Longer timeout for stealth
    const browser = await getBrowser();

    // Random viewport + UA per session
    const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    const userAgent = options.userAgent ?? USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const context = await browser.newContext({
      userAgent,
      viewport,
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "America/New_York",
      deviceScaleFactor: Math.random() > 0.5 ? 2 : 1,
      hasTouch: false,
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

    // Block resources for speed
    if (options.blockResources?.length) {
      await context.route("**/*", (route) => {
        const rt = route.request().resourceType();
        if (options.blockResources!.includes(rt as never)) return route.abort();
        return route.continue();
      });
    }

    const page = await context.newPage();

    try {
      // Apply stealth patches BEFORE navigation
      const stealthCtx: StealthContext = { page, config: this.defaultStealth, userAgent };
      await applyStealthPatches(stealthCtx);

      if (options.headers) {
        await page.setExtraHTTPHeaders(options.headers);
      }

      // Navigate — use domcontentloaded first, then wait for networkidle briefly.
      // networkidle can hang forever on sites with persistent connections or analytics.
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      // Give the page a few extra seconds for network to settle (best-effort)
      await page.waitForLoadState("networkidle").catch(() => {
        logger.debug("networkidle timed out — proceeding with what we have");
      });

      // Wait for Cloudflare challenge if present
      await this.waitForCFClearance(page, timeout);

      // Wait for selector
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: Math.min(timeout, 10_000),
        }).catch(() => logger.warn("Wait selector not found"));
      }

      // Human-like delay
      await page.waitForTimeout(500 + Math.random() * 1500);

      // Human-like scroll
      if (options.scrollToBottom) {
        await humanScroll(page);
      }

      const html = await page.content();

      // Screenshot
      let screenshotPath: string | undefined;
      if (options.screenshot) {
        const { app } = require("electron");
        const dir = path.join(app.getPath("userData"), "scraping-screenshots");
        require("node:fs").mkdirSync(dir, { recursive: true });
        screenshotPath = path.join(dir, `stealth-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      // Cookies
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

      const responseHeaders: Record<string, string> = {};
      if (response) {
        for (const [k, v] of Object.entries(await response.allHeaders())) {
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

  /**
   * Wait for Cloudflare challenge to resolve.
   */
  private async waitForCFClearance(page: pw.Page, timeout: number): Promise<void> {
    const cfSelectors = [
      "#cf-challenge-running",
      ".cf-browser-verification",
      "#challenge-running",
      "#challenge-form",
      "[id*='turnstile']",
    ];

    for (const sel of cfSelectors) {
      const el = await page.$(sel);
      if (el) {
        logger.info("Cloudflare challenge detected, waiting for clearance...");
        await page.waitForSelector(sel, { state: "detached", timeout: Math.min(timeout, 30_000) })
          .catch(() => logger.warn("CF challenge did not resolve within timeout"));
        await page.waitForTimeout(1000); // Extra wait after challenge clears
        return;
      }
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
 * Human-like scrolling with easing and pauses.
 */
async function humanScroll(page: pw.Page, maxScrolls = 15): Promise<void> {
  await page.evaluate(async (max: number) => {
    await new Promise<void>((resolve) => {
      let count = 0;
      const scroll = () => {
        if (count >= max || window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          resolve();
          return;
        }
        const distance = 200 + Math.random() * 400;
        window.scrollBy({ top: distance, behavior: "smooth" });
        count++;
        const delay = 300 + Math.random() * 700;
        setTimeout(scroll, delay);
      };
      scroll();
    });
  }, maxScrolls);
}
