import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { showError } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { useAtomValue } from "jotai";
import { appUrlAtom } from "@/atoms/appAtoms";
import { useTranslation } from "react-i18next";
import type { RuntimeMode2 } from "@/lib/schemas";
import { useState } from "react";
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

export function shouldShowCloudSandboxOption({
  runtimeMode,
  cloudSandboxExperimentEnabled,
}: {
  runtimeMode: RuntimeMode2;
  cloudSandboxExperimentEnabled: boolean;
}) {
  return cloudSandboxExperimentEnabled || runtimeMode === "cloud";
}

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation(["settings", "common"]);
  const { userBudget } = useUserBudgetInfo();
  const currentAppUrl = useAtomValue(appUrlAtom);
  const [pendingRuntimeMode, setPendingRuntimeMode] =
    useState<RuntimeMode2 | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";
  const isCloudMode = settings?.runtimeMode2 === "cloud";
  const hasCloudSandboxAccess = Boolean(userBudget);
  const showCloudSandboxOption = shouldShowCloudSandboxOption({
    runtimeMode: settings.runtimeMode2 ?? "host",
    cloudSandboxExperimentEnabled: !!settings.experiments?.enableCloudSandbox,
  });

  const applyRuntimeModeChange = async (value: RuntimeMode2) => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  const handleRuntimeModeChange = (value: RuntimeMode2) => {
    if (
      value === "cloud" &&
      (!hasCloudSandboxAccess || !showCloudSandboxOption)
    ) {
      return;
    }

    if (currentAppUrl.appUrl && value !== (settings.runtimeMode2 ?? "host")) {
      setPendingRuntimeMode(value);
      setIsConfirmDialogOpen(true);
      return;
    }

    void applyRuntimeModeChange(value);
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
            onValueChange={(v) => v && handleRuntimeModeChange(v)}
          >
            <SelectTrigger className="w-48" id="runtime-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Local (default)</SelectItem>
              <SelectItem value="docker">Docker (experimental)</SelectItem>
              {showCloudSandboxOption && (
                <SelectItem disabled={!hasCloudSandboxAccess} value="cloud">
                  Cloud Sandbox (Pro)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("general.runtimeModeDescription")}
        </div>
      </div>
      {showCloudSandboxOption && !hasCloudSandboxAccess && (
        <div className="text-sm text-muted-foreground bg-muted/40 p-2 rounded">
          Cloud sandboxes are a Dyad Pro feature.{" "}
          <button
            type="button"
            className="underline font-medium cursor-pointer text-primary"
            onClick={() => ipc.system.openExternalUrl("https://dyad.sh/pro#ai")}
          >
            Upgrade to Pro
          </button>
        </div>
      )}
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
      {isCloudMode && hasCloudSandboxAccess && (
        <div className="text-sm text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 p-2 rounded">
          Cloud Sandbox runs previews remotely and gives you a shareable preview
          link. Note: running in cloud mode consumes Pro credits.
        </div>
      )}
      <AlertDialog
        open={isConfirmDialogOpen}
        onOpenChange={(open) => {
          setIsConfirmDialogOpen(open);
          if (!open) {
            setPendingRuntimeMode(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("general.runtimeModeSwitchTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("general.runtimeModeSwitchDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRuntimeMode) {
                  return;
                }
                void applyRuntimeModeChange(pendingRuntimeMode);
              }}
            >
              {t("general.runtimeModeSwitchAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
