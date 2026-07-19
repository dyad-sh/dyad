import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";

export function AutoApproveSqlSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = !!settings?.autoApproveNonSchemaSql;

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-auto-approve-non-schema-sql"
          aria-label={t("workflow.autoApproveNonSchemaSql")}
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              autoApproveNonSchemaSql: checked,
            });
          }}
        />
        <Label htmlFor="enable-auto-approve-non-schema-sql">
          {t("workflow.autoApproveNonSchemaSql")}
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {t("workflow.autoApproveNonSchemaSqlDescription")}
      </div>
    </div>
  );
}
