import { useState, useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {} from "@/components/ui/accordion";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/toast";
import {
  UserSettings,
  AzureProviderSetting,
  VertexProviderSetting,
  hasDyadProKey,
} from "@/lib/schemas";

import { PageContainer } from "@/components/PageContainer";
import { ProviderSettingsHeader } from "./ProviderSettingsHeader";
import { ApiKeyConfiguration } from "./ApiKeyConfiguration";
import { LocalProviderConfiguration } from "./LocalProviderConfiguration";
import { ModelsSection } from "./ModelsSection";
import { isLocalProviderId } from "@/lib/local_provider_utils";
import { useLocalProviderStatus } from "@/hooks/useLocalProviderStatus";

interface ProviderSettingsPageProps {
  provider: string;
}

export function ProviderSettingsPage({ provider }: ProviderSettingsPageProps) {
  const {
    settings,
    envVars,
    loading: settingsLoading,
    error: settingsError,
    updateSettings,
  } = useSettings();

  // Fetch all providers
  const {
    data: allProviders,
    isLoading: providersLoading,
    error: providersError,
  } = useLanguageModelProviders();

  // Find the specific provider data from the fetched list
  const providerData = allProviders?.find((p) => p.id === provider);
  useEffect(() => {
    const layoutMainContentContainer = document.getElementById(
      "layout-main-content-container",
    );
    if (layoutMainContentContainer) {
      layoutMainContentContainer.scrollTo(0, 0);
    }
  }, [providerData?.id]);

  const supportsCustomModels =
    providerData?.type === "custom" || providerData?.type === "cloud";

  const isMetaHumanOS = provider === "auto";
  const isLocalProvider = isLocalProviderId(provider);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Use fetched data (or defaults for Meta Human OS)
  const providerDisplayName = isMetaHumanOS
    ? "Meta Human OS"
    : (providerData?.name ?? "Unknown Provider");
  const providerWebsiteUrl = providerData?.websiteUrl;
  const hasFreeTier = isMetaHumanOS ? false : providerData?.hasFreeTier;
  const envVarName = isMetaHumanOS ? undefined : providerData?.envVarName;

  // Use provider ID (which is the 'provider' prop)
  const userApiKey = settings?.providerSettings?.[provider]?.apiKey?.value;

  // --- Configuration Logic --- Updated Priority ---
  const isValidUserKey =
    !!userApiKey &&
    !userApiKey.startsWith("Invalid Key") &&
    userApiKey !== "Not Set";
  const hasEnvKey = !!(envVarName && envVars[envVarName]);

  const azureSettings = settings?.providerSettings?.azure as
    | AzureProviderSetting
    | undefined;
  const azureApiKeyFromSettings = (azureSettings?.apiKey?.value ?? "").trim();
  const azureResourceNameFromSettings = (
    azureSettings?.resourceName ?? ""
  ).trim();
  const azureHasSavedSettings = Boolean(
    azureApiKeyFromSettings && azureResourceNameFromSettings,
  );
  const azureHasEnvConfiguration = Boolean(
    envVars["AZURE_API_KEY"] && envVars["AZURE_RESOURCE_NAME"],
  );

  const vertexSettings = settings?.providerSettings?.vertex as
    | VertexProviderSetting
    | undefined;
  const isVertexConfigured = Boolean(
    vertexSettings?.projectId &&
    vertexSettings?.location &&
    vertexSettings?.serviceAccountKey?.value,
  );

  const isAzureConfigured =
    provider === "azure"
      ? azureHasSavedSettings || azureHasEnvConfiguration
      : false;

  const localServerUrl = (
    settings?.providerSettings?.[provider] as
      | { apiBaseUrl?: string }
      | undefined
  )?.apiBaseUrl?.trim();
  const localProviderStatus = useLocalProviderStatus(provider, localServerUrl);

  const isConfigured = isLocalProvider
    ? Boolean(localServerUrl)
    : provider === "azure"
      ? isAzureConfigured
      : provider === "vertex"
        ? isVertexConfigured
        : isValidUserKey || hasEnvKey;

  // --- Save Handler ---
  const handleSaveKey = async (value: string) => {
    if (!value.trim()) {
      setSaveError("API Key cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      // Check if this is the first time user is setting up Pro
      const isNewProSetup =
        isMetaHumanOS && settings && !hasDyadProKey(settings);

      const settingsUpdate: Partial<UserSettings> = {
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            apiKey: {
              value,
            },
          },
        },
      };
      if (isMetaHumanOS) {
        settingsUpdate.enableDyadPro = true;
        // Set default chat mode to local-agent when user upgrades to pro
        if (isNewProSetup) {
          settingsUpdate.defaultChatMode = "local-agent";
        }
      }
      await updateSettings(settingsUpdate);
      setApiKeyInput(""); // Clear input on success

      // Refetch user budget when Pro key is saved
      if (isMetaHumanOS) {
        queryClient.invalidateQueries({ queryKey: queryKeys.userBudget.info });
      }
    } catch (error: any) {
      console.error("Error saving API key:", error);
      setSaveError(error.message || "Failed to save API key.");
    } finally {
      setIsSaving(false);
    }
  };

  /** Persists the thinking switch without disturbing the saved URL. */
  const handleSetDisableThinking = async (disableThinking: boolean) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            disableThinking,
          },
        },
      });
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save setting.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveLocalServerUrl = async (apiBaseUrl: string) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            apiBaseUrl: apiBaseUrl.trim(),
          },
        },
      });
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save server URL.",
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  // --- Delete Handler ---
  const handleDeleteKey = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            apiKey: undefined,
          },
        },
      });
      // Optionally show a success message
    } catch (error: any) {
      console.error("Error deleting API key:", error);
      setSaveError(error.message || "Failed to delete API key.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- Toggle Pro Handler ---
  const handleTogglePro = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updateSettings({
        enableDyadPro: enabled,
      });
    } catch (error: any) {
      showError(`Error toggling Pro: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Clear the input error only when the user edits the input. Depending on
  // saveError would instantly re-clear a freshly-set error.
  useEffect(() => {
    if (saveError) {
      setSaveError(null);
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [apiKeyInput]);

  // --- Loading State for Providers ---
  if (providersLoading) {
    return (
      <PageContainer size="md">
        <Skeleton className="h-8 w-24 mb-4" />
        <Skeleton className="h-10 w-1/2 mb-6" />
        <Skeleton className="h-10 w-48 mb-4" />
        <div className="space-y-4 mt-6">
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  // --- Error State for Providers ---
  if (providersError) {
    return (
      <PageContainer size="md">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3 mb-6">
          Configure Provider
        </h1>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error Loading Provider Details</AlertTitle>
          <AlertDescription>
            Could not load provider data: {providersError.message}
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  // Handle case where provider is not found (e.g., invalid ID in URL)
  if (!providerData && !isMetaHumanOS) {
    return (
      <PageContainer size="md">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3 mb-6">
          Provider Not Found
        </h1>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            The provider with ID "{provider}" could not be found.
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="md" innerClassName="max-w-2xl">
      <ProviderSettingsHeader
        providerDisplayName={providerDisplayName}
        isConfigured={isConfigured}
        isLoading={settingsLoading}
        hasFreeTier={hasFreeTier}
        providerWebsiteUrl={providerWebsiteUrl}
        isMetaHumanOS={isMetaHumanOS}
        isLocalProvider={isLocalProvider}
        localConnectionStatus={
          isLocalProvider ? localProviderStatus.status : undefined
        }
        onBackClick={() => router.history.back()}
      />

      {settingsLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : settingsError ? (
        <Alert variant="destructive">
          <AlertTitle>Error Loading Settings</AlertTitle>
          <AlertDescription>
            Could not load configuration data: {settingsError.message}
          </AlertDescription>
        </Alert>
      ) : isLocalProvider ? (
        <LocalProviderConfiguration
          provider={provider}
          providerDisplayName={providerDisplayName}
          settings={settings}
          isSaving={isSaving}
          onSave={handleSaveLocalServerUrl}
          onSetDisableThinking={handleSetDisableThinking}
        />
      ) : (
        <ApiKeyConfiguration
          provider={provider}
          providerDisplayName={providerDisplayName}
          settings={settings}
          envVars={envVars}
          envVarName={envVarName}
          isSaving={isSaving}
          saveError={saveError}
          apiKeyInput={apiKeyInput}
          onApiKeyInputChange={setApiKeyInput}
          onSaveKey={handleSaveKey}
          onDeleteKey={handleDeleteKey}
          isMetaHumanOS={isMetaHumanOS}
          updateSettings={updateSettings}
        />
      )}
      {saveError && isLocalProvider && (
        <p className="mt-2 text-xs text-destructive">{saveError}</p>
      )}

      {isMetaHumanOS && !settingsLoading && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-border/70 bg-card/50 p-4 shadow-sm">
          <div>
            <h3 className="text-sm font-semibold">Enable Pro</h3>
            <p className="text-sm text-muted-foreground">
              Toggle to enable Pro
            </p>
          </div>
          <Switch
            aria-label="Enable Pro"
            checked={settings?.enableDyadPro}
            onCheckedChange={handleTogglePro}
            disabled={isSaving}
          />
        </div>
      )}

      {/* Conditionally render CustomModelsSection */}
      {supportsCustomModels && providerData && (
        <ModelsSection providerId={providerData.id} />
      )}
      <div className="h-24" />
    </PageContainer>
  );
}
