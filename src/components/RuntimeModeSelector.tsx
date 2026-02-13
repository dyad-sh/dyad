import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { useTranslation } from "react-i18next";
import { hasDyadProKey, type RuntimeMode2 } from "@/lib/schemas";
import { Cloud, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { appUrlAtom } from "@/atoms/appAtoms";

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const [pendingMode, setPendingMode] = useState<RuntimeMode2 | null>(null);
  const { appUrl } = useAtomValue(appUrlAtom);
  const isAppRunning = appUrl !== null;

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";
  const isCloudMode = settings?.runtimeMode2 === "cloud";
  const isPro = hasDyadProKey(settings);
  const currentMode = settings.runtimeMode2 ?? "host";

  const getModeDisplayName = (mode: RuntimeMode2): string => {
    switch (mode) {
      case "cloud":
        return "Cloud Sandbox";
      case "docker":
        return "Docker";
      case "host":
      default:
        return "Local";
    }
  };

  const handleRuntimeModeChange = async (value: RuntimeMode2) => {
    // Block non-Pro users from selecting cloud mode
    if (value === "cloud" && !isPro) {
      return;
    }

    // If app is running and mode is changing, show confirmation dialog
    if (isAppRunning && value !== currentMode) {
      setPendingMode(value);
      return;
    }

    await applyModeChange(value);
  };

  const applyModeChange = async (value: RuntimeMode2) => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  const handleConfirmModeChange = async () => {
    if (pendingMode) {
      await applyModeChange(pendingMode);
      setPendingMode(null);
    }
  };

  const handleCancelModeChange = () => {
    setPendingMode(null);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center space-x-2">
          <Label className="text-sm font-medium" htmlFor="runtime-mode">
            {t("general.runtimeMode")}
          </Label>
          <Select
            value={currentMode}
            onValueChange={(v) =>
              v && handleRuntimeModeChange(v as RuntimeMode2)
            }
          >
            <SelectTrigger className="w-56" id="runtime-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Local (default)</SelectItem>
              <SelectItem value="docker">Docker (experimental)</SelectItem>
              <SelectItem value="cloud" disabled={!isPro}>
                <span className="flex items-center gap-1.5">
                  <Cloud size={14} className="text-blue-500" />
                  Cloud Sandbox
                  {isPro ? (
                    <span className="text-xs text-blue-500 font-medium">
                      (Pro)
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">(Pro)</span>
                  )}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("general.runtimeModeDescription")}
        </div>
      </div>
      {isDockerMode && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          ⚠️ Docker mode is <b>experimental</b> and requires{" "}
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
          to be installed and running
        </div>
      )}
      {isCloudMode && isPro && (
        <div className="text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
          <Cloud size={14} className="inline mr-1" />
          Cloud sandbox mode runs your app in the cloud. No local toolchain
          required.
          <br />
          <span className="text-xs text-blue-500 dark:text-blue-300 mt-1 block">
            Preview URLs are shareable with others.
          </span>
        </div>
      )}
      {!isPro && settings.runtimeMode2 !== "cloud" && (
        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-2 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span>
              <Cloud size={14} className="inline mr-1 text-blue-500" />
              Cloud Sandbox mode requires Dyad Pro
            </span>
            <button
              type="button"
              className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-0.5 cursor-pointer"
              onClick={() =>
                ipc.system.openExternalUrl(
                  "https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=cloud-sandbox-upgrade",
                )
              }
            >
              Upgrade to Pro
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Mode Change Confirmation Dialog */}
      <AlertDialog open={pendingMode !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Runtime Mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Your app is currently running in {getModeDisplayName(currentMode)}{" "}
              mode. Switching to{" "}
              {pendingMode && getModeDisplayName(pendingMode)} mode will require
              restarting the app.
              {pendingMode === "cloud" && (
                <span className="block mt-2 text-blue-600 dark:text-blue-400">
                  <Cloud size={14} className="inline mr-1" />
                  Cloud sandbox mode allows you to share your app preview with
                  others.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelModeChange}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmModeChange}>
              Switch Mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
