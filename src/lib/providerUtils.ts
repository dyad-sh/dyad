import {
  type UserSettings,
  type VertexProviderSetting,
  type AzureProviderSetting,
} from "./schemas";
import { PROVIDER_TO_ENV_VAR } from "../ipc/shared/language_model_constants";

export interface ProviderCheckOptions {
  settings: UserSettings | null;
  envVars: Record<string, string | undefined>;
  /** Provider data from the query (needed for custom providers and env var lookup) */
  providerData?: { id: string; envVarName?: string }[];
  /** If true, returns false while data is still loading */
  isLoading?: boolean;
}

/**
 * Checks if a specific provider is set up with valid credentials.
 * Works with settings and optionally env vars.
 */
export function isProviderSetup(
  provider: string,
  options: ProviderCheckOptions,
): boolean {
  const { settings, envVars, providerData, isLoading } = options;

  if (isLoading) {
    return false;
  }

  const providerSettings = settings?.providerSettings[provider];

  // Vertex uses service account credentials instead of an API key
  if (provider === "vertex") {
    const vertexSettings = providerSettings as VertexProviderSetting;
    if (
      vertexSettings?.serviceAccountKey?.value &&
      vertexSettings?.projectId &&
      vertexSettings?.location
    ) {
      return true;
    }
    return false;
  }

  // Azure needs apiKey + resourceName
  if (provider === "azure") {
    const azureSettings = providerSettings as AzureProviderSetting;
    const hasSavedSettings = Boolean(
      (azureSettings?.apiKey?.value ?? "").trim() &&
      (azureSettings?.resourceName ?? "").trim(),
    );
    if (hasSavedSettings) {
      return true;
    }
    if (envVars["AZURE_API_KEY"] && envVars["AZURE_RESOURCE_NAME"]) {
      return true;
    }
    return false;
  }

  // Check API key in settings
  if (providerSettings?.apiKey?.value) {
    return true;
  }

  // Check env var - first try the static mapping, then provider data
  const staticEnvVar = PROVIDER_TO_ENV_VAR[provider];
  if (staticEnvVar && envVars[staticEnvVar]) {
    return true;
  }

  // Check provider data for env var name (for custom providers)
  const providerInfo = providerData?.find((p) => p.id === provider);
  if (providerInfo?.envVarName && envVars[providerInfo.envVarName]) {
    return true;
  }

  return false;
}

/**
 * Simple check for whether OpenAI or Anthropic provider is set up.
 * Used for determining if basic agent mode should be available.
 */
export function isOpenAIOrAnthropicSetup(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
): boolean {
  if (!settings) return false;

  const options: ProviderCheckOptions = { settings, envVars };
  return (
    isProviderSetup("openai", options) || isProviderSetup("anthropic", options)
  );
}
