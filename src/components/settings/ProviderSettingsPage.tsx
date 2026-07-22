import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/back-button";
import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAtomValue } from "jotai";
import { firstPromptSagaAtom } from "@/first_prompt/projection";
import { useFirstPromptSend } from "@/first_prompt/FirstPromptProvider";
import { ipc, type ProviderApiKeyValidationProvider } from "@/ipc/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/toast";
import {
  UserSettings,
  AzureProviderSetting,
  VertexProviderSetting,
  hasDyadProKey,
} from "@/lib/schemas";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";

import { ProviderSettingsHeader } from "./ProviderSettingsHeader";
import { ApiKeyConfiguration } from "./ApiKeyConfiguration";
import { ModelsSection } from "./ModelsSection";

interface ProviderSettingsPageProps {
  provider: string;
}

type ApiKeyValidationDialogState = {
  message: string;
  apiKey: string;
  allowKeepInvalidKey: boolean;
  errorKind?: DyadErrorKind;
};

const VALIDATED_API_KEY_PROVIDERS = new Set<string>([
  "google",
  "openrouter",
  "auto",
]);

function getErrorKind(error: unknown): DyadErrorKind | undefined {
  const kind =
    typeof error === "object" && error !== null
      ? (error as { kind?: unknown }).kind
      : undefined;
  return typeof kind === "string" &&
    Object.values(DyadErrorKind).includes(kind as DyadErrorKind)
    ? (kind as DyadErrorKind)
    : undefined;
}

function getApiKeyValidationDialogTitle(
  dialog: ApiKeyValidationDialogState | null,
) {
  return dialog?.errorKind === DyadErrorKind.Auth
    ? "API key rejected"
    : "Could not verify API key";
}

