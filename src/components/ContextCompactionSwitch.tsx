import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function ContextCompactionSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="context-compaction"
        aria-label={t("ai.contextCompaction")}
        checked={settings?.enableContextCompaction !== false}
        onCheckedChange={(checked) => {
          updateSettings({ enableContextCompaction: checked });
        }}
      />
      <Label htmlFor="context-compaction">{t("ai.contextCompaction")}</Label>
    </div>
  );
}
