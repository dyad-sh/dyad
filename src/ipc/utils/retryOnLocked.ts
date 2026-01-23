import log from "electron-log";

export const logger = log.scope("retryOnLocked");

export function isLockedError(error: any): boolean {
  return error.response?.status === 423;
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 6,
  baseDelay: 1000, // 1 second
  maxDelay: 90_000, // 90 seconds
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Retries an async operation with exponential backoff on locked errors (423)
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

      // Only retry on locked errors
      if (!isLockedError(error)) {
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
          `${context}: Failed after ${RETRY_CONFIG.maxRetries + 1} attempts due to locked error`,
        );
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt);
      const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
      const delay = Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelay);

      logger.warn(
        `${context}: Locked error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
