/**
 * Static Engine — Fast HTML scraping via Electron net + cheerio.
 *
 * Best for: Simple HTML pages, RSS feeds, sitemaps, API responses.
 * Zero browser overhead. Typically < 200ms per page.
 */

import { net } from "electron";
import log from "electron-log";
import { BaseEngine } from "./base_engine";
import type { EngineType, ProbeResult, ScrapeOptions, ScrapeResult, CookieEntry } from "../types";

const logger = log.scope("scraping:static-engine");

export class StaticEngine extends BaseEngine {
  readonly name: EngineType = "static";

  canHandle(probe: ProbeResult): boolean {
    return probe.isStaticHtml && !probe.hasJavaScript && !probe.hasBotProtection;
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const start = Date.now();
    const timeout = options.timeout ?? 30_000;
    const maxSize = options.maxResponseSize ?? 10 * 1024 * 1024; // 10 MB

    return new Promise<ScrapeResult>((resolve, reject) => {
      const request = net.request({ url, method: "GET" });

      // Set headers
      const ua = options.userAgent ?? this.getDefaultUserAgent();
      request.setHeader("User-Agent", ua);
      request.setHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      request.setHeader("Accept-Language", "en-US,en;q=0.9");
      request.setHeader("Accept-Encoding", "gzip, deflate");

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          request.setHeader(key, value);
        }
      }

      // Set cookies
      if (options.cookies?.length) {
        const cookieStr = options.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        request.setHeader("Cookie", cookieStr);
      }

      // Timeout
      const timer = setTimeout(() => {
        request.abort();
        reject(new Error(`Timeout after ${timeout}ms fetching ${url}`));
      }, timeout);

      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const responseHeaders: Record<string, string> = {};

        if (response.headers) {
          for (const [k, v] of Object.entries(response.headers)) {
            responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v[0] : (v ?? "");
          }
        }

        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxSize) {
            request.abort();
            clearTimeout(timer);
            reject(new Error(`Response exceeds max size of ${maxSize} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          clearTimeout(timer);
          const html = Buffer.concat(chunks).toString("utf-8");
          const duration = Date.now() - start;

          // Parse Set-Cookie headers into CookieEntry[]
          const cookies = parseSetCookies(
            responseHeaders["set-cookie"] ?? "",
            url,
          );

          // Detect final URL from redirects
          const finalUrl = responseHeaders["location"]
            ? new URL(responseHeaders["location"], url).href
            : url;

          resolve(
            this.buildResult(url, {
              html,
              statusCode: response.statusCode,
              finalUrl,
              contentType: responseHeaders["content-type"] ?? "text/html",
              headers: responseHeaders,
              cookies,
              fetchDurationMs: duration,
              bytesReceived: totalBytes,
            }),
          );
        });

        response.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      request.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      request.end();
    });
  }
}

/**
 * Parse Set-Cookie header string into structured cookie entries.
 */
function parseSetCookies(header: string, url: string): CookieEntry[] {
  if (!header) return [];
  const domain = new URL(url).hostname;

  return header.split(/,(?=\s*\w+=)/).map((raw) => {
    const parts = raw.trim().split(";").map((p) => p.trim());
    const [nameValue, ...attrs] = parts;
    const eqIdx = nameValue.indexOf("=");
    const name = nameValue.substring(0, eqIdx).trim();
    const value = nameValue.substring(eqIdx + 1).trim();

    const cookie: CookieEntry = { name, value, domain, path: "/" };

    for (const attr of attrs) {
      const [ak, av] = attr.split("=").map((s) => s.trim());
      const key = ak.toLowerCase();
      if (key === "domain") cookie.domain = av ?? domain;
      else if (key === "path") cookie.path = av ?? "/";
      else if (key === "expires") cookie.expires = new Date(av).getTime();
      else if (key === "httponly") cookie.httpOnly = true;
      else if (key === "secure") cookie.secure = true;
      else if (key === "samesite")
        cookie.sameSite = av as CookieEntry["sameSite"];
    }

    return cookie;
  });
}
