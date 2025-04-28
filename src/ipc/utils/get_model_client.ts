import { createOpenAI, OpenAIProvider } from "@ai-sdk/openai";
import { createGoogleGenerativeAI as createGoogle } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider";

import type { LargeLanguageModel, UserSettings } from "../../lib/schemas";
import {
  PROVIDER_TO_ENV_VAR,
  AUTO_MODELS,
  PROVIDERS,
  MODEL_OPTIONS,
} from "../../constants/models";
import { getEnvVar } from "./read_env";
import log from "electron-log";

const logger = log.scope("getModelClient");
export function getModelClient(
  model: LargeLanguageModel,
  settings: UserSettings
) {
  // Handle 'auto' provider by trying each model in AUTO_MODELS until one works
  if (model.provider === "auto") {
    // Try each model in AUTO_MODELS in order until finding one with an API key
    for (const autoModel of AUTO_MODELS) {
      const apiKey =
        settings.providerSettings?.[autoModel.provider]?.apiKey ||
        getEnvVar(PROVIDER_TO_ENV_VAR[autoModel.provider]);

      if (apiKey) {
        logger.log(
          `Using provider: ${autoModel.provider} model: ${autoModel.name}`
        );
        // Use the first model that has an API key
        return getModelClient(
          {
            provider: autoModel.provider,
            name: autoModel.name,
          } as LargeLanguageModel,
          settings
        );
      }
    }

    // If no models have API keys, throw an error
    throw new Error("No API keys available for any model in AUTO_MODELS");
  }

  const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;
  if (dyadApiKey && settings.enableDyadPro) {
    const provider = createOpenAI({
      apiKey: dyadApiKey,
      baseURL: "https://llm-gateway.dyad.sh/v1",
    });
    const providerInfo = PROVIDERS[model.provider as keyof typeof PROVIDERS];
    logger.info("Using Dyad Pro API key");
    // Do not use free variant (for openrouter).
    const modelName = model.name.split(":free")[0];
    return provider(`${providerInfo.gatewayPrefix}${modelName}`);
  }

  const apiKey =
    settings.providerSettings?.[model.provider]?.apiKey?.value ||
    getEnvVar(PROVIDER_TO_ENV_VAR[model.provider]);
  switch (model.provider) {
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
      const provider = createOllama();
      return provider(model.name);
    }
    default: {
      // Ensure exhaustive check if more providers are added
      const _exhaustiveCheck: never = model.provider;
      throw new Error(`Unsupported model provider: ${model.provider}`);
    }
  }
}

// Most models support at least 8000 output tokens so we use it as a default value.
const DEFAULT_MAX_TOKENS = 8_000;

export function getMaxTokens(model: LargeLanguageModel) {
  if (!MODEL_OPTIONS[model.provider as keyof typeof MODEL_OPTIONS]) {
    logger.warn(
      `Model provider ${model.provider} not found in MODEL_OPTIONS. Using default max tokens.`
    );
    return DEFAULT_MAX_TOKENS;
  }
  const modelOption = MODEL_OPTIONS[
    model.provider as keyof typeof MODEL_OPTIONS
  ].find((m) => m.name === model.name);
  return modelOption?.maxOutputTokens || DEFAULT_MAX_TOKENS;
}
