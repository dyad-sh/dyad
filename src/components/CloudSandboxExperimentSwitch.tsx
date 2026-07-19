import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";

export function CloudSandboxExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = !!settings?.experiments?.enableCloudSandbox;
  const isCloudModeActive = settings?.runtimeMode2 === "cloud";

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-cloud-sandbox-experiment"
          aria-label={t("workflow.cloudSandbox")}
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              experiments: {
                ...settings?.experiments,
                enableCloudSandbox: checked,
              },
            });
          }}
        />
        <Label htmlFor="enable-cloud-sandbox-experiment">
          {t("workflow.cloudSandboxPro")}
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {t("workflow.cloudSandboxDescription")}
      </div>
      {!isEnabled && isCloudModeActive && (
        <div className="rounded bg-amber-50 p-2 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
          {t("workflow.cloudSandboxStillActive")}
        </div>
      )}
    </div>
  );
}
