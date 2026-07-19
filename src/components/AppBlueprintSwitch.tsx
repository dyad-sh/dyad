import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function AppBlueprintSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const enabled = settings?.enableAppBlueprint ?? true;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="app-blueprint"
        aria-label={t("workflow.appBlueprint")}
        checked={enabled}
        onCheckedChange={() => {
          updateSettings({ enableAppBlueprint: !enabled });
        }}
      />
      <Label htmlFor="app-blueprint">{t("workflow.appBlueprint")}</Label>
    </div>
  );
}
