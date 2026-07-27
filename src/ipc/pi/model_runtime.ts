/**
 * pi model runtime bridge.
 *
 * Owns a lazy singleton pi `Models` instance whose credential store is backed
 * by Dyad's `settings.providerSettings.*.apiKey` values, and resolves
 * `LargeLanguageModel` (Dyad's `{provider, name}`) to a pi `Model`.
 */

import {
  createProvider,
  type ApiKeyCredential,
  type AuthContext,
  type AuthResult,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Model,
  type MutableImagesModels,
  type MutableModels,
  type Api,
  defaultProviderAuthContext,
} from "@earendil-works/pi-ai";
import * as openAICompletionsApi from "@earendil-works/pi-ai/api/openai-completions";
import {
  builtinImagesModels,
  builtinModels,
} from "@earendil-works/pi-ai/providers/all";

import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import type { LanguageModelProvider } from "@/ipc/types/language-model";
import { readSettings } from "@/main/settings";
import { getLmStudioBaseUrl } from "@/ipc/utils/lm_studio_utils";
import { getOllamaApiUrl } from "@/ipc/handlers/local_model_ollama_handler";
import { normalizeProviderApiKeyInput } from "@/lib/providerApiKey";
import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getEnvVar } from "@/ipc/utils/read_env";
import log from "electron-log";

const logger = log.scope("pi-model-runtime");

/**
 * Map from Dyad's provider id to pi's built-in provider id.
 * Dyad providers not in this map are treated as custom OpenAI-compatible
 * endpoints and registered dynamically.
 */
const DYAD_TO_PI_PROVIDER: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  vertex: "google-vertex",
  openrouter: "openrouter",
  azure: "azure-openai-responses",
  xai: "xai",
  bedrock: "amazon-bedrock",
  minimax: "minimax",
};

/**
 * Reverse map used when bridging pi credential reads back to a Dyad provider id.
 */
const PI_TO_DYAD_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(DYAD_TO_PI_PROVIDER).map(([dyad, pi]) => [pi, dyad]),
);

export function toPiProviderId(dyadProviderId: string): string {
  return DYAD_TO_PI_PROVIDER[dyadProviderId] ?? dyadProviderId;
}

export function toDyadProviderId(piProviderId: string): string {
  return PI_TO_DYAD_PROVIDER[piProviderId] ?? piProviderId;
}

/**
 * CredentialStore that reads Dyad's `providerSettings.*.apiKey` at request
 * time. Writes are intentionally no-ops — Dyad manages provider keys through
 * its own settings UI + safeStorage; pi login flows are not used.
 */
export class DyadSettingsCredentialStore implements CredentialStore {
  private readonly readSettings: () => UserSettings;

  constructor(readSettingsFn: () => UserSettings = readSettings) {
    this.readSettings = readSettingsFn;
  }

  async read(piProviderId: string): Promise<Credential | undefined> {
    const dyadProviderId = toDyadProviderId(piProviderId);
    const settings = this.readSettings();
    const providerSettings = settings.providerSettings?.[dyadProviderId];
    const rawKey = (
      providerSettings as { apiKey?: { value?: string } } | undefined
    )?.apiKey?.value;
    const key = normalizeProviderApiKeyInput(rawKey);
    if (!key) {
      return undefined;
    }
    const credential: ApiKeyCredential = { type: "api_key", key };
    return credential;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const settings = this.readSettings();
    const providerSettings = settings.providerSettings ?? {};
    const out: CredentialInfo[] = [];
    for (const [dyadProviderId, cfg] of Object.entries(providerSettings)) {
      const key = normalizeProviderApiKeyInput(
        (cfg as { apiKey?: { value?: string } } | undefined)?.apiKey?.value,
      );
      if (key) {
        out.push({
          providerId: toPiProviderId(dyadProviderId),
          type: "api_key",
        });
      }
    }
    return out;
  }

  async modify(
    _piProviderId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    logger.warn(
      "DyadSettingsCredentialStore.modify was called; pi login flows are not used in Dyad.",
    );
    return undefined;
  }

