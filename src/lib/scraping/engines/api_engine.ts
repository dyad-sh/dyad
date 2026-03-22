/**
 * API Engine — Direct REST/GraphQL endpoint extraction.
 *
 * Best for: JSON API endpoints, GraphQL queries, paginated REST APIs.
 * No DOM parsing overhead.
 */

import { net } from "electron";
import log from "electron-log";
import { BaseEngine } from "./base_engine";
import type { EngineType, ProbeResult, ScrapeOptions, ScrapeResult } from "../types";

const logger = log.scope("scraping:api-engine");

export class APIEngine extends BaseEngine {
  readonly name: EngineType = "api";

  canHandle(probe: ProbeResult): boolean {
    return probe.isApiEndpoint;
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const start = Date.now();
    const timeout = options.timeout ?? 30_000;

    return new Promise<ScrapeResult>((resolve, reject) => {
      const request = net.request({ url, method: "GET" });

      const ua = options.userAgent ?? this.getDefaultUserAgent();
      request.setHeader("User-Agent", ua);
      request.setHeader("Accept", "application/json, text/plain, */*");

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          request.setHeader(key, value);
        }
      }

      if (options.cookies?.length) {
        const cookieStr = options.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        request.setHeader("Cookie", cookieStr);
      }

      const timer = setTimeout(() => {
        request.abort();
        reject(new Error(`API request timeout after ${timeout}ms for ${url}`));
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
          chunks.push(chunk);
        });

        response.on("end", () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks).toString("utf-8");

          resolve(
            this.buildResult(url, {
              html: body,
              statusCode: response.statusCode,
              finalUrl: url,
              contentType: responseHeaders["content-type"] ?? "application/json",
              headers: responseHeaders,
              fetchDurationMs: Date.now() - start,
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
