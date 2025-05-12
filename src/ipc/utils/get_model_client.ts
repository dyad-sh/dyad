import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI as createGoogle } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LargeLanguageModel, UserSettings } from "../../lib/schemas";
import { AUTO_MODELS, MODEL_OPTIONS } from "../../constants/models";
import { getEnvVar } from "./read_env";
import log from "electron-log";
import { getLanguageModelProviders } from "../shared/language_model_helpers";

const logger = log.scope("getModelClient");
export async function getModelClient(
  model: LargeLanguageModel,
  settings: UserSettings,
) {
  const allProviders = await getLanguageModelProviders();

  const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;
  // Handle 'auto' provider by trying each model in AUTO_MODELS until one works
  if (model.provider === "auto") {
    for (const autoModel of AUTO_MODELS) {
      const providerInfo = allProviders.find(
        (p) => p.id === autoModel.provider,
      );
      const envVarName = providerInfo?.envVarName;

      const apiKey =
        dyadApiKey ||
        settings.providerSettings?.[autoModel.provider]?.apiKey?.value ||
        (envVarName ? getEnvVar(envVarName) : undefined);

      if (apiKey) {
        logger.log(
          `Using provider: ${autoModel.provider} model: ${autoModel.name}`,
        );
        // Recursively call with the specific model found
        return await getModelClient(
          {
            provider: autoModel.provider,
            name: autoModel.name,
          } as LargeLanguageModel,
          settings,
        );
      }
    }
    // If no models have API keys, throw an error
    throw new Error(
      "No API keys available for any model supported by the 'auto' provider.",
    );
  }

  // --- Handle specific provider ---
  const providerConfig = allProviders.find((p) => p.id === model.provider);

  if (!providerConfig) {
    throw new Error(`Configuration not found for provider: ${model.provider}`);
  }

  // Handle Dyad Pro override
  if (dyadApiKey && settings.enableDyadPro) {
    // Check if the selected provider supports Dyad Pro (has a gateway prefix)
    if (providerConfig.gatewayPrefix) {
      const provider = createOpenAI({
        apiKey: dyadApiKey,
        baseURL: "https://llm-gateway.dyad.sh/v1",
      });
      logger.info("Using Dyad Pro API key via Gateway");
      // Do not use free variant (for openrouter).
      const modelName = model.name.split(":free")[0];
      return provider(`${providerConfig.gatewayPrefix}${modelName}`);
    } else {
      logger.warn(
        `Dyad Pro enabled, but provider ${model.provider} does not have a gateway prefix defined. Falling back to direct provider connection.`,
      );
      // Fall through to regular provider logic if gateway prefix is missing
    }
  }

  // Get API key for the specific provider
  const apiKey =
    settings.providerSettings?.[model.provider]?.apiKey?.value ||
    (providerConfig.envVarName
      ? getEnvVar(providerConfig.envVarName)
      : undefined);

  // Create client based on provider ID or type
  switch (providerConfig.id) {
    case "openai": {
      const provider = createOpenAI({ apiKey });
      return provider(model.name);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey });
      return provider(model.name);
    }
    case "google": {
      const provider = createGoogle({ apiKey });
      return provider(model.name);
    }
    case "openrouter": {
      const provider = createOpenRouter({ apiKey });
      return provider(model.name);
    }
    case "ollama": {
      // Ollama typically runs locally and doesn't require an API key in the same way
      const provider = createOllama({
        baseURL: providerConfig.apiBaseUrl,
      });
      return provider(model.name);
    }
    case "lmstudio": {
      // LM Studio uses OpenAI compatible API
      const baseURL = providerConfig.apiBaseUrl || "http://localhost:1234/v1";
      const provider = createOpenAICompatible({
        name: "lmstudio",
        baseURL,
      });
      return provider(model.name);
    }
    default: {
      // Handle custom providers
      if (providerConfig.type === "custom") {
        if (!providerConfig.apiBaseUrl) {
          throw new Error(
            `Custom provider ${model.provider} is missing the API Base URL.`,
          );
        }
        // Assume custom providers are OpenAI compatible for now
        const provider = createOpenAICompatible({
          name: providerConfig.id,
          baseURL: providerConfig.apiBaseUrl,
          apiKey: apiKey,
        });
        return provider(model.name);
      }
      // If it's not a known ID and not type 'custom', it's unsupported
      throw new Error(`Unsupported model provider: ${model.provider}`);
    }
  }
}

// Most models support at least 8000 output tokens so we use it as a default value.
const DEFAULT_MAX_TOKENS = 8_000;

export function getMaxTokens(model: LargeLanguageModel) {
  if (!MODEL_OPTIONS[model.provider as keyof typeof MODEL_OPTIONS]) {
    logger.warn(
      `Model provider ${model.provider} not found in MODEL_OPTIONS. Using default max tokens.`,
    );
    return DEFAULT_MAX_TOKENS;
  }
  const modelOption = MODEL_OPTIONS[
    model.provider as keyof typeof MODEL_OPTIONS
  ].find((m) => m.name === model.name);
  return modelOption?.maxOutputTokens || DEFAULT_MAX_TOKENS;
}
