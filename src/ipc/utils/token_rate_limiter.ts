import log from "electron-log";

const logger = log.scope("rate_limiter");

/**
 * Per-minute sliding-window rate limiter for API token usage.
 * Tracks input tokens sent per provider and delays requests
 * that would exceed the rate limit.
 */

interface TokenRecord {
  tokens: number;
  timestamp: number;
}

interface ProviderLimits {
  inputTokensPerMinute: number;
}

// Known rate limits per provider at Tier 1 (conservative defaults).
// Users on higher tiers will rarely hit these.
const DEFAULT_PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  anthropic: { inputTokensPerMinute: 30_000 },
  // Other providers have much higher limits; add as needed
};

class TokenRateLimiter {
  // Sliding window of token records per provider
  private records: Map<string, TokenRecord[]> = new Map();

  // Allow overriding limits at runtime (e.g. from settings)
  private overrides: Map<string, ProviderLimits> = new Map();

  private readonly WINDOW_MS = 60_000; // 1 minute

  /**
   * Set a custom rate limit for a provider.
   */
  setProviderLimit(
    providerId: string,
    limits: ProviderLimits,
  ): void {
    this.overrides.set(providerId, limits);
  }

  /**
   * Get the effective limit for a provider.
   */
  private getLimit(providerId: string): ProviderLimits | undefined {
    return (
      this.overrides.get(providerId) ??
      DEFAULT_PROVIDER_LIMITS[providerId]
    );
  }

  /**
   * Purge records older than the sliding window.
   */
  private purgeOld(providerId: string): void {
    const now = Date.now();
    const records = this.records.get(providerId);
    if (!records) return;

    const cutoff = now - this.WINDOW_MS;
    // Remove records older than the window
    while (records.length > 0 && records[0].timestamp < cutoff) {
      records.shift();
    }
  }

  /**
   * Get the total tokens used in the current window for a provider.
   */
  getTokensUsedInWindow(providerId: string): number {
    this.purgeOld(providerId);
    const records = this.records.get(providerId) ?? [];
    return records.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Calculate how long to wait (in ms) before sending `tokenCount` tokens
   * for the given provider. Returns 0 if no wait is needed.
   */
  getRequiredDelay(providerId: string, tokenCount: number): number {
    const limit = this.getLimit(providerId);
    if (!limit) return 0; // No known limit — no delay

    this.purgeOld(providerId);
    const records = this.records.get(providerId) ?? [];
    const usedTokens = records.reduce((sum, r) => sum + r.tokens, 0);

    if (usedTokens + tokenCount <= limit.inputTokensPerMinute) {
      return 0; // Fits in the current window
    }

    // Need to wait until enough tokens expire from the window.
    // Find the earliest record that, once expired, frees enough capacity.
    const tokensNeeded = usedTokens + tokenCount - limit.inputTokensPerMinute;
    let freedTokens = 0;

    for (const record of records) {
      freedTokens += record.tokens;
      if (freedTokens >= tokensNeeded) {
        // Wait until this record expires from the window
        const waitUntil = record.timestamp + this.WINDOW_MS;
        const delay = Math.max(0, waitUntil - Date.now() + 500); // +500ms safety margin
        return delay;
      }
    }

    // If we can't free enough even after all records expire, wait the full window
    return this.WINDOW_MS + 500;
  }

  /**
   * Record that we sent `tokenCount` input tokens for a provider.
   */
  recordUsage(providerId: string, tokenCount: number): void {
    if (!this.records.has(providerId)) {
      this.records.set(providerId, []);
    }
    this.records.get(providerId)!.push({
      tokens: tokenCount,
      timestamp: Date.now(),
    });
  }

  /**
   * Wait if necessary, then record usage. Call this before sending a request.
   * Returns the actual delay waited (0 if none).
   */
  async waitAndRecord(
    providerId: string,
    estimatedTokens: number,
  ): Promise<number> {
    // Apply 1.3x safety multiplier: our estimation doesn't account for
    // tool schemas, per-message overhead, XML formatting overhead, etc.
    // that Anthropic counts as input tokens.
    const safeEstimate = Math.ceil(estimatedTokens * 1.3);
    const delay = this.getRequiredDelay(providerId, safeEstimate);

    if (delay > 0) {
      logger.log(
        `Rate limit: waiting ${Math.round(delay / 1000)}s before sending ~${safeEstimate} tokens to ${providerId} ` +
          `(${this.getTokensUsedInWindow(providerId)} tokens used in window)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.recordUsage(providerId, safeEstimate);
    return delay;
  }
}

// Singleton instance
export const tokenRateLimiter = new TokenRateLimiter();
