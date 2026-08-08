import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI as createGoogle } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createVertex as createGoogleVertex } from "@ai-sdk/google-vertex";
import { createAzure } from "@ai-sdk/azure";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type {
  LargeLanguageModel,
  UserSettings,
  VertexProviderSetting,
  AzureProviderSetting,
} from "../../lib/schemas";
import { getEnvVar } from "./read_env";
import log from "electron-log";
import { FREE_OPENROUTER_MODEL_NAMES } from "../shared/language_model_constants";
import { getLanguageModelProviders } from "../shared/language_model_helpers";
import { resolveBuiltinModelAlias } from "../shared/remote_language_model_catalog";
import { LanguageModelProvider } from "@/ipc/types";
import {
  createDyadEngine,
  type DyadEngineProvider,
} from "./llm_engine_provider";

import {
  getLMStudioApiBaseUrl,
  getOllamaApiUrl,
} from "@/lib/local_provider_utils";
import { getMxServeApiBaseUrl } from "@/lib/mx_serve";
import { getPhantomApiKey, getPhantomHermesApiBase } from "@/lib/ai_coder";
import { createOllamaProvider } from "./ollama_provider";
import { createFallback } from "./fallback_ai_model";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertLocalModelReady } from "@/lib/validate_local_model";

const dyadEngineUrl = process.env.DYAD_ENGINE_URL;

const AUTO_MODEL_ALIASES = [
  "dyad/auto/openai",
  "dyad/auto/anthropic",
  "dyad/auto/google",
] as const;

export interface ModelClient {
  model: LanguageModel;
  builtinProviderId?: string;
}

const logger = log.scope("getModelClient");
export async function getModelClient(
  model: LargeLanguageModel,
  settings: UserSettings,
  // files?: File[],
): Promise<{
  modelClient: ModelClient;
  isEngineEnabled?: boolean;
  isSmartContextEnabled?: boolean;
}> {
  const allProviders = await getLanguageModelProviders();

  const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;

  // --- Handle specific provider ---
  const providerConfig = allProviders.find((p) => p.id === model.provider);

  if (!providerConfig) {
    throw new DyadError(
      `Configuration not found for provider: ${model.provider}`,
      DyadErrorKind.NotFound,
    );
  }

  // Handle Meta Human OS Pro override (never route LM Studio / Ollama through the cloud engine)
  if (dyadApiKey && settings.enableDyadPro && providerConfig.type !== "local") {
    // Check if the selected provider supports Meta Human OS Pro (has a gateway prefix) OR
    // we're using local engine.
    // IMPORTANT: some providers like OpenAI have an empty string gateway prefix,
    // so we do a nullish and not a truthy check here.
    if (providerConfig.gatewayPrefix != null || dyadEngineUrl) {
      const enableSmartFilesContext = settings.enableProSmartFilesContextMode;
      const provider = createDyadEngine({
        apiKey: dyadApiKey,
        baseURL: dyadEngineUrl ?? "https://engine.dyad.sh/v1",
        dyadOptions: {
          enableLazyEdits:
            settings.selectedChatMode === "ask"
              ? false
              : settings.enableProLazyEditsMode &&
                settings.proLazyEditsMode !== "v2",
          enableSmartFilesContext,
          enableWebSearch: settings.enableProWebSearch,
        },
        settings,
      });

      logger.info(
        `\x1b[1;97;44m Using Meta Human OS Pro API key for model: ${model.name} \x1b[0m`,
      );

      logger.info(
        `\x1b[1;30;42m Using Meta Human OS Pro engine: ${dyadEngineUrl ?? "<prod>"} \x1b[0m`,
      );

      // Do not use free variant (for openrouter).
      const modelName = model.name.split(":free")[0];
      const proModelClient = await getProModelClient({
        model,
        settings,
        provider,
        modelId: `${providerConfig.gatewayPrefix || ""}${modelName}`,
      });

      return {
        modelClient: proModelClient,
        isEngineEnabled: true,
        isSmartContextEnabled: enableSmartFilesContext,
      };
    } else {
      logger.warn(
        `Meta Human OS Pro enabled, but provider ${model.provider} does not have a gateway prefix defined. Falling back to direct provider connection.`,
      );
      // Fall through to regular provider logic if gateway prefix is missing
    }
  }
  // Handle 'auto' provider by trying each model in AUTO_MODELS until one works
  if (model.provider === "auto") {
    if (model.name === "free") {
      const openRouterProvider = allProviders.find(
        (p) => p.id === "openrouter",
      );
      if (!openRouterProvider) {
        throw new DyadError(
          "OpenRouter provider not found",
          DyadErrorKind.NotFound,
        );
      }
      return {
        modelClient: {
          model: createFallback({
            models: FREE_OPENROUTER_MODEL_NAMES.map(
              (name: string) =>
                getRegularModelClient(
                  { provider: "openrouter", name },
                  settings,
                  openRouterProvider,
                ).modelClient.model,
            ),
          }),
          builtinProviderId: "openrouter",
        },
        isEngineEnabled: false,
      };
    }
    for (const autoModelAlias of AUTO_MODEL_ALIASES) {
      const resolvedModel = await resolveBuiltinModelAlias(autoModelAlias);
      if (!resolvedModel) {
        continue;
      }

      const providerInfo = allProviders.find(
        (p) => p.id === resolvedModel.providerId,
      );
      const envVarName = providerInfo?.envVarName;

      const apiKey =
        settings.providerSettings?.[resolvedModel.providerId]?.apiKey?.value ||
        (envVarName ? getEnvVar(envVarName) : undefined);

      if (apiKey) {
        logger.log(
          `Using provider: ${resolvedModel.providerId} model: ${resolvedModel.apiName}`,
        );
        // Recursively call with the specific model found
        return await getModelClient(
          {
            provider: resolvedModel.providerId,
            name: resolvedModel.apiName,
          },
          settings,
        );
      }
    }
    // If no models have API keys, throw an error
    throw new DyadError(
      "No API keys available for any model supported by the 'auto' provider.",
      DyadErrorKind.Validation,
    );
  }

  if (providerConfig.type === "local") {
    await assertLocalModelReady(model, settings);
  }

  return getRegularModelClient(model, settings, providerConfig);
}

