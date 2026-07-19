import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";

export function AutoApproveMcpSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = !!settings?.autoApproveSafeMcpTools;

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-auto-approve-safe-mcp-tools"
          aria-label={t("workflow.autoApproveSafeMcpTools")}
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              autoApproveSafeMcpTools: checked,
            });
          }}
        />
        <Label htmlFor="enable-auto-approve-safe-mcp-tools">
          {t("workflow.autoApproveSafeMcpToolsPro")}
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {t("workflow.autoApproveSafeMcpToolsDescription")}
      </div>
    </div>
  );
}