  async delete(_piProviderId: string): Promise<void> {
    // No-op — Dyad manages credential deletion through its own settings UI.
  }
}

let modelsSingleton: MutableModels | undefined;
let imageModelsSingleton: MutableImagesModels | undefined;
const registeredCustomProviderConfigs = new Map<
  string,
  { baseUrl: string; envVarName?: string }
>();

export function createDyadProviderAuthContext(): AuthContext {
  const defaultContext = defaultProviderAuthContext();
  return {
    env: async (name) => {
      const value = getEnvVar(name);
      return value?.trim() || undefined;
    },
    fileExists: defaultContext.fileExists,
  };
}

/** Reset the singleton (test-only helper). */
export function resetPiModelRuntimeForTesting(): void {
  modelsSingleton = undefined;
  imageModelsSingleton = undefined;
  registeredCustomProviderConfigs.clear();
}

export function getPiModels(): MutableModels {
  let models = modelsSingleton;
  if (!models) {
    models = builtinModels({
      credentials: new DyadSettingsCredentialStore(),
      authContext: createDyadProviderAuthContext(),
    });
    modelsSingleton = models;
  }
  return models;
}

export function getPiImageModels(): MutableImagesModels {
  let models = imageModelsSingleton;
  if (!models) {
    models = builtinImagesModels({
      credentials: new DyadSettingsCredentialStore(),
      authContext: createDyadProviderAuthContext(),
    });
    imageModelsSingleton = models;
  }
  return models;
}

/**
 * Register (or refresh) a custom OpenAI-compatible pi provider so `resolveDyadModel`
 * can find it. Re-registers when its URL or credential environment changes.
 */
function registerCustomOpenAICompatibleProvider(params: {
  providerId: string;
  baseUrl: string;
  displayName?: string;
  envVarName?: string;
}): void {
  const { providerId, baseUrl, displayName, envVarName } = params;
  const currentConfig = registeredCustomProviderConfigs.get(providerId);
  if (
    currentConfig?.baseUrl === baseUrl &&
    currentConfig.envVarName === envVarName
  ) {
    return;
  }
  const models = getPiModels();
  const provider = createProvider({
    id: providerId,
    name: displayName ?? providerId,
    baseUrl,
    // Dyad-managed key; pi's resolve() just needs to succeed when a key exists.
    auth: {
      apiKey: {
        name: `${displayName ?? providerId} API key`,
        resolve: async ({ ctx, credential }) => {
          const cred = credential as ApiKeyCredential | undefined;
          const envKey = envVarName ? await ctx.env(envVarName) : undefined;
          const key = cred?.key || envKey || "not-required";
          const result: AuthResult = {
            auth: { apiKey: key, baseUrl },
            source: cred?.key
              ? `Dyad settings:${providerId}`
              : envKey
                ? envVarName
                : "No API key configured",
          };
          return result;
        },
      },
    },
    models: [],
    // Custom providers stream through OpenAI-compatible completions.
    api: openAICompletionsApi,
  });
  models.setProvider(provider);
  registeredCustomProviderConfigs.set(providerId, { baseUrl, envVarName });
  logger.debug(`Registered custom pi provider "${providerId}" -> ${baseUrl}`);
}

/**
 * Fabricate a minimal pi `Model` for a Dyad provider+model pair.
 *
 * We only fill the fields the pi stream path actually reads for tool-based
 * chat: `id`, `name`, `api`, `provider`, `baseUrl`, plus placeholder cost /
 * limits. Once we start honoring real pricing/reasoning metadata, this should
 * be replaced by lookups against the pi catalog + Dyad's own model registry.
 */
function fabricateModel(params: {
  piProviderId: string;
  modelId: string;
  api: Api;
  baseUrl: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
}): Model<Api> {
  return {
    id: params.modelId,
    name: params.modelId,
    api: params.api,
    provider: params.piProviderId,
    baseUrl: params.baseUrl,
    reasoning: params.reasoning,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: params.contextWindow ?? 128_000,
    maxTokens: params.maxTokens ?? 8_192,
  };
}

