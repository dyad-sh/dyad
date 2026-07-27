/**
 * pi stream-function bridge.
 *
 * Turns Dyad settings + a selected `LargeLanguageModel` into the `StreamFn`
 * that pi-agent-core's `Agent` expects. The stream itself is delegated to the
 * shared pi `Models` singleton (see ./model_runtime.ts); this module only maps
 * Dyad's settings (max tokens, temperature, thinking budget) onto pi's
 * `SimpleStreamOptions`.
 */

import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { SimpleStreamOptions, ThinkingLevel } from "@earendil-works/pi-ai";

import type {
  AzureProviderSetting,
  LargeLanguageModel,
  UserSettings,
  VertexProviderSetting,
} from "@/lib/schemas";
import { getMaxTokens, getTemperature } from "@/ipc/utils/token_utils";
import {
  DYAD_INTERNAL_REQUEST_ID_HEADER,
  getAiHeaders,
} from "@/ipc/utils/provider_options";
import { getOpenRouterAppAttributionHeaders } from "@/ipc/utils/openrouter_attribution";
import { getEnvVar } from "@/ipc/utils/read_env";
import { getPiModels } from "./model_runtime";
import { materializeVertexServiceAccount } from "./vertex_credentials";

/**
 * Map Dyad's coarse `thinkingBudget` setting onto a pi `ThinkingLevel`.
 *
 * Dyad only exposes low/medium/high; pi additionally supports
 * minimal/xhigh/max, which we don't surface. `undefined` means "use the
 * model/provider default" (pi leaves reasoning unset).
 */
export function mapThinkingLevel(
  thinkingBudget: UserSettings["thinkingBudget"],
): ThinkingLevel | undefined {
  switch (thinkingBudget) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return undefined;
  }
}

/**
 * Build the base pi stream options for a given model + settings.
 *
 * These are the per-run defaults; the `Agent` may still override individual
 * fields (e.g. `signal`) on each call.
 */
export async function buildStreamOptions(
  model: LargeLanguageModel,
  settings: UserSettings,
  dyadRequestId?: string,
): Promise<SimpleStreamOptions> {
  const [maxTokens, temperature] = await Promise.all([
    getMaxTokens(model),
    getTemperature(model),
  ]);
  const reasoning = mapThinkingLevel(settings.thinkingBudget);

  const options: SimpleStreamOptions = {};
  if (typeof maxTokens === "number") {
    options.maxTokens = maxTokens;
  }
  if (typeof temperature === "number") {
    options.temperature = temperature;
  }
  if (reasoning) {
    options.reasoning = reasoning;
  }

  const env = await buildProviderEnv(model, settings);
  if (Object.keys(env).length > 0) {
    options.env = env;
  }

  const headers = {
    ...getAiHeaders({ builtinProviderId: model.provider }),
    ...(dyadRequestId
      ? { [DYAD_INTERNAL_REQUEST_ID_HEADER]: dyadRequestId }
      : {}),
    ...(model.provider === "openrouter"
      ? getOpenRouterAppAttributionHeaders()
      : {}),
  };
  if (Object.keys(headers).length > 0) {
    options.headers = headers;
  }
  return options;
}

async function buildProviderEnv(
  model: LargeLanguageModel,
  settings: UserSettings,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const set = (name: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) env[name] = trimmed;
  };

  if (model.provider === "vertex") {
    const vertex = settings.providerSettings?.vertex as
      | VertexProviderSetting
      | undefined;
    set(
      "GOOGLE_CLOUD_PROJECT",
      vertex?.projectId ??
        getEnvVar("GOOGLE_CLOUD_PROJECT") ??
        getEnvVar("GCLOUD_PROJECT"),
    );
    set(
      "GOOGLE_CLOUD_LOCATION",
      vertex?.location ?? getEnvVar("GOOGLE_CLOUD_LOCATION"),
    );
    const serviceAccountJson = vertex?.serviceAccountKey?.value;
    if (serviceAccountJson) {
      env.GOOGLE_APPLICATION_CREDENTIALS =
        await materializeVertexServiceAccount(serviceAccountJson);
    } else {
      set(
        "GOOGLE_APPLICATION_CREDENTIALS",
        getEnvVar("GOOGLE_APPLICATION_CREDENTIALS"),
      );
    }
  }

  if (model.provider === "azure") {
    const azure = settings.providerSettings?.azure as
      | AzureProviderSetting
      | undefined;
    set(
      "AZURE_OPENAI_API_KEY",
      getEnvVar("AZURE_OPENAI_API_KEY") ?? getEnvVar("AZURE_API_KEY"),
    );
    set(
      "AZURE_OPENAI_RESOURCE_NAME",
      azure?.resourceName ??
        getEnvVar("AZURE_OPENAI_RESOURCE_NAME") ??
        getEnvVar("AZURE_RESOURCE_NAME"),
    );
    set(
      "AZURE_OPENAI_BASE_URL",
      process.env.TEST_AZURE_BASE_URL ?? getEnvVar("AZURE_OPENAI_BASE_URL"),
    );
    set("AZURE_OPENAI_API_VERSION", getEnvVar("AZURE_OPENAI_API_VERSION"));
  }

  if (model.provider === "bedrock") {
    for (const name of [
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
    ]) {
      set(name, getEnvVar(name));
    }
  }

  return env;
}

/**
 * Create a `StreamFn` bound to the shared pi `Models` singleton, layering the
 * provided base options underneath whatever the agent loop passes per call.
 */
export function createDyadStreamFn(baseOptions: SimpleStreamOptions): StreamFn {
  const models = getPiModels();
  return (model, context, options) =>
    models.streamSimple(model, context, { ...baseOptions, ...options });
}
