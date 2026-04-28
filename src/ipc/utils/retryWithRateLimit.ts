import log from "electron-log";

export const logger = log.scope("retryWithRateLimit");

/**
 * Custom error class for rate limit errors thrown from fetch responses.
 * This allows retryWithRateLimit to detect and retry on 429 responses.
 */
export class RateLimitError extends Error {
  public readonly status = 429;
  public readonly response: Response;
  /** Parsed Retry-After value in milliseconds, if the server supplied one. */
  public readonly retryAfterMs?: number;

  constructor(message: string, response: Response, retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitError";
    this.response = response;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parses a Retry-After header value per RFC 7231. The header is either a
 * non-negative integer number of seconds, or an HTTP-date. Returns the delay
 * in milliseconds, or undefined if the header is missing or unparseable.
 * Negative dates (in the past) clamp to 0.
 */
export function parseRetryAfter(
  headerValue: string | null,
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

/**
 * Checks if an error is a rate limit error (HTTP 429).
 */
export function isRateLimitError(error: any): boolean {
  // Check for RateLimitError instance
  if (error instanceof RateLimitError) {
    return true;
  }
  // Check for status property directly on error (e.g., RateLimitError)
  if (error?.status === 429) {
    return true;
  }
  // Check for nested response.status (legacy pattern)
  const status = error?.response?.status;
  return status === 429;
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 10,
  baseDelay: 2_000, // 2 seconds
  maxDelay: 30_000, // 30 seconds
  jitterFactor: 0.1, // 10% jitter
};

export interface RetryWithRateLimitOptions {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff */
  baseDelay?: number;
  /** Maximum delay in ms */
  maxDelay?: number;
}

/**
 * Retries an async operation with exponential backoff on rate limit errors (429).
 * Uses exponential backoff.
 *
 * @param operation - The async operation to retry
 * @param context - A descriptive context string for logging
 * @param options - Optional retry configuration
 */
export async function retryWithRateLimit<T>(
  operation: () => Promise<T>,
  context: string,
  options?: RetryWithRateLimitOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? RETRY_CONFIG.maxRetries;
  const baseDelay = options?.baseDelay ?? RETRY_CONFIG.baseDelay;
  const maxDelay = options?.maxDelay ?? RETRY_CONFIG.maxDelay;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      if (attempt > 0) {
        logger.info(`${context}: Success after ${attempt + 1} attempts`);
      }
      return result;
    } catch (error: any) {
      lastError = error;

      // Only retry on rate limit errors
      if (!isRateLimitError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted all attempts
      if (attempt === maxRetries) {
        logger.error(
          `${context}: Failed after ${maxRetries + 1} attempts due to rate limit`,
        );
        throw error;
      }

      let delay: number;

      // Honor server-supplied Retry-After when present. It can legitimately
      // exceed maxDelay — the server knows best; clamping would just 429 again.
      const retryAfterMs =
        error instanceof RateLimitError ? error.retryAfterMs : undefined;
      if (retryAfterMs !== undefined) {
        // Clamp to the 32-bit signed int max (~24.8 days) that setTimeout
        // accepts. In practice Retry-After from Supabase is seconds to
        // minutes, so this ceiling should never be reached — pure defense
        // against a malformed/pathological HTTP-date value.
        delay = Math.min(retryAfterMs, 2_147_483_647);
        logger.warn(
          `${context}: Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), honoring Retry-After: ${Math.round(delay)}ms`,
        );
      } else {
        // Exponential backoff with jitter
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter =
          exponentialDelay * RETRY_CONFIG.jitterFactor * Math.random();
        delay = Math.min(exponentialDelay + jitter, maxDelay);
        logger.warn(
          `${context}: Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Wrapper around fetch that automatically retries on rate limit (429) responses.
 * Uses exponential backoff via retryWithRateLimit.
 *
 * @param input - The fetch input (URL or Request)
 * @param init - Optional fetch init options
 * @param context - A descriptive context string for logging
 * @param retryOptions - Optional retry configuration
 * @returns The fetch Response (will not be a 429 response unless retries exhausted)
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: string,
  retryOptions?: RetryWithRateLimitOptions,
): Promise<Response> {
  return retryWithRateLimit(
    async () => {
      const response = await fetch(input, init);
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("Retry-After"),
        );
        throw new RateLimitError(
          `Rate limited (429): ${response.statusText}`,
          response,
          retryAfterMs,
        );
      }
      return response;
    },
    context,
    retryOptions,
  );
}
