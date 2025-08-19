import { Info, KeyRound, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserSettings } from "@/lib/schemas";

// Helper function to mask ENV API keys (move or duplicate if needed elsewhere)
const maskEnvApiKey = (key: string | undefined): string => {
  if (!key) return "Not Set";
  if (key.length < 8) return "****";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
};

interface ApiKeyConfigurationProps {
  provider: string;
  providerDisplayName: string;
  settings: UserSettings | null | undefined;
  envVars: Record<string, string | undefined>;
  envVarName?: string;
  isSaving: boolean;
  saveError: string | null;
  apiKeyInput: string;
  onApiKeyInputChange: (value: string) => void;
  onSaveKey: () => Promise<void>;
  onDeleteKey: () => Promise<void>;
  isDyad: boolean;
}

export function ApiKeyConfiguration({
  provider,
  providerDisplayName,
  settings,
  envVars,
  envVarName,
  isSaving,
  saveError,
  apiKeyInput,
  onApiKeyInputChange,
  onSaveKey,
  onDeleteKey,
  isDyad,
}: ApiKeyConfigurationProps) {
  // Special handling for Azure OpenAI which requires environment variables
  if (provider === "azure") {
    const azureApiKey = envVars["AZURE_API_KEY"];
    const azureResourceName = envVars["AZURE_RESOURCE_NAME"];

    const isAzureConfigured = !!(azureApiKey && azureResourceName);

    return (
      <div className="space-y-4">
        <Alert variant={isAzureConfigured ? "default" : "destructive"}>
          <Info className="h-4 w-4" />
          <AlertTitle>Azure OpenAI Configuration</AlertTitle>
          <AlertDescription>
            Azure OpenAI requires both an API key and resource name to be
            configured via environment variables.
          </AlertDescription>
        </Alert>

        <Accordion
          type="multiple"
          className="w-full space-y-4"
          defaultValue={["azure-config"]}
        >
          <AccordionItem
            value="azure-config"
            className="border rounded-lg px-4 bg-(--background-lightest)"
          >
            <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
              Environment Variables Configuration
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">
                    Required Environment Variables:
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded border">
                      <code className="font-mono">AZURE_API_KEY</code>
                      <span
                        className={`px-2 py-1 rounded text-xs ${azureApiKey ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}
                      >
                        {azureApiKey ? "Set" : "Not Set"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded border">
                      <code className="font-mono">AZURE_RESOURCE_NAME</code>
                      <span
                        className={`px-2 py-1 rounded text-xs ${azureResourceName ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}
                      >
                        {azureResourceName ? "Set" : "Not Set"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                  <h5 className="font-medium mb-2 text-blue-900 dark:text-blue-100">
                    How to configure:
                  </h5>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200">
                    <li>Get your API key from the Azure portal</li>
                    <li>
                      Find your resource name (the name you gave your Azure
                      OpenAI resource)
                    </li>
                    <li>
                      Set these environment variables before starting Dyad
                    </li>
                    <li>
                      Restart Dyad after setting the environment variables
                    </li>
                  </ol>
                </div>

                {isAzureConfigured && (
                  <Alert>
                    <KeyRound className="h-4 w-4" />
                    <AlertTitle>Azure OpenAI Configured</AlertTitle>
                    <AlertDescription>
                      Both required environment variables are set. You can now
                      use Azure OpenAI models.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    );
  }

  const envApiKey = envVarName ? envVars[envVarName] : undefined;
  const userApiKey = settings?.providerSettings?.[provider]?.apiKey?.value;

  const isValidUserKey =
    !!userApiKey &&
    !userApiKey.startsWith("Invalid Key") &&
    userApiKey !== "Not Set";
  const hasEnvKey = !!envApiKey;

  const activeKeySource = isValidUserKey
    ? "settings"
    : hasEnvKey
      ? "env"
      : "none";

  const defaultAccordionValue = [];
  if (isValidUserKey || !hasEnvKey) {
    defaultAccordionValue.push("settings-key");
  }
  if (!isDyad && hasEnvKey) {
    defaultAccordionValue.push("env-key");
  }

  return (
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
                  onClick={onDeleteKey}
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
              {isValidUserKey ? "Update" : "Set"} {providerDisplayName} API Key
            </label>
            <div className="flex items-start space-x-2">
              <Input
                id="apiKeyInput"
                value={apiKeyInput}
                onChange={(e) => onApiKeyInputChange(e.target.value)}
                placeholder={`Enter new ${providerDisplayName} API Key here`}
                className={`flex-grow ${saveError ? "border-red-500" : ""}`}
              />
              <Button onClick={onSaveKey} disabled={isSaving || !apiKeyInput}>
                {isSaving ? "Saving..." : "Save Key"}
              </Button>
            </div>
            {saveError && <p className="text-xs text-red-600">{saveError}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Setting a key here will override the environment variable (if
              set).
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
                <AlertTitle>Environment Variable Key ({envVarName})</AlertTitle>
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
                      This key is currently being overridden by the key set in
                      Settings.
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
              This key is set outside the application. If present, it will be
              used only if no key is configured in the Settings section above.
              Requires app restart to detect changes.
            </p>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}
