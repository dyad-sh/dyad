import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "../../main/settings";
import type { UserSettings } from "@/lib/schemas";
import { getPhantomHermesApiBase, getPhantomApiKey } from "@/lib/ai_coder";
import type { ApiModel } from "../types/language-model";

const logger = log.scope("provider_api_models");

/**
 * Lists the models a provider will actually serve for the configured key, by
 * calling its OpenAI-compatible `/models` endpoint. The built-in catalogue is
 * curated and can lag behind what an account has access to; this is the live
 * truth, including preview and realtime models.
 */

/** Base URLs for built-in providers that expose an OpenAI-style /models. */
const BUILTIN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  "kimi-code": "https://api.moonshot.ai/v1",
  minimax: "https://api.minimax.chat/v1",
  vercel: "https://ai-gateway.vercel.sh/v1",
};

function trimBase(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
}

export function resolveProviderModelsEndpoint(
  providerId: string,
  settings: UserSettings,
  customApiBaseUrl?: string,
): { baseUrl: string; apiKey?: string } {
  const providerSetting = settings.providerSettings?.[providerId];
  const apiKey = providerSetting?.apiKey?.value;

  if (providerId === "phantom") {
    return {
      baseUrl: getPhantomHermesApiBase(settings),
      apiKey: getPhantomApiKey(settings),
    };
  }

  // Local servers and custom providers carry their own base URL.
  const configuredBase = (
    providerSetting as { apiBaseUrl?: string } | undefined
  )?.apiBaseUrl;
  const base =
    customApiBaseUrl || configuredBase || BUILTIN_BASE_URLS[providerId];

  if (!base) {
    throw new DyadError(
      `Listing models from the API is not supported for ${providerId}.`,
      DyadErrorKind.Precondition,
    );
  }

  return { baseUrl: trimBase(base), apiKey };
}

export async function listProviderApiModels(input: {
  providerId: string;
  customApiBaseUrl?: string;
}): Promise<{ models: ApiModel[]; baseUrl: string }> {
  const settings = readSettings();
  const { baseUrl, apiKey } = resolveProviderModelsEndpoint(
    input.providerId,
    settings,
    input.customApiBaseUrl,
  );

  // Local servers are usually keyless; cloud providers are not.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
  if (!apiKey && !isLocal) {
    throw new DyadError(
      "Add an API key for this provider before loading its models.",
      DyadErrorKind.Precondition,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    logger.warn(`Could not reach ${baseUrl}/models`, error);
    throw new DyadError(
      `Could not reach ${baseUrl}. Check the endpoint and your connection.`,
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    // Never echo the provider body: it can quote the key back.
    throw new DyadError(
      response.status === 401 || response.status === 403
        ? "The provider rejected the API key."
        : `The provider returned HTTP ${response.status} when listing models.`,
      DyadErrorKind.External,
    );
  }

  const payload = (await response.json()) as {
    data?: { id?: string; owned_by?: string; created?: number }[];
    models?: { id?: string; name?: string }[];
  };

  // OpenAI shape is `{data: [...]}`; some servers answer `{models: [...]}`.
  const raw = payload.data ?? payload.models ?? [];
  const models: ApiModel[] = raw
    .map((entry) => ({
      id: String(entry.id ?? (entry as { name?: string }).name ?? "").trim(),
      ownedBy: (entry as { owned_by?: string }).owned_by,
      created: (entry as { created?: number }).created,
    }))
    .filter((model) => model.id.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));

  return { models, baseUrl };
}
