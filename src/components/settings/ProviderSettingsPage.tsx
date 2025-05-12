import { useState, useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Info,
  Circle,
  Settings as SettingsIcon,
  GiftIcon,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/toast";
import { UserSettings } from "@/lib/schemas";

interface ProviderSettingsPageProps {
  provider: string;
}

// Helper function to mask ENV API keys (still needed for env vars)
const maskEnvApiKey = (key: string | undefined): string => {
  if (!key) return "Not Set";
  if (key.length < 8) return "****";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
};

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

  const isDyad = provider === "auto";

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();

  // Find the specific provider data from the fetched list
  const providerData = allProviders?.find((p) => p.id === provider);

  // Use fetched data (or defaults for Dyad)
  const providerDisplayName = isDyad
    ? "Dyad"
    : (providerData?.name ?? "Unknown Provider");
  const providerWebsiteUrl = isDyad
    ? "https://academy.dyad.sh/settings"
    : providerData?.websiteUrl;
  const hasFreeTier = isDyad ? false : providerData?.hasFreeTier;
  const envVarName = isDyad ? undefined : providerData?.envVarName;
  const envApiKey = envVarName ? envVars[envVarName] : undefined;

  // Use provider ID (which is the 'provider' prop)
  const userApiKey = settings?.providerSettings?.[provider]?.apiKey?.value;

  // --- Configuration Logic --- Updated Priority ---
  const isValidUserKey =
    !!userApiKey &&
    !userApiKey.startsWith("Invalid Key") &&
    userApiKey !== "Not Set";
  const hasEnvKey = !!envApiKey;

  const isConfigured = isValidUserKey || hasEnvKey; // Configured if either is set
  // Settings key takes precedence if it's valid
  const activeKeySource = isValidUserKey
    ? "settings"
    : hasEnvKey
      ? "env"
      : "none";

  // --- Accordion Logic ---
  const defaultAccordionValue = [];
  if (isValidUserKey || !hasEnvKey) {
    // If user key is set OR env key is NOT set, open the settings accordion item
    defaultAccordionValue.push("settings-key");
  }
  if (hasEnvKey) {
    defaultAccordionValue.push("env-key");
  }

  // --- Save Handler ---
  const handleSaveKey = async () => {
    if (!apiKeyInput) {
      setSaveError("API Key cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const settingsUpdate: Partial<UserSettings> = {
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            apiKey: {
              value: apiKeyInput,
            },
          },
        },
      };
      if (isDyad) {
        settingsUpdate.enableDyadPro = true;
      }
      await updateSettings(settingsUpdate);
      setApiKeyInput(""); // Clear input on success
      // Optionally show a success message
    } catch (error: any) {
      console.error("Error saving API key:", error);
      setSaveError(error.message || "Failed to save API key.");
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

  // Effect to clear input error when input changes
  useEffect(() => {
    if (saveError) {
      setSaveError(null);
    }
  }, [apiKeyInput]);

  // --- Loading State for Providers --- (Added)
  if (providersLoading) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-8 w-24 mb-4" /> {/* Back button */}
          <Skeleton className="h-10 w-1/2 mb-6" /> {/* Title */}
          <Skeleton className="h-10 w-48 mb-4" /> {/* Get Key button */}
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // --- Error State for Providers --- (Added)
  if (providersError) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
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
        </div>
      </div>
    );
  }

  // Handle case where provider is not found (e.g., invalid ID in URL)
  if (!providerData && !isDyad) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-4xl mx-auto">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>

        <div className="mb-6">
          <div className="flex items-center mb-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3">
              Configure {providerDisplayName}
            </h1>
            {settingsLoading ? (
              <Skeleton className="h-6 w-6 rounded-full" />
            ) : (
              <Circle
                className={`h-5 w-5 ${
                  isConfigured
                    ? "fill-green-500 text-green-600"
                    : "fill-yellow-400 text-yellow-500"
                }`}
              />
            )}
            <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
              {settingsLoading
                ? "Loading..."
                : isConfigured
                  ? "Setup Complete"
                  : "Not Setup"}
            </span>
          </div>
          {!settingsLoading && hasFreeTier && (
            <span className="text-blue-600 mt-2 dark:text-blue-400 text-sm font-medium bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded-full inline-flex items-center">
              <GiftIcon className="w-4 h-4 mr-1" />
              Free tier available
            </span>
          )}
        </div>

        {providerWebsiteUrl && !settingsLoading && (
          <Button
            onClick={(e) => {
              e.preventDefault();
              IpcClient.getInstance().openExternalUrl(providerWebsiteUrl);
            }}
            className="mb-4 bg-(--background-lightest) cursor-pointer py-5"
            variant="outline"
          >
            {isConfigured ? (
              <SettingsIcon className="mr-2 h-4 w-4" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            {getKeyButtonText({ isConfigured, isDyad })}
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        )}

        {settingsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : settingsError ? (
          <Alert variant="destructive">
            <AlertTitle>Error Loading Settings</AlertTitle>
            <AlertDescription>
              Could not load configuration data: {settingsError.message}
            </AlertDescription>
          </Alert>
        ) : (
          <Accordion
            type="multiple"
            className="w-full space-y-4"
            defaultValue={defaultAccordionValue}
          >
            <AccordionItem
              value="settings-key"
              className="border rounded-lg px-4 bg-(--background-lightest)"
            >
              <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
                API Key from Settings
              </AccordionTrigger>
              <AccordionContent className="pt-4 ">
                {isValidUserKey && (
                  <Alert variant="default" className="mb-4">
                    <KeyRound className="h-4 w-4" />
                    <AlertTitle className="flex justify-between items-center">
                      <span>Current Key (Settings)</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteKey}
                        disabled={isSaving}
                        className="flex items-center gap-1 h-7 px-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        {isSaving ? "Deleting..." : "Delete"}
                      </Button>
                    </AlertTitle>
                    <AlertDescription>
                      <p className="font-mono text-sm">{userApiKey}</p>
                      {activeKeySource === "settings" && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          This key is currently active.
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label
                    htmlFor="apiKeyInput"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {isValidUserKey ? "Update" : "Set"} {providerDisplayName}{" "}
                    API Key
                  </label>
                  <div className="flex items-start space-x-2">
                    <Input
                      id="apiKeyInput"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={`Enter new ${providerDisplayName} API Key here`}
                      className={`flex-grow ${
                        saveError ? "border-red-500" : ""
                      }`}
                    />
                    <Button
                      onClick={handleSaveKey}
                      disabled={isSaving || !apiKeyInput}
                    >
                      {isSaving ? "Saving..." : "Save Key"}
                    </Button>
                  </div>
                  {saveError && (
                    <p className="text-xs text-red-600">{saveError}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Setting a key here will override the environment variable
                    (if set).
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            {!isDyad && envVarName && (
              <AccordionItem
                value="env-key"
                className="border rounded-lg px-4 bg-(--background-lightest)"
              >
                <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
                  API Key from Environment Variable
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  {hasEnvKey ? (
                    <Alert variant="default">
                      <KeyRound className="h-4 w-4" />
                      <AlertTitle>
                        Environment Variable Key ({envVarName})
                      </AlertTitle>
                      <AlertDescription>
                        <p className="font-mono text-sm">
                          {maskEnvApiKey(envApiKey)}
                        </p>
                        {activeKeySource === "env" && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            This key is currently active (no settings key set).
                          </p>
                        )}
                        {activeKeySource === "settings" && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            This key is currently being overridden by the key
                            set in Settings.
                          </p>
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="default">
                      <Info className="h-4 w-4" />
                      <AlertTitle>Environment Variable Not Set</AlertTitle>
                      <AlertDescription>
                        The{" "}
                        <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">
                          {envVarName}
                        </code>{" "}
                        environment variable is not set.
                      </AlertDescription>
                    </Alert>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    This key is set outside the application. If present, it will
                    be used only if no key is configured in the Settings section
                    above. Requires app restart to detect changes.
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
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
              checked={settings?.enableDyadPro}
              onCheckedChange={handleToggleDyadPro}
              disabled={isSaving}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function getKeyButtonText({
  isConfigured,
  isDyad,
}: {
  isConfigured: boolean;
  isDyad: boolean;
}) {
  if (isDyad) {
    return isConfigured
      ? "Manage Dyad Pro Subscription"
      : "Setup Dyad Pro Subscription";
  }
  return isConfigured ? "Manage API Keys" : "Setup API Key";
}
