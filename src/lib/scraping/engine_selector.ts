/**
 * Engine Selector — Probes URLs and recommends the optimal scraping engine.
 *
 * Flow: HEAD request → inspect response headers + content → score each engine.
 */

import { net } from "electron";
import log from "electron-log";
import type { EngineType, ProbeResult, ScrapeOptions } from "./types";

const logger = log.scope("scraping:engine-selector");

/** Known bot-protection header signatures */
const CF_HEADERS = ["cf-ray", "cf-cache-status", "cf-request-id", "server"];
const AKAMAI_HEADERS = ["x-akamai-transformed", "x-akamai-request-id"];
const BOT_PROTECT_HEADERS = [
  "x-sucuri-id",
  "x-datadome",
  "x-distil-cs",
  "x-px-",
  "x-imperva-",
];

/** SPA framework markers in HTML */
const SPA_MARKERS = [
  "id=\"root\"",
  "id=\"app\"",
  "id=\"__next\"",
  "__NEXT_DATA__",
  "__NUXT__",
  "ng-version",
  "data-reactroot",
  "data-v-",
  "ember-view",
  "id=\"svelte\"",
];

/**
 * Probe a URL via HEAD request and analyze response to recommend an engine.
 */
export async function probeUrl(url: string): Promise<ProbeResult> {
  const start = Date.now();
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let contentType = "";

  try {
    const response = await new Promise<Electron.IncomingMessage>(
      (resolve, reject) => {
        const request = net.request({ url, method: "HEAD" });
        request.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        request.on("response", resolve);
        request.on("error", reject);
        request.end();
      },
    );

    statusCode = response.statusCode;
    response.headers && Object.entries(response.headers).forEach(([k, v]) => {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : (v ?? "");
    });
    contentType = headers["content-type"] ?? "";
  } catch (err) {
    logger.warn(`Probe failed for ${url}:`, err);
    // Fallback to browser engine on probe failure
    return {
      url,
      statusCode: 0,
      contentType: "",
      headers: {},
      hasCloudflare: false,
      hasAkamai: false,
      hasBotProtection: false,
      isStaticHtml: false,
      hasJavaScript: true,
      isApiEndpoint: false,
      responseTimeMs: Date.now() - start,
      recommendedEngine: "browser",
      confidence: 0.3,
    };
  }

  const responseTimeMs = Date.now() - start;

  // Detect protections
  const headerKeys = Object.keys(headers);
  const hasCloudflare =
    CF_HEADERS.some((h) => headerKeys.includes(h)) &&
    (headers["server"]?.toLowerCase().includes("cloudflare") ?? false);
  const hasAkamai = AKAMAI_HEADERS.some((h) => headerKeys.includes(h));
  const hasBotProtection =
    hasCloudflare ||
    hasAkamai ||
    BOT_PROTECT_HEADERS.some((h) => headerKeys.some((k) => k.startsWith(h)));

  // Detect API endpoints
  const isApiEndpoint =
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("text/xml");

  // Detect static vs dynamic
  const isStaticHtml =
    contentType.includes("text/html") && !hasBotProtection;

  const result: ProbeResult = {
    url,
    statusCode,
    contentType,
    headers,
    hasCloudflare,
    hasAkamai,
    hasBotProtection,
    isStaticHtml,
    hasJavaScript: false, // Will be updated if we do a GET check
    isApiEndpoint,
    responseTimeMs,
    recommendedEngine: "static",
    confidence: 0.5,
  };

  // Select engine
  result.recommendedEngine = selectEngine(result);
  result.confidence = engineConfidence(result);

  return result;
}

/**
 * Select the best engine based on probe results.
 */
export function selectEngine(probe: ProbeResult): EngineType {
  // API endpoint → api engine
  if (probe.isApiEndpoint) return "api";

  // Bot protection detected → stealth engine
  if (probe.hasBotProtection) return "stealth";

  // 403/503 status often means anti-bot → stealth
  if (probe.statusCode === 403 || probe.statusCode === 503) return "stealth";

  // Clean HTML with no JS indicators → static (fastest)
  if (probe.isStaticHtml && !probe.hasJavaScript) return "static";

  // Default to browser for JS-rendered content
  if (probe.hasJavaScript) return "browser";

  // Static HTML is the default for standard pages
  return "static";
}

/**
 * Confidence score for the engine recommendation.
 */
function engineConfidence(probe: ProbeResult): number {
  if (probe.statusCode === 0) return 0.3;
  if (probe.isApiEndpoint) return 0.95;
  if (probe.hasBotProtection) return 0.85;
  if (probe.isStaticHtml && !probe.hasJavaScript) return 0.9;
  return 0.6;
}

/**
 * Full content probe — fetches the page body to detect SPA markers.
 * More expensive than HEAD probe but more accurate.
 */
export async function deepProbe(
  url: string,
  headProbe?: ProbeResult,
): Promise<ProbeResult> {
  const probe = headProbe ?? (await probeUrl(url));

  // Only worth doing for HTML pages that might be SPAs
  if (!probe.contentType.includes("text/html") || probe.isApiEndpoint) {
    return probe;
  }

  try {
    const html = await new Promise<string>((resolve, reject) => {
      const request = net.request({ url, method: "GET" });
      request.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      let body = "";
      request.on("response", (resp) => {
        resp.on("data", (chunk) => {
          body += chunk.toString();
          // Only need first 50KB to detect SPA markers
          if (body.length > 50_000) {
            request.abort();
            resolve(body);
          }
        });
        resp.on("end", () => resolve(body));
      });
      request.on("error", reject);
      request.end();
    });

    const lowerHtml = html.toLowerCase();
    probe.hasJavaScript = SPA_MARKERS.some((m) =>
      lowerHtml.includes(m.toLowerCase()),
    );

    // Check for minimal body content (SPA indicator)
    const bodyMatch = lowerHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    if (bodyMatch) {
      const bodyText = bodyMatch[1].replace(/<[^>]+>/g, "").trim();
      if (bodyText.length < 100) {
        probe.hasJavaScript = true;
      }
    }

    probe.recommendedEngine = selectEngine(probe);
    probe.confidence = engineConfidence(probe);
  } catch {
    // Fall back to HEAD probe results
  }

  return probe;
}
