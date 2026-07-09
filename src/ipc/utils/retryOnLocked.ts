import log from "electron-log";

import { isRateLimitError } from "./retryWithRateLimit";

export const logger = log.scope("retryOnLocked");

export function isLockedError(error: any): boolean {
  return error.response?.status === 423;
}

/**
 * Transient Neon management API errors worth retrying with backoff: the branch
 * is temporarily locked (423) or we've been rate limited (429). Bursts of
 * in-app test runs hit both, so we treat them the same way here.
 *
 * Note: this deliberately uses a lighter strategy than `retryWithRateLimit`
 * (fewer attempts, shorter base delay, no `Retry-After` handling). All callers
 * of `retryOnLocked` are Neon management-API operations whose dominant failure
 * mode is a locked branch (423); 429s on these endpoints are rare and bursty,
 * so a simple exponential backoff is sufficient. Endpoints that are primarily
 * rate-limited (and return `Retry-After`) should keep using
 * `retryWithRateLimit` instead. Before this, non-locked callers didn't retry
 * 429s at all, so honoring them here only makes those paths more resilient.
 */
function isRetryableError(error: any): boolean {
  return isLockedError(error) || isRateLimitError(error);
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 6,
  baseDelay: 1000, // 1 second
  maxDelay: 90_000, // 90 seconds
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Retries an async operation with exponential backoff on transient Neon
 * management API errors: locked branches (423) and rate limits (429).
 */

export async function retryOnLocked<T>(
  operation: () => Promise<T>,
  context: string,
  {
    retryBranchWithChildError = false,
  }: { retryBranchWithChildError?: boolean } = {},
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const result = await operation();
      logger.info(`${context}: Success after ${attempt + 1} attempts`);
      return result;
    } catch (error: any) {
      lastError = error;

      // Only retry on locked (423) or rate-limit (429) errors
      if (!isRetryableError(error)) {
        if (retryBranchWithChildError && error.response?.status === 422) {
          logger.info(
            `${context}: Branch with child error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})`,
          );
        } else {
          throw error;
        }
      }

      // Don't retry if we've exhausted all attempts
      if (attempt === RETRY_CONFIG.maxRetries) {
        logger.error(
          `${context}: Failed after ${RETRY_CONFIG.maxRetries + 1} attempts due to locked/rate-limit error`,
        );
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt);
      const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
      const delay = Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelay);

      logger.warn(
        `${context}: Retryable Neon API error (locked/rate-limited, attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