export function ProviderSettingsPage({ provider }: ProviderSettingsPageProps) {
  const navigate = useNavigate();
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
    isAnyProviderSetup,
  } = useLanguageModelProviders();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

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

  const isDyad = provider === "auto";

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(
    null,
  );
  const [apiKeyValidationDialog, setApiKeyValidationDialog] =
    useState<ApiKeyValidationDialogState | null>(null);
  const [showStartBuildingBanner, setShowStartBuildingBanner] = useState(false);
  // Set when the user opens the provider's website to get a key; on the next
  // window refocus we nudge them toward the paste button.
  const [awaitingKeyFromWebsite, setAwaitingKeyFromWebsite] = useState(false);
  const [highlightPasteButton, setHighlightPasteButton] = useState(false);
  const queryClient = useQueryClient();
  const { hasArmedPayload } = useAtomValue(firstPromptSagaAtom);
  const sendFirstPrompt = useFirstPromptSend();

  // Use fetched data (or defaults for Dyad)
  const providerDisplayName = isDyad
    ? "Dyad"
    : (providerData?.name ?? "Unknown Provider");
  const providerWebsiteUrl = providerData?.websiteUrl;
  const hasFreeTier = isDyad ? false : providerData?.hasFreeTier;
  const envVarName = isDyad ? undefined : providerData?.envVarName;

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

  const isConfigured =
    provider === "azure"
      ? isAzureConfigured
      : provider === "vertex"
        ? isVertexConfigured
        : isValidUserKey || hasEnvKey; // Configured if either is set

  const shouldValidateApiKey = VALIDATED_API_KEY_PROVIDERS.has(provider);

  const normalizeAndValidateKeyInput = (value: string): string | null => {
    const normalizedValue = normalizeProviderApiKeyInput(value);
    if (!normalizedValue) {
      setSaveError("API Key cannot be empty.");
      return null;
    }
    const invalidCharacter =
      findInvalidProviderApiKeyCharacter(normalizedValue);
    if (invalidCharacter) {
      setSaveError(
        formatInvalidProviderApiKeyMessage(
          providerDisplayName,
          invalidCharacter,
        ),
      );
      return null;
    }
    return normalizedValue;
  };

  // --- Save Handler ---
  const handleSaveKey = async (
    value: string,
    options: { skipValidation?: boolean } = {},
  ) => {
    setHighlightPasteButton(false);
    const normalizedValue = normalizeAndValidateKeyInput(value);
    if (!normalizedValue) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    setTestSuccessMessage(null);
    try {
      if (shouldValidateApiKey && !options.skipValidation) {
        try {
          await ipc.settings.validateProviderApiKey({
            provider: provider as ProviderApiKeyValidationProvider,
            apiKey: normalizedValue,
          });
        } catch (error: any) {
          setApiKeyValidationDialog({
            message:
              error?.message ||
              `Dyad could not verify this ${providerDisplayName} API key.`,
            apiKey: normalizedValue,
            allowKeepInvalidKey: true,
            errorKind: getErrorKind(error),
          });
          return;
        }
      }

      const isFirstProviderSetup = !isAnyProviderSetup();
      // Check if this is the first time user is setting up Dyad Pro
      const isNewDyadProSetup = isDyad && settings && !hasDyadProKey(settings);

      const settingsUpdate: Partial<UserSettings> = {
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            apiKey: {
              value: normalizedValue,
            },
          },
        },
      };
      if (isDyad) {
        settingsUpdate.enableDyadPro = true;
        // Set default chat mode to local-agent when user upgrades to pro
        if (isNewDyadProSetup) {
          settingsUpdate.defaultChatMode = "local-agent";
        }
      }
      const nextSettings = settings
        ? ({ ...settings, ...settingsUpdate } as UserSettings)
        : undefined;
      const resumeDefaultChatMode = nextSettings
        ? getHomeDefaultChatMode(
            nextSettings,
            envVars,
            isQuotaLoading ? undefined : !isQuotaExceeded,
          )
        : settingsUpdate.defaultChatMode;
      await updateSettings(settingsUpdate);
      setApiKeyInput(""); // Clear input on success
      if (isFirstProviderSetup && hasArmedPayload) {
        sendFirstPrompt({
          type: "PROVIDER_CONFIGURED",
          defaultChatMode: resumeDefaultChatMode,
        });
      } else if (isFirstProviderSetup) {
        setShowStartBuildingBanner(true);
      }

      // Refetch user budget when Dyad Pro key is saved
      if (isDyad) {
        queryClient.invalidateQueries({ queryKey: queryKeys.userBudget.info });
      }
    } catch (error: any) {
      console.error("Error saving API key:", error);
      setSaveError(error.message || "Failed to save API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestKey = async (value: string) => {
    const normalizedValue = normalizeAndValidateKeyInput(value);
    if (!normalizedValue) {
      return;
    }
    if (!shouldValidateApiKey) {
      setSaveError(`${providerDisplayName} API keys cannot be tested yet.`);
      return;
    }

    setIsTesting(true);
    setSaveError(null);
    setTestSuccessMessage(null);
    try {
      await ipc.settings.validateProviderApiKey({
        provider: provider as ProviderApiKeyValidationProvider,
        apiKey: normalizedValue,
      });
      setTestSuccessMessage(`${providerDisplayName} API key looks good.`);
    } catch (error: any) {
      setApiKeyValidationDialog({
        message:
          error?.message ||
          `Dyad could not verify this ${providerDisplayName} API key.`,
        apiKey: normalizedValue,
        allowKeepInvalidKey: false,
        errorKind: getErrorKind(error),
      });
    } finally {
      setIsTesting(false);
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

  // --- Toggle Dyad Pro Handler ---
  const handleToggleDyadPro = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updateSettings({
        enableDyadPro: enabled,
      });
    } catch (error: any) {
      showError(`Error toggling Dyad Pro: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!awaitingKeyFromWebsite) {
      return;
    }
    const handleFocus = () => {
      setAwaitingKeyFromWebsite(false);
      setHighlightPasteButton(true);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [awaitingKeyFromWebsite]);

  useEffect(() => {
    setAwaitingKeyFromWebsite(false);
    setHighlightPasteButton(false);
  }, [provider]);

  // Effect to clear input error when input changes
  useEffect(() => {
    if (saveError) {
      setSaveError(null);
    }
    if (testSuccessMessage) {
      setTestSuccessMessage(null);
    }
  }, [apiKeyInput]);

  // --- Loading State for Providers ---
  if (providersLoading) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-8 w-24 mb-4" />
          <Skeleton className="h-10 w-1/2 mb-6" />
          <Skeleton className="h-10 w-48 mb-4" />
          <div className="space-y-4 mt-6">
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // --- Error State for Providers ---
  if (providersError) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <BackButton />
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
        </div>
      </div>
    );
  }

  // Handle case where provider is not found (e.g., invalid ID in URL)
  if (!providerData && !isDyad) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <BackButton />
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
        </div>
      </div>
    );
  }

  const shouldShowStartBuildingBanner = showStartBuildingBanner && isConfigured;

  return (
    <div className="min-h-screen w-full">
      <AlertDialog
        open={!!apiKeyValidationDialog}
        onOpenChange={(open) => {
          if (!open) {
            setApiKeyValidationDialog(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {getApiKeyValidationDialogTitle(apiKeyValidationDialog)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {apiKeyValidationDialog?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {apiKeyValidationDialog?.allowKeepInvalidKey && (
              <AlertDialogCancel
                onClick={() => {
                  const apiKey = apiKeyValidationDialog.apiKey;
                  setApiKeyValidationDialog(null);
                  void handleSaveKey(apiKey, { skipValidation: true });
                }}
              >
                Keep invalid API key
              </AlertDialogCancel>
            )}
            <AlertDialogAction
              onClick={() => {
                setApiKeyValidationDialog(null);
              }}
            >
              Try another API key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {shouldShowStartBuildingBanner && (
        <button
          type="button"
          onClick={() => navigate({ to: "/", search: {} })}
          className="sticky top-0 z-30 w-full border-b border-green-200 bg-green-50/95 px-8 py-5 text-left shadow-md backdrop-blur-sm transition-colors hover:bg-green-100/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-green-900/70 dark:bg-green-950/70 dark:hover:bg-green-900/60"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/70 dark:text-green-300">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-green-950 dark:text-green-100">
                  AI access is ready
                </h2>
                <p className="mt-1 text-sm text-green-800/80 dark:text-green-200/80">
                  You can now start building with Dyad.
                </p>
              </div>
            </div>
            <span className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-xs transition-colors">
              Start building
            </span>
          </div>
        </button>
      )}

      <div className="px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <ProviderSettingsHeader
            providerDisplayName={providerDisplayName}
            isConfigured={isConfigured}
            isLoading={settingsLoading}
            hasFreeTier={hasFreeTier}
            providerWebsiteUrl={providerWebsiteUrl}
            isDyad={isDyad}
            onOpenProviderWebsite={() => {
              if (!isConfigured) {
                setAwaitingKeyFromWebsite(true);
              }
            }}
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
          ) : (
            <ApiKeyConfiguration
              provider={provider}
              providerDisplayName={providerDisplayName}
              settings={settings}
              envVars={envVars}
              envVarName={envVarName}
              isSaving={isSaving}
              isTesting={isTesting}
              saveError={saveError}
              testSuccessMessage={testSuccessMessage}
              apiKeyInput={apiKeyInput}
              onApiKeyInputChange={(value) => {
                setHighlightPasteButton(false);
                setApiKeyInput(value);
              }}
              onSaveKey={handleSaveKey}
              onTestKey={shouldValidateApiKey ? handleTestKey : undefined}
              onDeleteKey={handleDeleteKey}
              isDyad={isDyad}
              updateSettings={updateSettings}
              highlightPasteButton={highlightPasteButton}
              onDismissPasteHighlight={() => setHighlightPasteButton(false)}
            />
          )}

          {isDyad && !settingsLoading && (
            <div className="mt-6 flex items-center justify-between p-4 bg-(--background-lightest) rounded-lg border">
              <div>
                <h3 className="font-medium">Enable Dyad Pro</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Toggle to enable Dyad Pro
                </p>
              </div>
              <Switch
                aria-label="Enable Dyad Pro"
                checked={settings?.enableDyadPro}
                onCheckedChange={handleToggleDyadPro}
                disabled={isSaving}
              />
            </div>
          )}

          {/* Conditionally render CustomModelsSection */}
          {supportsCustomModels && providerData && (
            <ModelsSection providerId={providerData.id} />
          )}
          <div className="h-24"></div>
        </div>
      </div>
    </div>
  );
}
