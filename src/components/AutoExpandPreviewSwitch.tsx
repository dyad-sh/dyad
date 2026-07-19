import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function AutoExpandPreviewSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = settings?.autoExpandPreviewPanel;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-expand-preview"
        aria-label={t("workflow.autoExpandPreview")}
        checked={isEnabled}
        onCheckedChange={(checked) => {
          updateSettings({
            autoExpandPreviewPanel: checked,
          });
        }}
      />
      <Label htmlFor="auto-expand-preview">
        {t("workflow.autoExpandPreview")}
      </Label>
    </div>
  );
}
