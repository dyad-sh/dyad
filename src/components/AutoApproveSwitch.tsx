import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showInfo } from "@/lib/toast";
import { useTranslation } from "react-i18next";

export function AutoApproveSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-approve"
        aria-label="Auto-approve"
        checked={settings?.autoApproveChanges}
        onCheckedChange={() => {
          updateSettings({ autoApproveChanges: !settings?.autoApproveChanges });
          if (!settings?.autoApproveChanges && showToast) {
            showInfo("You can disable auto-approve in the Settings.");
          }
        }}
      />
      <Label htmlFor="auto-approve">{t("workflow.autoApprove")}</Label>
    </div>
  );
}
