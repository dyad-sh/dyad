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
  /** Override the default request deadline for this endpoint. */
  timeoutMs?: number;
}

export interface EngineFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export const DEFAULT_ENGINE_FETCH_TIMEOUT_MS = 300_000;

export class EngineFetchTimeoutError extends DyadError {
  constructor(endpoint: string, timeoutMs = DEFAULT_ENGINE_FETCH_TIMEOUT_MS) {
    super(
      `Dyad engine request to ${endpoint} timed out after ${timeoutMs}ms`,
      DyadErrorKind.External,
    );
    this.name = "EngineFetchTimeoutError";
  }
}

function createCallerCancellationError(cause: unknown): DyadError {
  return new DyadError(
    "This agent run was cancelled.",
    DyadErrorKind.UserCancelled,
    { cause },
  );
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
): Promise<EngineFetchResponse> {
  const callerSignals = [options.signal, ctx.abortSignal].filter(
    (signal): signal is AbortSignal => signal != null,
  );
  const alreadyAbortedSignal = callerSignals.find((signal) => signal.aborted);
  if (alreadyAbortedSignal) {
    throw createCallerCancellationError(alreadyAbortedSignal.reason);
  }

  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError("Dyad Pro API key is required", DyadErrorKind.Auth);
  }

  const {
    headers: extraHeaders,
    signal: _signal,
    timeoutMs = DEFAULT_ENGINE_FETCH_TIMEOUT_MS,
    ...restOptions
  } = options;
  const requestController = new AbortController();
  let abortSource: "caller" | "timeout" | undefined;
  let callerAbortReason: unknown;
  const callerAbortListeners = new Map<AbortSignal, () => void>();
  for (const signal of new Set(callerSignals)) {
    const onAbort = () => {
      if (abortSource) return;
      abortSource = "caller";
      callerAbortReason = signal.reason;
      requestController.abort(signal.reason);
    };
    callerAbortListeners.set(signal, onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  const timeout = setTimeout(() => {
    if (abortSource) return;
    abortSource = "timeout";
    requestController.abort(new EngineFetchTimeoutError(endpoint, timeoutMs));
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeout);
    for (const [signal, listener] of callerAbortListeners) {
      signal.removeEventListener("abort", listener);
    }
  };
  const normalizeAbortError = (error: unknown) => {
    if (abortSource === "timeout") {
      return new EngineFetchTimeoutError(endpoint, timeoutMs);
    }
    if (abortSource === "caller") {
      return createCallerCancellationError(callerAbortReason);
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

    const consumeText = async () => {
      const bodyReader = monitoredBody.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) return text + decoder.decode();
        text += decoder.decode(value, { stream: true });
      }
    };
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: monitoredBody,
      text: consumeText,
      json: async () => JSON.parse(await consumeText()),
    };
  } catch (error) {
    cleanup();
    throw normalizeAbortError(error);
  }
}
