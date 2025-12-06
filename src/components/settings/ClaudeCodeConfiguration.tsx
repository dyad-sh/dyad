import { useState, useEffect } from "react";
import { Info, KeyRound, Trash2, Clipboard, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserSettings, ClaudeCodeProviderSetting } from "@/lib/schemas";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { showError } from "@/lib/toast";

interface ClaudeCodeConfigurationProps {
  settings: UserSettings | null | undefined;
  envVars: Record<string, string | undefined>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<UserSettings>;
}

export function ClaudeCodeConfiguration({
  settings,
  envVars,
  updateSettings,
}: ClaudeCodeConfigurationProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [executablePathInput, setExecutablePathInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const claudeCodeSettings = settings?.providerSettings?.[
    "claude-code"
  ] as ClaudeCodeProviderSetting | undefined;

  const userApiKey = claudeCodeSettings?.apiKey?.value;
  const userExecutablePath = claudeCodeSettings?.claudeExecutablePath;

  const isValidUserKey =
    !!userApiKey &&
    !userApiKey.startsWith("Invalid Key") &&
    userApiKey !== "Not Set";

  const envApiKey = envVars["ANTHROPIC_API_KEY"];
  const envExecutablePath = envVars["CLAUDE_CODE_EXECUTABLE_PATH"];
  const hasEnvKey = !!envApiKey;
  const hasEnvPath = !!envExecutablePath;

  const activeKeySource = isValidUserKey ? "settings" : hasEnvKey ? "env" : "none";
  const activePathSource = userExecutablePath ? "settings" : hasEnvPath ? "env" : "default";

  // Default path for display
  const homeDir = "~";
  const defaultClaudePath = `${homeDir}/.local/bin/claude`;

  const handleSaveApiKey = async (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setSaveError("API Key cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          "claude-code": {
            ...claudeCodeSettings,
            apiKey: { value: trimmedValue },
          },
        },
      });
      setApiKeyInput("");
    } catch (error: any) {
      console.error("Error saving API key:", error);
      setSaveError(error.message || "Failed to save API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteApiKey = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          "claude-code": {
            ...claudeCodeSettings,
            apiKey: undefined,
          },
        },
      });
    } catch (error: any) {
      console.error("Error deleting API key:", error);
      setSaveError(error.message || "Failed to delete API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveExecutablePath = async (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setSaveError("Executable path cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          "claude-code": {
            ...claudeCodeSettings,
            claudeExecutablePath: trimmedValue,
          },
        },
      });
      setExecutablePathInput("");
    } catch (error: any) {
      console.error("Error saving executable path:", error);
      setSaveError(error.message || "Failed to save executable path.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExecutablePath = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          "claude-code": {
            ...claudeCodeSettings,
            claudeExecutablePath: undefined,
          },
        },
      });
    } catch (error: any) {
      console.error("Error deleting executable path:", error);
      setSaveError(error.message || "Failed to delete executable path.");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (saveError) {
      setSaveError(null);
    }
  }, [apiKeyInput, executablePathInput]);

  const defaultAccordionValue = [];
  if (isValidUserKey || !hasEnvKey) {
    defaultAccordionValue.push("settings-key");
  }
  if (hasEnvKey) {
    defaultAccordionValue.push("env-key");
  }
  if (userExecutablePath || !hasEnvPath) {
    defaultAccordionValue.push("executable-path");
  }
  if (hasEnvPath) {
    defaultAccordionValue.push("env-path");
  }

  return (
    <div className="space-y-4">
      <Alert variant="default" className="mb-4">
        <Info className="h-4 w-4" />
        <AlertTitle>Claude Code (Agent SDK) Configuration</AlertTitle>
        <AlertDescription>
          <p className="text-sm mb-2">
            Claude Code (Agent SDK) provides access to Claude models through the Agent SDK.
          </p>
          <ul className="text-xs space-y-1 list-disc list-inside">
            <li>
              <strong>Subscription Mode:</strong> If authenticated via `claude login`, API Key is optional
            </li>
            <li>
              <strong>API Key Mode:</strong> Setting an API Key will use it instead of subscription
            </li>
            <li>
              <strong>Executable Path:</strong> Customize Claude CLI location (default: {defaultClaudePath})
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      <Accordion
        type="multiple"
        className="w-full space-y-4"
        defaultValue={defaultAccordionValue}
      >
        {/* API Key from Settings */}
        <AccordionItem
          value="settings-key"
          className="border rounded-lg px-4 bg-(--background-lightest)"
        >
          <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
            API Key from Settings
          </AccordionTrigger>
          <AccordionContent className="pt-4">
            {isValidUserKey && (
              <Alert variant="default" className="mb-4">
                <KeyRound className="h-4 w-4" />
                <AlertTitle className="flex justify-between items-center">
                  <span>Current Key (Settings)</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteApiKey}
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
                {isValidUserKey ? "Update" : "Set"} API Key (Optional)
              </label>
              <div className="flex items-start space-x-2">
                <Input
                  id="apiKeyInput"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Enter Anthropic API Key"
                  className={`flex-grow ${saveError ? "border-red-500" : ""}`}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) {
                            handleSaveApiKey(text);
                          }
                        } catch (error) {
                          showError("Failed to paste from clipboard");
                          console.error("Failed to paste from clipboard", error);
                        }
                      }}
                      disabled={isSaving}
                      variant="outline"
                      size="icon"
                      title="Paste from clipboard and save"
                      aria-label="Paste from clipboard and save"
                    >
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Paste from clipboard and save</TooltipContent>
                </Tooltip>

                <Button
                  onClick={() => handleSaveApiKey(apiKeyInput)}
                  disabled={isSaving || !apiKeyInput}
                >
                  {isSaving ? "Saving..." : "Save Key"}
                </Button>
              </div>
              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Setting a key here will override subscription mode.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* API Key from Environment */}
        {hasEnvKey && (
          <AccordionItem
            value="env-key"
            className="border rounded-lg px-4 bg-(--background-lightest)"
          >
            <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
              API Key from Environment Variable
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <Alert variant="default">
                <KeyRound className="h-4 w-4" />
                <AlertTitle>Environment Variable Key (ANTHROPIC_API_KEY)</AlertTitle>
                <AlertDescription>
                  <p className="font-mono text-sm">
                    {envApiKey.substring(0, 4)}...{envApiKey.substring(envApiKey.length - 4)}
                  </p>
                  {activeKeySource === "env" && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      This key is currently active (no settings key set).
                    </p>
                  )}
                  {activeKeySource === "settings" && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      This key is currently being overridden by the key set in Settings.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                This key is set outside the application. If present, it will be used only if no key is configured in the Settings section above. Requires app restart to detect changes.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Executable Path from Settings */}
        <AccordionItem
          value="executable-path"
          className="border rounded-lg px-4 bg-(--background-lightest)"
        >
          <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
            Claude CLI Executable Path from Settings
          </AccordionTrigger>
          <AccordionContent className="pt-4">
            {userExecutablePath && (
              <Alert variant="default" className="mb-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle className="flex justify-between items-center">
                  <span>Current Path (Settings)</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteExecutablePath}
                    disabled={isSaving}
                    className="flex items-center gap-1 h-7 px-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    {isSaving ? "Deleting..." : "Delete"}
                  </Button>
                </AlertTitle>
                <AlertDescription>
                  <p className="font-mono text-sm">{userExecutablePath}</p>
                  {activePathSource === "settings" && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      This path is currently active.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <label
                htmlFor="executablePathInput"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {userExecutablePath ? "Update" : "Set"} Claude CLI Executable Path (Optional)
              </label>
              <div className="flex items-start space-x-2">
                <Input
                  id="executablePathInput"
                  value={executablePathInput}
                  onChange={(e) => setExecutablePathInput(e.target.value)}
                  placeholder={defaultClaudePath}
                  className={`flex-grow ${saveError ? "border-red-500" : ""}`}
                />
                <Button
                  onClick={() => handleSaveExecutablePath(executablePathInput)}
                  disabled={isSaving || !executablePathInput}
                >
                  {isSaving ? "Saving..." : "Save Path"}
                </Button>
              </div>
              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Default: {defaultClaudePath}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Executable Path from Environment */}
        {hasEnvPath && (
          <AccordionItem
            value="env-path"
            className="border rounded-lg px-4 bg-(--background-lightest)"
          >
            <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
              Claude CLI Executable Path from Environment Variable
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <Alert variant="default">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Environment Variable Path (CLAUDE_CODE_EXECUTABLE_PATH)</AlertTitle>
                <AlertDescription>
                  <p className="font-mono text-sm">{envExecutablePath}</p>
                  {activePathSource === "env" && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      This path is currently active (no settings path set).
                    </p>
                  )}
                  {activePathSource === "settings" && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      This path is currently being overridden by the path set in Settings.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                This path is set outside the application. If present, it will be used only if no path is configured in the Settings section above. Requires app restart to detect changes.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
