import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

import { showInfo } from "@/lib/toast";

export function AutoFixProblemsSwitch({
  showToast = false,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-fix-problems"
        aria-label={t("workflow.autoFixProblems")}
        checked={settings?.enableAutoFixProblems}
        onCheckedChange={() => {
          updateSettings({
            enableAutoFixProblems: !settings?.enableAutoFixProblems,
          });
          if (!settings?.enableAutoFixProblems && showToast) {
            showInfo(t("workflow.autoFixProblemsDisabledHint"));
          }
        }}
      />
      <Label htmlFor="auto-fix-problems">{t("workflow.autoFixProblems")}</Label>
    </div>
  );
}
