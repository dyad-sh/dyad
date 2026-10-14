import log from "electron-log";

const logger = log.scope("model_request");

// Statuses whose Response must not carry a body; rewrapping would throw.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Send one model request and log its lifecycle: sent, response headers,
 * first body chunk, and end of stream. When a turn hangs with no error, these
 * lines show whether the request never left Dyad, is waiting on the server,
 * or stalled mid-stream. `label` should carry the request id so the lines can
 * be matched against Dyad Engine logs; it must never contain secrets.
 */
export async function fetchWithRequestLogging(
  label: string,
  url: string,
  send: () => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  logger.info(`[${label}] model request sent to ${url}`);

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    logger.warn(
      `[${label}] model request failed after ${elapsed()}ms with no response: ${describeFetchError(error)}`,
    );
    throw error;
  }
  logger.info(
    `[${label}] response headers received: status ${response.status} after ${elapsed()}ms`,
  );

  if (!response.body || NULL_BODY_STATUSES.has(response.status)) {
    return response;
  }

  // A manual reader rather than `pipeThrough`: cancelling a piped stream only
  // reaches the source after its next chunk, so a server stalled mid-stream
  // would keep the connection open after the SDK gave up on it.
  const reader = response.body.getReader();
  let sawFirstChunk = false;
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        logger.warn(
          `[${label}] response stream failed after ${elapsed()}ms (${bytes} bytes): ${describeFetchError(error)}`,
        );
        controller.error(error);
        return;
      }
      if (result.done) {
        logger.info(
          `[${label}] response stream ended after ${elapsed()}ms (${bytes} bytes)`,
        );
        controller.close();
        return;
      }
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        logger.info(`[${label}] first response chunk after ${elapsed()}ms`);
      }
      bytes += result.value.byteLength;
      controller.enqueue(result.value);
    },
    cancel(reason) {
      logger.info(
        `[${label}] response stream cancelled after ${elapsed()}ms (${bytes} bytes)`,
      );
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Error class plus network code (e.g. `TypeError (ECONNRESET)`). Messages are
 * left out: fetch errors can echo the full request URL, including any
 * query-string credentials.
 */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const codeOf = (value: unknown) => {
    const code = (value as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  };
  const code = codeOf(error.cause) ?? codeOf(error);
  return code ? `${error.name} (${code})` : error.name;
}

/** Read a header from a fetch `init`, whatever shape the SDK passed. */
export function readRequestHeader(
  init: RequestInit | undefined,
  name: string,
): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lowerName = name.toLowerCase();
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of entries) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return undefined;
}

/** Scheme, host, and path only, so query-string credentials never reach logs. */
export function describeRequestUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}
