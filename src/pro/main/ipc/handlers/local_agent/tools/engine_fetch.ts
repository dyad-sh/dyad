/**
 * Shared utility for making fetch requests to the ProteaAI engine API.
 * Handles common headers including Authorization and X-ProteaAI-Request-Id.
 */

import { readSettings } from "@/main/settings";
import type { AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const PROTEAAI_ENGINE_URL =
  process.env.PROTEAAI_ENGINE_URL ?? "https://engine.proteaai.com/v1";

export interface EngineFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to include */
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper for ProteaAI engine API calls.
 * Automatically adds Authorization and X-ProteaAI-Request-Id headers.
 *
 * @param ctx - The agent context containing the request ID
 * @param endpoint - The API endpoint path (e.g., "/tools/web-search")
 * @param options - Fetch options (method, body, additional headers, etc.)
 * @returns The fetch Response
 * @throws Error if ProteaAI Pro API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "proteaaiRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError("ProteaAI Pro API key is required", DyadErrorKind.Auth);
  }

  const { headers: extraHeaders, ...restOptions } = options;

  return fetch(`${PROTEAAI_ENGINE_URL}${endpoint}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-ProteaAI-Request-Id": ctx.proteaaiRequestId,
      ...extraHeaders,
    },
  });
}
