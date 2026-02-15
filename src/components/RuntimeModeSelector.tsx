import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [isRemovingToken, setIsRemovingToken] = useState(false);

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";
  const isCloudMode = settings?.runtimeMode2 === "cloud";
  const hasUserVercelToken = !!settings?.userVercelSandboxToken?.value;

  const handleRuntimeModeChange = async (
    value: "host" | "docker" | "cloud",
  ) => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  const handleSaveVercelToken = async () => {
    if (!tokenInput.trim()) {
      showError(t("general.cloudSandbox.tokenRequired"));
      return;
    }

    setIsSavingToken(true);
    try {
      // Validate the token first using the existing Vercel validation
      await ipc.vercel.saveToken({ token: tokenInput.trim() });

      // If validation passes, save it as the user's sandbox token
      await updateSettings({
        userVercelSandboxToken: { value: tokenInput.trim() },
      });

      // Clear the existing vercelAccessToken if we just validated it
      // (we don't want to use the same token for both purposes)
      // Actually, let's keep them separate - the vercelAccessToken is for deployments

      setTokenInput("");
      showSuccess(t("general.cloudSandbox.tokenSaved"));
    } catch (error: any) {
      showError(error.message || t("general.cloudSandbox.tokenInvalid"));
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleRemoveVercelToken = async () => {
    setIsRemovingToken(true);
    try {
      await updateSettings({
        userVercelSandboxToken: undefined,
      });
      showSuccess(t("general.cloudSandbox.tokenRemoved"));
    } catch (error: any) {
      showError(error.message || t("general.cloudSandbox.tokenRemoveFailed"));
    } finally {
      setIsRemovingToken(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center space-x-2">
          <Label className="text-sm font-medium" htmlFor="runtime-mode">
            {t("general.runtimeMode")}
          </Label>
          <Select
            value={settings.runtimeMode2 ?? "host"}
            onValueChange={(v) =>
              v && handleRuntimeModeChange(v as "host" | "docker" | "cloud")
            }
          >
            <SelectTrigger className="w-48" id="runtime-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Local (default)</SelectItem>
              <SelectItem value="docker">Docker (experimental)</SelectItem>
              <SelectItem value="cloud">Cloud Sandbox</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("general.runtimeModeDescription")}
        </div>
      </div>
      {isDockerMode && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          {t("general.dockerWarning")}{" "}
          <button
            type="button"
            className="underline font-medium cursor-pointer"
            onClick={() =>
              ipc.system.openExternalUrl(
                "https://www.docker.com/products/docker-desktop/",
              )
            }
          >
            Docker Desktop
          </button>{" "}
          {t("general.dockerWarningEnd")}
        </div>
      )}
      {isCloudMode && (
        <div className="space-y-3 mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="text-sm text-blue-700 dark:text-blue-300">
            {t("general.cloudSandbox.description")}
          </div>

          {hasUserVercelToken ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-sm text-green-700 dark:text-green-400">
                  {t("general.cloudSandbox.tokenConnected")}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveVercelToken}
                disabled={isRemovingToken}
              >
                {isRemovingToken ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("general.cloudSandbox.removeToken")
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label
                htmlFor="vercel-sandbox-token"
                className="text-sm font-medium text-blue-800 dark:text-blue-200"
              >
                {t("general.cloudSandbox.tokenLabel")}
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="vercel-sandbox-token"
                    type={showToken ? "text" : "password"}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={t("general.cloudSandbox.tokenPlaceholder")}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {showToken ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={handleSaveVercelToken}
                  disabled={isSavingToken || !tokenInput.trim()}
                >
                  {isSavingToken ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("general.cloudSandbox.saveToken")
                  )}
                </Button>
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400">
                {t("general.cloudSandbox.tokenHelp")}{" "}
                <button
                  type="button"
                  className="underline cursor-pointer hover:text-blue-800 dark:hover:text-blue-200"
                  onClick={() =>
                    ipc.system.openExternalUrl(
                      "https://vercel.com/account/tokens",
                    )
                  }
                >
                  {t("general.cloudSandbox.getToken")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
