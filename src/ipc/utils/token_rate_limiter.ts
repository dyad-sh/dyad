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
    // Apply 1.5x safety multiplier: our estimation doesn't account for
    // tool schemas, per-message overhead, XML formatting overhead, etc.
    // that Anthropic counts as input tokens.
    const safeEstimate = Math.ceil(estimatedTokens * 1.5);

    // Auto-queue: if the window is already >70% utilized, add a minimum
    // cooldown delay even if we technically fit. This prevents rapid-fire
    // messages from stacking up and hitting the hard limit.
    const limit = this.getLimit(providerId);
    let totalDelay = 0;
    if (limit) {
      const currentUsage = this.getTokensUsedInWindow(providerId);
      const utilization = currentUsage / limit.inputTokensPerMinute;
      if (utilization > 0.7) {
        // Scale delay: 70% → 3s, 80% → 6s, 90% → 10s
        const cooldownMs = Math.ceil((utilization - 0.7) * 33_000);
        logger.log(
          `Rate limiter: ${Math.round(utilization * 100)}% utilized, adding ${Math.round(cooldownMs / 1000)}s cooldown`,
        );
        await new Promise((resolve) => setTimeout(resolve, cooldownMs));
        totalDelay += cooldownMs;
      }
    }

    const delay = this.getRequiredDelay(providerId, safeEstimate);

    if (delay > 0) {
      logger.log(
        `Rate limit: waiting ${Math.round(delay / 1000)}s before sending ~${safeEstimate} tokens to ${providerId} ` +
          `(${this.getTokensUsedInWindow(providerId)} tokens used in window)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      totalDelay += delay;
    }

    this.recordUsage(providerId, safeEstimate);
    return totalDelay;
  }

  /**
   * Correct the rate limiter when actual usage differs from the estimate.
   * If actual > recorded, adds the difference. If actual < recorded,
   * reduces the window usage so future requests get through sooner.
   */
  correctUsage(
    providerId: string,
    estimatedTokens: number,
    actualTokens: number,
  ): void {
    const recorded = Math.ceil(estimatedTokens * 1.5);
    if (actualTokens > recorded) {
      const correction = actualTokens - recorded;
      this.recordUsage(providerId, correction);
      logger.log(
        `Rate limiter correction: actual ${actualTokens} > estimated ${recorded}, added ${correction} tokens`,
      );
    } else if (actualTokens < recorded * 0.7) {
      // Actual was much less than recorded — remove the excess from the window
      // so we don't unnecessarily block future requests.
      const excess = recorded - actualTokens;
      const records = this.records.get(providerId);
      if (records && records.length > 0) {
        // Reduce the most recent record by the excess amount
        const last = records[records.length - 1];
        last.tokens = Math.max(0, last.tokens - excess);
        logger.log(
          `Rate limiter correction: actual ${actualTokens} << estimated ${recorded}, freed ${excess} tokens`,
        );
      }
    }
  }
}

// Singleton instance
export const tokenRateLimiter = new TokenRateLimiter();
