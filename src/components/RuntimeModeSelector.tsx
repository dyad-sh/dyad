import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useCurrentAppUrl } from "@/hooks/useAppRun";
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

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation(["settings", "common"]);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const currentAppUrl = useCurrentAppUrl(selectedAppId);
  const [pendingRuntimeMode, setPendingRuntimeMode] =
    useState<RuntimeMode2 | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";

  const applyRuntimeModeChange = async (value: RuntimeMode2) => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  const handleRuntimeModeChange = (value: RuntimeMode2) => {
    if (currentAppUrl.appUrl && value !== (settings.runtimeMode2 ?? "host")) {
      setPendingRuntimeMode(value);
      setIsConfirmDialogOpen(true);
      return;
    }

    void applyRuntimeModeChange(value);
  };

  return (
    <div className="space-y-3">
      <SettingField
        htmlFor="runtime-mode"
        label={t("general.runtimeMode")}
        description={t("general.runtimeModeDescription")}
      >
        <Select
          value={settings.runtimeMode2 ?? "host"}
          onValueChange={(v) => v && handleRuntimeModeChange(v)}
        >
          <SelectTrigger
            className="w-full sm:w-[240px]"
            id="runtime-mode"
            aria-describedby="runtime-mode-description"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="host">Local (default)</SelectItem>
            <SelectItem value="docker">Docker (experimental)</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
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
