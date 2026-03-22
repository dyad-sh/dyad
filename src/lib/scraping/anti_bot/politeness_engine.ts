/**
 * Politeness Engine — Rate limiting, robots.txt, adaptive delays.
 *
 * Uses token bucket algorithm for per-domain rate limiting and
 * respects robots.txt rules with caching.
 */

import { net } from "electron";
import log from "electron-log";

const logger = log.scope("scraping:politeness");

// ── Token Bucket Rate Limiter ───────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();
const robotsCache = new Map<string, { rules: RobotsRules; expiresAt: number }>();

/**
 * Get or create a token bucket for a domain.
 */
function getBucket(domain: string, requestsPerSecond: number): TokenBucket {
  let bucket = buckets.get(domain);
  if (!bucket) {
    bucket = {
      tokens: requestsPerSecond,
      maxTokens: requestsPerSecond * 2, // burst allowance
      refillRate: requestsPerSecond,
      lastRefill: Date.now(),
    };
    buckets.set(domain, bucket);
  }
  return bucket;
}

/**
 * Wait until a token is available for the given domain.
 */
export async function waitForToken(
  domain: string,
  requestsPerSecond = 2,
): Promise<void> {
  const bucket = getBucket(domain, requestsPerSecond);

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    bucket.maxTokens,
    bucket.tokens + elapsed * bucket.refillRate,
  );
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  // Wait for a token to become available
  const waitMs = ((1 - bucket.tokens) / bucket.refillRate) * 1000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  bucket.tokens = 0;
  bucket.lastRefill = Date.now();
}

/**
 * Adaptive delay — increase delay on errors, decrease on success.
 */
const adaptiveDelays = new Map<string, number>();

export function getAdaptiveDelay(domain: string, baseDelayMs: number): number {
  return adaptiveDelays.get(domain) ?? baseDelayMs;
}

export function adjustDelay(
  domain: string,
  statusCode: number,
  baseDelayMs: number,
): void {
  const current = adaptiveDelays.get(domain) ?? baseDelayMs;

  if (statusCode === 429 || statusCode === 503) {
    // Rate limited — double the delay (max 60s)
    adaptiveDelays.set(domain, Math.min(current * 2, 60_000));
    logger.warn(`Rate limited on ${domain}, increasing delay to ${adaptiveDelays.get(domain)}ms`);
  } else if (statusCode >= 200 && statusCode < 300) {
    // Success — gradually decrease delay (min: baseDelayMs)
    adaptiveDelays.set(domain, Math.max(current * 0.9, baseDelayMs));
  }
}

/**
 * Random delay within a range for human-like timing variance.
 */
export async function randomDelay(
  minMs: number,
  maxMs: number,
): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

// ── Robots.txt Parser ───────────────────────────────────────────────────────

interface RobotsRules {
  allowed: string[];
  disallowed: string[];
  crawlDelay?: number;
  sitemaps: string[];
}

/**
 * Parse robots.txt content into structured rules.
 */
function parseRobotsTxt(content: string): RobotsRules {
  const rules: RobotsRules = { allowed: [], disallowed: [], sitemaps: [] };
  let isRelevant = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [directive, ...valueParts] = trimmed.split(":");
    const value = valueParts.join(":").trim();
    const dirLower = directive.toLowerCase().trim();

    if (dirLower === "user-agent") {
      isRelevant = value === "*" || value.toLowerCase().includes("bot");
    } else if (isRelevant) {
      if (dirLower === "disallow" && value) {
        rules.disallowed.push(value);
      } else if (dirLower === "allow" && value) {
        rules.allowed.push(value);
      } else if (dirLower === "crawl-delay" && value) {
        rules.crawlDelay = parseFloat(value);
      }
    }

    if (dirLower === "sitemap" && value) {
      rules.sitemaps.push(value);
    }
  }

  return rules;
}

/**
 * Fetch and cache robots.txt for a domain (1-hour TTL).
 */
export async function getRobotsRules(domain: string): Promise<RobotsRules> {
  const cached = robotsCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rules;
  }

  try {
    const robotsUrl = `https://${domain}/robots.txt`;
    const content = await new Promise<string>((resolve, reject) => {
      const request = net.request(robotsUrl);
      request.setHeader("User-Agent", "JoyCreate-Scraper/2.0");
      let body = "";
      request.on("response", (resp) => {
        if (resp.statusCode !== 200) {
          resolve(""); // No robots.txt or error → allow all
          return;
        }
        resp.on("data", (chunk) => { body += chunk.toString(); });
        resp.on("end", () => resolve(body));
      });
      request.on("error", () => resolve("")); // Allow on error
      request.end();
    });

    const rules = parseRobotsTxt(content);
    robotsCache.set(domain, {
      rules,
      expiresAt: Date.now() + 3_600_000, // 1 hour TTL
    });
    return rules;
  } catch {
    return { allowed: [], disallowed: [], sitemaps: [] };
  }
}

/**
 * Check if a URL path is allowed by robots.txt rules.
 */
export async function isUrlAllowed(url: string, respectRobots = true): Promise<boolean> {
  if (!respectRobots) return true;

  try {
    const parsed = new URL(url);
    const rules = await getRobotsRules(parsed.hostname);
    const path = parsed.pathname;

    // Check Allow rules first (they take precedence)
    for (const pattern of rules.allowed) {
      if (path.startsWith(pattern)) return true;
    }

    // Check Disallow rules
    for (const pattern of rules.disallowed) {
      if (pattern === "/" && rules.allowed.length === 0) return false; // Disallow all
      if (path.startsWith(pattern)) return false;
    }

    return true;
  } catch {
    return true; // Allow on parse error
  }
}

/**
 * Clear all caches (for testing or cleanup).
 */
export function clearPolitenessState(): void {
  buckets.clear();
  robotsCache.clear();
  adaptiveDelays.clear();
}
