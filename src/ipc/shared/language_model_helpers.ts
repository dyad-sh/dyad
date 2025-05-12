import { db } from "@/db";
import { language_model_providers as languageModelProvidersSchema } from "@/db/schema";
import { RegularModelProvider } from "@/constants/models";
import type { LanguageModelProvider } from "@/ipc/ipc_types";

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
