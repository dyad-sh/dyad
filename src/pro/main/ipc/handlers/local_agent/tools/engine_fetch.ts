/**
 * Shared utility for making fetch requests to the Coney engine API.
 * Handles common headers including Authorization and X-Coney-Request-Id.
 */

import { readSettings } from "@/main/settings";
import type { AgentContext } from "./types";

export const CONEY_ENGINE_URL =
  process.env.CONEY_ENGINE_URL ?? "https://engine.coney.sh/v1";

export interface EngineFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to include */
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper for Coney engine API calls.
 * Automatically adds Authorization and X-Coney-Request-Id headers.
 *
 * @param ctx - The agent context containing the request ID
 * @param endpoint - The API endpoint path (e.g., "/tools/web-search")
 * @param options - Fetch options (method, body, additional headers, etc.)
 * @returns The fetch Response
 * @throws Error if Coney Pro API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "coneyRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new Error("Coney Pro API key is required");
  }

  const { headers: extraHeaders, ...restOptions } = options;

  return fetch(`${CONEY_ENGINE_URL}${endpoint}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Coney-Request-Id": ctx.coneyRequestId,
      ...extraHeaders,
    },
  });
}
