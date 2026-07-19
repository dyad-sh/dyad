import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function KeepPreviewsRunningSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = settings?.previewIdleTimeoutPolicy === "never";

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="keep-previews-running"
        aria-label={t("workflow.keepPreviewsRunning")}
        checked={isEnabled}
        onCheckedChange={(checked) => {
          updateSettings({
            previewIdleTimeoutPolicy: checked ? "never" : "default",
          });
        }}
      />
      <Label htmlFor="keep-previews-running">
        {t("workflow.keepPreviewsRunning")}
      </Label>
    </div>
  );
}
