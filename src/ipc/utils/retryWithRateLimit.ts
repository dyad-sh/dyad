import log from "electron-log";

export const logger = log.scope("retryWithRateLimit");

/**
 * Checks if an error is a rate limit error (HTTP 429).
 */
export function isRateLimitError(error: any): boolean {
  const status = error?.response?.status;
  return status === 429;
}
// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 6,
  baseDelay: 2_000, // 2 seconds
  maxDelay: 180_000, // 180 seconds
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

      // Use exponential backoff with jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitter =
        exponentialDelay * RETRY_CONFIG.jitterFactor * Math.random();
      delay = Math.min(exponentialDelay + jitter, maxDelay);
      logger.warn(
        `${context}: Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
