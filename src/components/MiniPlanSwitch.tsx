import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export function MiniPlanSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const enabled = settings?.enableMiniPlan !== false;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="mini-plan"
        aria-label="Mini Plan"
        checked={enabled}
        onCheckedChange={() => {
          updateSettings({ enableMiniPlan: !enabled });
        }}
      />
      <Label htmlFor="mini-plan">{t("workflow.miniPlan")}</Label>
    </div>
  );
}
