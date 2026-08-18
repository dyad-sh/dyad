/**
 * Shared utility for making fetch requests to the Dyad engine API.
 * Handles common headers including Authorization and X-Dyad-Request-Id.
 */

import { readSettings } from "@/main/settings";
import type { AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadEngineBaseUrl } from "@/ipc/utils/dyad_engine_url";

export interface EngineFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to include */
  headers?: Record<string, string>;
}

export const DEFAULT_ENGINE_FETCH_TIMEOUT_MS = 300_000;

export class EngineFetchTimeoutError extends Error {
  constructor(endpoint: string) {
    super(
      `Dyad engine request to ${endpoint} timed out after ${DEFAULT_ENGINE_FETCH_TIMEOUT_MS}ms`,
    );
    this.name = "EngineFetchTimeoutError";
  }
}

/**
 * Fetch wrapper for Dyad engine API calls.
 * Automatically adds Authorization and X-Dyad-Request-Id headers.
 *
 * @param ctx - The agent context containing the request ID
 * @param endpoint - The API endpoint path (e.g., "/tools/web-search")
 * @param options - Fetch options (method, body, additional headers, etc.)
 * @returns The fetch Response
 * @throws Error if Dyad Pro API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "dyadRequestId" | "abortSignal">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const callerSignal = options.signal ?? ctx.abortSignal;
  callerSignal?.throwIfAborted();

  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError("Dyad Pro API key is required", DyadErrorKind.Auth);
  }

  const { headers: extraHeaders, signal: _signal, ...restOptions } = options;
  const requestController = new AbortController();
  let abortSource: "caller" | "timeout" | undefined;
  const onCallerAbort = () => {
    if (abortSource) return;
    abortSource = "caller";
    requestController.abort(callerSignal?.reason);
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  if (callerSignal?.aborted) {
    onCallerAbort();
  }
  const timeout = setTimeout(() => {
    if (abortSource) return;
    abortSource = "timeout";
    requestController.abort(new EngineFetchTimeoutError(endpoint));
  }, DEFAULT_ENGINE_FETCH_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  };
  const normalizeAbortError = (error: unknown) => {
    if (abortSource === "timeout") {
      return new EngineFetchTimeoutError(endpoint);
    }
    if (abortSource === "caller") {
      try {
        callerSignal?.throwIfAborted();
      } catch (callerError) {
        return callerError;
      }
    }
    return error;
  };

  try {
    requestController.signal.throwIfAborted();
    const response = await fetch(`${getDyadEngineBaseUrl()}${endpoint}`, {
      ...restOptions,
      signal: requestController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Dyad-Request-Id": ctx.dyadRequestId,
        ...extraHeaders,
      },
    });

    if (!response.body) {
      cleanup();
      return response;
    }

    const reader = response.body.getReader();
    const monitoredBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            cleanup();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          cleanup();
          controller.error(normalizeAbortError(error));
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason);
      },
    });

    const monitoredResponse = new Response(monitoredBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    // Node's native body consumers can replace a custom stream error with an
    // EncodingError. Consume this byte stream directly so timeout and caller-
    // abort reasons remain distinguishable for text and JSON engine responses.
    const consumeText = async () => {
      const bodyReader = monitoredResponse.body?.getReader();
      if (!bodyReader) return "";
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) return text + decoder.decode();
        text += decoder.decode(value, { stream: true });
      }
    };
    monitoredResponse.text = consumeText;
    monitoredResponse.json = async () => JSON.parse(await consumeText());
    return monitoredResponse;
  } catch (error) {
    cleanup();
    throw normalizeAbortError(error);
  }
}
