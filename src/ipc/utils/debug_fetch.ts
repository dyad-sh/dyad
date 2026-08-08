import log from "electron-log";

const logger = log.scope("debug-fetch");

interface DebugFetchOptions extends RequestInit {
  debugTag?: string;
  logResponse?: boolean;
  logStream?: boolean;
  includeUsageInStream?: boolean;
}

/**
 * A debug-friendly fetch wrapper that logs requests and responses
 * Particularly useful for debugging SSE streams
 */
export async function debugFetch(
  url: RequestInfo | URL,
  options: DebugFetchOptions = {},
): Promise<Response> {
  const {
    debugTag = "fetch",
    logResponse = true,
    logStream = true,
    ...fetchOptions
  } = options;

  // Log the request
  logger.info(`[${debugTag}] Request:`, {
    url,
    method: fetchOptions.method || "GET",
    headers: fetchOptions.headers,
  });

  if (fetchOptions.body && options.includeUsageInStream) {
    fetchOptions.body = JSON.stringify({
      ...JSON.parse(fetchOptions.body as string),
      stream_options: { include_usage: true },
    });
  }

  const response = await fetch(url, fetchOptions);

  // Log the initial response
  logger.info(`[${debugTag}] Response:`, {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  });

  // If it's not a stream or we don't want to log it, return as is
  if (!logResponse || !response.body) {
    return response;
  }

  // Clone the response so we can read it multiple times
  const clonedResponse = response.clone();

  // If it's a stream and we want to log it
  if (logStream && isEventStream(response)) {
    // Create a new ReadableStream that will log chunks as they come in
    const loggedBody = new ReadableStream({
      async start(controller) {
        const reader = clonedResponse.body!.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            logger.info(`[${debugTag}] Stream chunk:`, chunk);
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          logger.error(`[${debugTag}] Stream error:`, error);
          controller.error(error);
        }
      },
    });

    // Return a new response with our logged body
    return new Response(loggedBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  // For non-stream responses, log the body if requested
  if (logResponse) {
    try {
      const bodyText = await clonedResponse.text();
      logger.info(`[${debugTag}] Response body:`, bodyText);
    } catch (error) {
      logger.error(`[${debugTag}] Error reading response body:`, error);
    }
  }

  return response;
}

function isEventStream(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  return contentType?.includes("text/event-stream") || false;
}