async function getProModelClient({
  model,
  settings,
  provider,
  modelId,
}: {
  model: LargeLanguageModel;
  settings: UserSettings;
  provider: DyadEngineProvider;
  modelId: string;
}): Promise<ModelClient> {
  if (
    settings.selectedChatMode === "local-agent" &&
    model.provider === "auto" &&
    model.name === "auto"
  ) {
    const providers = await getLanguageModelProviders();
    const fallbackModels = await Promise.all(
      AUTO_MODEL_ALIASES.map(async (aliasId) => {
        const resolvedModel = await resolveBuiltinModelAlias(aliasId);
        if (!resolvedModel) {
          return null;
        }

        const resolvedProvider = providers.find(
          (providerInfo) => providerInfo.id === resolvedModel.providerId,
        );
        const resolvedModelId = `${
          resolvedProvider?.gatewayPrefix || ""
        }${resolvedModel.apiName}`;

        if (resolvedModel.providerId === "openai") {
          return provider.responses(resolvedModel.apiName, {
            providerId: resolvedModel.providerId,
          });
        }

        return provider(resolvedModelId, {
          providerId: resolvedModel.providerId,
        });
      }),
    );

    const validModels = fallbackModels.filter(
      (candidate) => candidate !== null,
    );
    if (validModels.length === 0) {
      throw new DyadError(
        "No auto-mode models could be resolved from the catalog",
        DyadErrorKind.External,
      );
    }

    return {
      // We need to do the fallback here (and not server-side)
      // because GPT-5* models need to use responses API to get
      // full functionality (e.g. thinking summaries).
      model: createFallback({
        models: validModels,
      }),
      // Using openAI as the default provider.
      // TODO: we should remove this and rely on the provider id passed into the provider().
      builtinProviderId: "openai",
    };
  }
  if (
    settings.selectedChatMode === "local-agent" &&
    model.provider === "openai"
  ) {
    return {
      model: provider.responses(modelId, { providerId: model.provider }),
      builtinProviderId: model.provider,
    };
  }
  return {
    model: provider(modelId, { providerId: model.provider }),
    builtinProviderId: model.provider,
  };
}

