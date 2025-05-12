import { db } from "@/db";
import {
  language_model_providers as languageModelProvidersSchema,
  language_models as languageModelsSchema,
} from "@/db/schema";
import { MODEL_OPTIONS, RegularModelProvider } from "@/constants/models";
import type { LanguageModelProvider, LanguageModel } from "@/ipc/ipc_types";
import { eq } from "drizzle-orm";

export const PROVIDER_TO_ENV_VAR: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export const PROVIDERS: Record<
  RegularModelProvider,
  {
    displayName: string;
    hasFreeTier?: boolean;
    websiteUrl?: string;
    gatewayPrefix: string;
  }
> = {
  openai: {
    displayName: "OpenAI",
    hasFreeTier: false,
    websiteUrl: "https://platform.openai.com/api-keys",
    gatewayPrefix: "",
  },
  anthropic: {
    displayName: "Anthropic",
    hasFreeTier: false,
    websiteUrl: "https://console.anthropic.com/settings/keys",
    gatewayPrefix: "anthropic/",
  },
  google: {
    displayName: "Google",
    hasFreeTier: true,
    websiteUrl: "https://aistudio.google.com/app/apikey",
    gatewayPrefix: "gemini/",
  },
  openrouter: {
    displayName: "OpenRouter",
    hasFreeTier: true,
    websiteUrl: "https://openrouter.ai/settings/keys",
    gatewayPrefix: "openrouter/",
  },
  auto: {
    displayName: "Dyad",
    websiteUrl: "https://academy.dyad.sh/settings",
    gatewayPrefix: "",
  },
};

/**
 * Fetches language model providers from both the database (custom) and hardcoded constants (cloud),
 * merging them with custom providers taking precedence.
 * @returns A promise that resolves to an array of LanguageModelProvider objects.
 */
export async function getLanguageModelProviders(): Promise<
  LanguageModelProvider[]
> {
  // Fetch custom providers from the database
  const customProvidersDb = await db
    .select()
    .from(languageModelProvidersSchema);

  const customProvidersMap = new Map<string, LanguageModelProvider>();
  for (const cp of customProvidersDb) {
    customProvidersMap.set(cp.id, {
      id: cp.id,
      name: cp.name,
      apiBaseUrl: cp.api_base_url,
      envVarName: cp.env_var_name ?? undefined,
      type: "custom",
      // hasFreeTier, websiteUrl, gatewayPrefix are not in the custom DB schema
      // They will be undefined unless overridden by hardcoded values if IDs match
    });
  }

  // Get hardcoded cloud providers
  const hardcodedProviders: LanguageModelProvider[] = [];
  for (const providerKey in PROVIDERS) {
    if (Object.prototype.hasOwnProperty.call(PROVIDERS, providerKey)) {
      // Ensure providerKey is a key of PROVIDERS
      const key = providerKey as keyof typeof PROVIDERS;
      const providerDetails = PROVIDERS[key];
      if (providerDetails) {
        // Ensure providerDetails is not undefined
        hardcodedProviders.push({
          id: key,
          name: providerDetails.displayName,
          hasFreeTier: providerDetails.hasFreeTier,
          websiteUrl: providerDetails.websiteUrl,
          gatewayPrefix: providerDetails.gatewayPrefix,
          envVarName: PROVIDER_TO_ENV_VAR[key] ?? undefined,
          type: "cloud",
          // apiBaseUrl is not directly in PROVIDERS
        });
      }
    }
  }

  // Merge lists: custom providers take precedence
  const mergedProvidersMap = new Map<string, LanguageModelProvider>();

  // Add all hardcoded providers first
  for (const hp of hardcodedProviders) {
    mergedProvidersMap.set(hp.id, hp);
  }

  // Add/overwrite with custom providers from DB
  for (const [id, cp] of customProvidersMap) {
    const existingProvider = mergedProvidersMap.get(id);
    if (existingProvider) {
      // If exists, merge. Custom fields take precedence.
      mergedProvidersMap.set(id, {
        ...existingProvider, // start with hardcoded
        ...cp, // override with custom where defined
        id: cp.id, // ensure custom id is used
        name: cp.name, // ensure custom name is used
        type: "custom", // explicitly set type to custom
        apiBaseUrl: cp.apiBaseUrl ?? existingProvider.apiBaseUrl,
        envVarName: cp.envVarName ?? existingProvider.envVarName,
      });
    } else {
      // If it doesn't exist in hardcoded, just add the custom one
      mergedProvidersMap.set(id, cp);
    }
  }

  return Array.from(mergedProvidersMap.values());
}

/**
 * Fetches language models for a specific provider.
 * @param obj An object containing the providerId.
 * @returns A promise that resolves to an array of LanguageModel objects.
 */
export async function getLanguageModels(obj: {
  providerId: string;
}): Promise<LanguageModel[]> {
  const { providerId } = obj;
  const allProviders = await getLanguageModelProviders();
  const provider = allProviders.find((p) => p.id === providerId);

  if (!provider) {
    console.warn(`Provider with ID "${providerId}" not found.`);
    return [];
  }

  if (provider.type === "cloud") {
    // Check if providerId is a valid key for MODEL_OPTIONS
    if (providerId in MODEL_OPTIONS) {
      const models = MODEL_OPTIONS[providerId as RegularModelProvider] || [];
      return models.map((model) => ({
        ...model,
        id: model.name,
        type: "cloud",
      }));
    } else {
      console.warn(
        `Provider "${providerId}" is cloud type but not found in MODEL_OPTIONS.`,
      );
      return [];
    }
  } else if (provider.type === "custom") {
    // Fetch models from the database for this custom provider
    // Assuming a language_models table with necessary columns and provider_id foreign key
    try {
      const customModelsDb = await db
        .select({
          id: languageModelsSchema.id,
          // Map DB columns to LanguageModel fields
          name: languageModelsSchema.name,
          // No display_name in DB, use name instead
          description: languageModelsSchema.description,
          // No tag in DB
          maxOutputTokens: languageModelsSchema.max_output_tokens,
          contextWindow: languageModelsSchema.context_window,
        })
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.provider_id, providerId)); // Assuming eq is imported or available

      return customModelsDb.map((model) => ({
        ...model,
        displayName: model.name, // Use name as displayName for custom models
        // Ensure possibly null fields are handled, provide defaults or undefined if needed
        description: model.description ?? "",
        tag: undefined, // No tag for custom models from DB
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        contextWindow: model.contextWindow ?? undefined,
        type: "custom",
      }));
    } catch (error) {
      console.error(
        `Error fetching custom models for provider "${providerId}" from DB:`,
        error,
      );
      // Depending on desired behavior, could throw, return empty, or return a specific error state
      return [];
    }
  } else {
    // Handle other types like "local" if necessary, currently ignored
    console.warn(
      `Provider type "${provider.type}" not handled for model fetching.`,
    );
    return [];
  }
}
