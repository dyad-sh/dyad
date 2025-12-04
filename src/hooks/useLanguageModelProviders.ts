import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { LanguageModelProvider } from "@/ipc/ipc_types";
import { useSettings } from "./useSettings";
import {
  cloudProviders,
  VertexProviderSetting,
  AzureProviderSetting,
  ClaudeCodeProviderSetting,
} from "@/lib/schemas";

export function useLanguageModelProviders() {
  const ipcClient = IpcClient.getInstance();
  const { settings, envVars } = useSettings();

  const queryResult = useQuery<LanguageModelProvider[], Error>({
    queryKey: ["languageModelProviders"],
    queryFn: async () => {
      return ipcClient.getLanguageModelProviders();
    },
  });

  const claudeCodeSettings = settings?.providerSettings?.[
    "claude-code"
  ] as ClaudeCodeProviderSetting | undefined;

  const { data: claudeCliExists } = useQuery<boolean, Error>({
    queryKey: [
      "claudeCliExists",
      claudeCodeSettings?.claudeExecutablePath,
      envVars["CLAUDE_CODE_EXECUTABLE_PATH"],
    ],
    queryFn: async () => {
      try {
        return await ipcClient.checkClaudeCliExists();
      } catch (error) {
        console.error("Error checking Claude CLI existence:", error);
        return false;
      }
    },
    staleTime: 5000, // Cache for 5 seconds
    enabled: !!settings, // Only run query when settings are loaded
  });

  const isProviderSetup = (provider: string) => {
    const providerSettings = settings?.providerSettings[provider];
    if (queryResult.isLoading) {
      return false;
    }
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
    // Check if API key is set and valid (not a placeholder value)
    const apiKeyValue = providerSettings?.apiKey?.value;
    if (
      apiKeyValue &&
      !apiKeyValue.startsWith("Invalid Key") &&
      apiKeyValue !== "Not Set"
    ) {
      return true;
    }
    const providerData = queryResult.data?.find((p) => p.id === provider);
    if (providerData?.envVarName && envVars[providerData.envVarName]) {
      return true;
    }
    // Claude Code (Agent SDK) requires Claude CLI executable to be present
    // Check this last as it's a special case that doesn't require API key
    if (provider === "claude-code") {
      return claudeCliExists ?? false;
    }
    return false;
  };

  const isAnyProviderSetup = () => {
    // Check hardcoded cloud providers
    if (cloudProviders.some((provider) => isProviderSetup(provider))) {
      return true;
    }

    // Check custom providers
    const customProviders = queryResult.data?.filter(
      (provider) => provider.type === "custom",
    );
    return (
      customProviders?.some((provider) => isProviderSetup(provider.id)) ?? false
    );
  };

  return {
    ...queryResult,
    isProviderSetup,
    isAnyProviderSetup,
  };
}
