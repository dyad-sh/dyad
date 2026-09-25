import { setTimeout as delayWithSignal } from "node:timers/promises";
import log from "electron-log";

const logger = log.scope("test_database_cleanup");
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

interface CleanupError {
  code?: unknown;
  cause?: unknown;
  sourceError?: unknown;
  errors?: unknown;
}

function cleanupErrorChain(error: unknown, depth = 0): CleanupError[] {
  if (!error || typeof error !== "object" || depth >= 5) return [];
  const detail = error as CleanupError;
  return [
    detail,
    ...cleanupErrorChain(detail.cause, depth + 1),
    // Neon's serverless client wraps fetch failures in sourceError.
    ...cleanupErrorChain(detail.sourceError, depth + 1),
    ...(Array.isArray(detail.errors)
      ? detail.errors.flatMap((nested) => cleanupErrorChain(nested, depth + 1))
      : []),
  ];
}

/** Only for repeatable cleanup requests, never test-user creation. */
export async function retryTestDatabaseCleanup<T>(
  operation: () => Promise<T>,
  context: string,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal?.throwIfAborted();
      const errors = cleanupErrorChain(error);
      const codes = errors.flatMap((error) =>
        typeof error.code === "string" ? [error.code] : [],
      );
      const transient =
        codes.length > 0
          ? codes.every((code) => TRANSIENT_NETWORK_CODES.has(code))
          : errors.some(
              (error) =>
                error instanceof TypeError &&
                error.message === "fetch failed" &&
                error.cause == null,
            );
      const delay = RETRY_DELAYS_MS[attempt];
      const retry = transient && delay !== undefined;
      // Log cause codes without dumping request objects, headers, or keys.
      logger.warn(
        `${context}: ${error}${codes.length ? ` (network codes: ${codes.join(", ")})` : ""}; ${retry ? `retrying in ${delay}ms (${attempt + 1}/${RETRY_DELAYS_MS.length})` : "not retrying"}`,
      );
      if (!retry) throw error;
      if (signal) {
        try {
          await delayWithSignal(delay, undefined, { signal });
        } catch (error) {
          // Preserve the lifecycle's shutdown reason rather than replacing it
          // with the timer's AbortError and reporting a spurious run failure.
          signal.throwIfAborted();
          throw error;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