function getRegularModelClient(
  model: LargeLanguageModel,
  settings: UserSettings,
  providerConfig: LanguageModelProvider,
): {
  modelClient: ModelClient;
  backupModelClients: ModelClient[];
} {
  // Get API key for the specific provider
  const apiKey =
    settings.providerSettings?.[model.provider]?.apiKey?.value ||
    (providerConfig.envVarName
      ? getEnvVar(providerConfig.envVarName)
      : undefined);

  const providerId = providerConfig.id;
  // Create client based on provider ID or type
  switch (providerId) {
    case "openai": {
      const provider = createOpenAI({ apiKey });
      return {
        modelClient: {
          model: provider.responses(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "xai": {
      const provider = createXai({ apiKey });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "google": {
      const provider = createGoogle({ apiKey });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "vertex": {
      // Vertex uses Google service account credentials with project/location
      const vertexSettings = settings.providerSettings?.[
        model.provider
      ] as VertexProviderSetting;
      const project = vertexSettings?.projectId;
      const location = vertexSettings?.location;
      const serviceAccountKey = vertexSettings?.serviceAccountKey?.value;

      // Use a baseURL that does NOT pin to publishers/google so that
      // full publisher model IDs (e.g. publishers/deepseek-ai/models/...) work.
      const regionHost = `${location === "global" ? "" : `${location}-`}aiplatform.googleapis.com`;
      const baseURL = `https://${regionHost}/v1/projects/${project}/locations/${location}`;
      const provider = createGoogleVertex({
        project,
        location,
        baseURL,
        googleAuthOptions: serviceAccountKey
          ? {
              // Expecting the user to paste the full JSON of the service account key
              credentials: JSON.parse(serviceAccountKey),
            }
          : undefined,
      });
      return {
        modelClient: {
          // For built-in Google models on Vertex, the path must include
          // publishers/google/models/<model>. For partner MaaS models the
          // full publisher path is already included.
          model: provider(
            model.name.includes("/")
              ? model.name
              : `publishers/google/models/${model.name}`,
          ),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "openrouter": {
      const provider = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "vercel": {
      const provider = createOpenAICompatible({
        name: "vercel-ai-gateway",
        baseURL: "https://ai-gateway.vercel.sh/v1",
        apiKey,
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "kimi-code": {
      const provider = createOpenAICompatible({
        name: "kimi-code",
        baseURL: "https://api.kimi.com/coding/v1",
        apiKey,
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "azure": {
      // Check if we're in e2e testing mode
      const testAzureBaseUrl = getEnvVar("TEST_AZURE_BASE_URL");

      if (testAzureBaseUrl) {
        // Use fake server for e2e testing
        logger.info(`Using test Azure base URL: ${testAzureBaseUrl}`);
        const provider = createOpenAICompatible({
          name: "azure-test",
          baseURL: testAzureBaseUrl,
          apiKey: "fake-api-key-for-testing",
        });
        return {
          modelClient: {
            model: provider(model.name),
            builtinProviderId: providerId,
          },
          backupModelClients: [],
        };
      }

      const azureSettings = settings.providerSettings?.azure as
        | AzureProviderSetting
        | undefined;
      const azureApiKeyFromSettings = (
        azureSettings?.apiKey?.value ?? ""
      ).trim();
      const azureResourceNameFromSettings = (
        azureSettings?.resourceName ?? ""
      ).trim();
      const envResourceName = (getEnvVar("AZURE_RESOURCE_NAME") ?? "").trim();
      const envAzureApiKey = (getEnvVar("AZURE_API_KEY") ?? "").trim();

      const resourceName = azureResourceNameFromSettings || envResourceName;
      const azureApiKey = azureApiKeyFromSettings || envAzureApiKey;

      if (!resourceName) {
        throw new DyadError(
          "Azure OpenAI resource name is required. Provide it in Settings or set the AZURE_RESOURCE_NAME environment variable.",
          DyadErrorKind.Validation,
        );
      }

      if (!azureApiKey) {
        throw new DyadError(
          "Azure OpenAI API key is required. Provide it in Settings or set the AZURE_API_KEY environment variable.",
          DyadErrorKind.Validation,
        );
      }

      const provider = createAzure({
        resourceName,
        apiKey: azureApiKey,
      });

      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "ollama": {
      const provider = createOllamaProvider({
        baseURL: getOllamaApiUrl(settings),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "lmstudio": {
      const provider = createOpenAICompatible({
        name: "lmstudio",
        baseURL: getLMStudioApiBaseUrl(settings),
        // LM Studio ignores the key but some SDK paths require a non-empty value.
        apiKey: apiKey?.trim() || "lm-studio",
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "mx_serve": {
      // Same OpenAI-compatible path as LM Studio — MX Serve differs only in
      // where it listens. The SDK requires a non-empty key even when the
      // server wants none, so a placeholder stands in for a blank field.
      const provider = createOpenAICompatible({
        name: "mx_serve",
        baseURL: getMxServeApiBaseUrl(settings),
        apiKey: apiKey?.trim() || "mx-serve",
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "bedrock": {
      // AWS Bedrock supports API key authentication using AWS_BEARER_TOKEN_BEDROCK
      // See: https://sdk.vercel.ai/providers/ai-sdk-providers/amazon-bedrock#api-key-authentication
      const provider = createAmazonBedrock({
        apiKey: apiKey,
        region: getEnvVar("AWS_REGION") || "us-east-1",
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "minimax": {
      const provider = createOpenAICompatible({
        name: "minimax",
        baseURL: "https://api.minimax.io/v1",
        apiKey,
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "phantom": {
      // Saved key wins; otherwise the hardcoded Hermes Phantom key is used so
      // the chat agent works even if the key never got saved in settings.
      const provider = createOpenAICompatible({
        name: "phantom",
        baseURL: getPhantomHermesApiBase(settings),
        apiKey: getPhantomApiKey(settings),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    default: {
      // Handle custom providers
      if (providerConfig.type === "custom") {
        if (!providerConfig.apiBaseUrl) {
          throw new DyadError(
            `Custom provider ${model.provider} is missing the API Base URL.`,
            DyadErrorKind.Validation,
          );
        }
        // Assume custom providers are OpenAI compatible for now
        const provider = createOpenAICompatible({
          name: providerConfig.id,
          baseURL: providerConfig.apiBaseUrl,
          apiKey,
        });
        return {
          modelClient: {
            model: provider(model.name),
          },
          backupModelClients: [],
        };
      }
      // If it's not a known ID and not type 'custom', it's unsupported
      throw new DyadError(
        `Unsupported model provider: ${model.provider}`,
        DyadErrorKind.Validation,
      );
    }
  }
}
