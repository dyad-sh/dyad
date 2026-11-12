import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  CUSTOM_PROVIDER_MODELS_REQUEST_ERROR_NAME,
  CUSTOM_PROVIDER_MODELS_TRANSPORT_ERROR_NAME,
} from "@/shared/openai_compatible_error_names";
import type { FetchedCustomProviderModel } from "../types/language-model";

const logger = log.scope("fetch_openai_compatible_models");

const FETCH_TIMEOUT_MS = 10_000;

function describeTransportFailure(error: unknown): string {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  const details: string[] = [];

  for (let index = 0; index < pending.length && index < 6; index++) {
    const current = pending[index];
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    const fields =
      typeof current === "object"
        ? (current as { name?: unknown; code?: unknown; cause?: unknown })
        : undefined;
    const code = typeof fields?.code === "string" ? fields.code : "";
    const name = typeof fields?.name === "string" ? fields.name : "";
    const detail = [code, name]
      .filter((value) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value))
      .join(": ")
      .slice(0, 128);
    if (detail) details.push(detail);

    if (fields?.cause != null) pending.push(fields.cause);
    if (current instanceof AggregateError) {
      pending.push(...current.errors.slice(0, 6));
    }
  }

  return (
    details.join("; caused by: ").slice(0, 2_000) || "Unknown network error"
  );
}

class CustomProviderModelsRequestError extends DyadError {
  constructor(
    message: string,
    kind: DyadErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, kind, options);
    this.name = CUSTOM_PROVIDER_MODELS_REQUEST_ERROR_NAME;
  }
}

class CustomProviderModelsTransportError extends DyadError {
  constructor(
    message: string,
    kind: DyadErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, kind, options);
    this.name = CUSTOM_PROVIDER_MODELS_TRANSPORT_ERROR_NAME;
  }
}

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
    const detail = describeTransportFailure(error);
    throw new CustomProviderModelsTransportError(
      `Could not reach the configured provider endpoint: ${detail}`,
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    const authHint =
      response.status === 401 || response.status === 403
        ? " Check the API key on this provider's settings page."
        : "";
    const errorKind =
      response.status === 401 || response.status === 403
        ? DyadErrorKind.Auth
        : response.status === 429
          ? DyadErrorKind.RateLimited
          : DyadErrorKind.External;
    throw new CustomProviderModelsRequestError(
      `The provider endpoint returned ${response.status}.${authHint}`,
      errorKind,
    );
  }

  let body: any;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CustomProviderModelsRequestError(
        "The provider endpoint did not return valid JSON",
        DyadErrorKind.External,
        { cause: error },
      );
    }
    throw new CustomProviderModelsTransportError(
      `Could not read the provider endpoint response: ${describeTransportFailure(
        error,
      )}`,
      DyadErrorKind.External,
    );
  }
  if (!Array.isArray(body?.data)) {
    throw new CustomProviderModelsRequestError(
      "The provider endpoint did not return an OpenAI-style model list",
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

  logger.info(`Fetched ${models.length} models from custom provider endpoint`);
  return models;
}

/**
 * Picks the models that aren't already saved for a provider, de-duplicating
 * the input too. Runs in the main process against the database's current
 * contents, so a renderer's stale "already added" snapshot can't cause
 * duplicate rows.
 */
export function selectModelsToImport<T extends { apiName: string }>(
  models: T[],
  existingApiNames: Iterable<string>,
): T[] {
  const seen = new Set(existingApiNames);
  return models.filter((m) => {
    if (seen.has(m.apiName)) return false;
    seen.add(m.apiName);
    return true;
  });
}
