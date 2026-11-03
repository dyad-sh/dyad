import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { FetchedCustomProviderModel } from "../types/language-model";

const logger = log.scope("fetch_openai_compatible_models");

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Lists the models an OpenAI-compatible server (vLLM, LiteLLM, ...) serves via
 * `GET {apiBaseUrl}/models`. vLLM also reports `max_model_len`, which becomes
 * the context window; other servers only give the id.
 */
export async function fetchOpenAICompatibleModels(
  apiBaseUrl: string,
  apiKey?: string,
): Promise<FetchedCustomProviderModel[]> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DyadError(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    const authHint =
      response.status === 401 || response.status === 403
        ? " Check the API key on this provider's settings page."
        : "";
    throw new DyadError(
      `Server returned ${response.status} for ${url}.${authHint}`,
      DyadErrorKind.External,
    );
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new DyadError(
      `${url} did not return valid JSON`,
      DyadErrorKind.External,
    );
  }
  if (!Array.isArray(body?.data)) {
    throw new DyadError(
      `${url} did not return an OpenAI-style model list`,
      DyadErrorKind.External,
    );
  }

  const byId = new Map<string, FetchedCustomProviderModel>();
  for (const m of body.data) {
    if (typeof m?.id !== "string" || !m.id || byId.has(m.id)) continue;
    byId.set(m.id, {
      apiName: m.id,
      displayName: m.id,
      contextWindow:
        Number.isInteger(m.max_model_len) && m.max_model_len > 0
          ? m.max_model_len
          : undefined,
    });
  }
  const models = [...byId.values()];

  logger.info(`Fetched ${models.length} models from ${url}`);
  return models;
}
