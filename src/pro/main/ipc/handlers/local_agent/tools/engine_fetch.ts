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
  ctx: Pick<AgentContext, "dyadRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const callerSignal = options.signal;
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

  try {
    requestController.signal.throwIfAborted();
    return await fetch(`${getDyadEngineBaseUrl()}${endpoint}`, {
      ...restOptions,
      signal: requestController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Dyad-Request-Id": ctx.dyadRequestId,
        ...extraHeaders,
      },
    });
  } catch (error) {
    if (abortSource === "timeout") {
      throw new EngineFetchTimeoutError(endpoint);
    }
    if (abortSource === "caller") {
      callerSignal?.throwIfAborted();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