/**
 * Resolve Dyad's `{provider, name}` to a pi `Model`.
 *
 * If the pi catalog has an exact match, that model is returned. Otherwise we
 * fabricate one — this covers custom providers, local endpoints (ollama /
 * lmstudio), and models newer than the bundled pi catalog.
 */
export type ProviderConfigLookup = (
  providerId: string,
) => Promise<LanguageModelProvider | undefined>;

async function lookupProviderConfig(
  providerId: string,
): Promise<LanguageModelProvider | undefined> {
  const providers = await getLanguageModelProviders();
  return providers.find((provider) => provider.id === providerId);
}

export async function resolveDyadModel(
  model: LargeLanguageModel,
  findProvider: ProviderConfigLookup = lookupProviderConfig,
): Promise<Model<Api>> {
  const piProviderId = toPiProviderId(model.provider);
  const models = getPiModels();

  const known = models.getModel(piProviderId, model.name);
  if (known) {
    return known;
  }

  // Handle Dyad-specific local providers by registering them as custom
  // OpenAI-compatible providers first.
  if (model.provider === "ollama") {
    const baseUrl = `${getOllamaApiUrl()}/v1`;
    registerCustomOpenAICompatibleProvider({
      providerId: "ollama",
      baseUrl,
      displayName: "Ollama",
    });
    return fabricateModel({
      piProviderId: "ollama",
      modelId: model.name,
      api: "openai-completions",
      baseUrl,
      reasoning: false,
    });
  }
  if (model.provider === "lmstudio") {
    const baseUrl = `${getLmStudioBaseUrl()}/v1`;
    registerCustomOpenAICompatibleProvider({
      providerId: "lmstudio",
      baseUrl,
      displayName: "LM Studio",
    });
    return fabricateModel({
      piProviderId: "lmstudio",
      modelId: model.name,
      api: "openai-completions",
      baseUrl,
      reasoning: false,
    });
  }

  if (model.provider.startsWith("custom::")) {
    const providerConfig = await findProvider(model.provider);
    if (!providerConfig || providerConfig.type !== "custom") {
      throw new DyadError(
        `Configuration not found for provider: ${model.provider}`,
        DyadErrorKind.NotFound,
      );
    }
    if (!providerConfig.apiBaseUrl) {
      throw new DyadError(
        `Custom provider ${model.provider} is missing the API Base URL.`,
        DyadErrorKind.Validation,
      );
    }
    let baseUrl: string;
    try {
      const parsed = new URL(providerConfig.apiBaseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      baseUrl = parsed.toString().replace(/\/$/, "");
    } catch {
      throw new DyadError(
        `Custom provider ${model.provider} has an invalid API Base URL.`,
        DyadErrorKind.Validation,
      );
    }
    registerCustomOpenAICompatibleProvider({
      providerId: model.provider,
      baseUrl,
      displayName: providerConfig.name,
      envVarName: providerConfig.envVarName,
    });
    return fabricateModel({
      piProviderId: model.provider,
      modelId: model.name,
      api: "openai-completions",
      baseUrl,
      reasoning: false,
    });
  }

  // Fall back to fabricating against the pi provider's baseUrl when we know
  // the provider but not this specific model id (e.g. a newer OpenAI model
  // that isn't in the bundled pi catalog yet).
  const piProvider = models.getProvider(piProviderId);
  if (piProvider) {
    const anyModel = piProvider.getModels()[0];
    return fabricateModel({
      piProviderId,
      modelId: model.name,
      api: (anyModel?.api ?? "openai-completions") as Api,
      baseUrl: piProvider.baseUrl ?? anyModel?.baseUrl ?? "",
      reasoning: false,
    });
  }

  throw new DyadError(
    `resolveDyadModel: unknown provider "${model.provider}" (pi id "${piProviderId}"). ` +
      "Custom providers must be registered before use.",
    DyadErrorKind.Validation,
  );
}
