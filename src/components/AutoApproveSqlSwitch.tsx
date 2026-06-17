import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function AutoApproveSqlSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = !!settings?.autoApproveNonSchemaSql;

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-auto-approve-non-schema-sql"
          aria-label="Auto-approve non-schema SQL"
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              autoApproveNonSchemaSql: checked,
            });
          }}
        />
        <Label htmlFor="enable-auto-approve-non-schema-sql">
          Auto-approve non-schema SQL
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        In Agent mode, skip the consent prompt when running SQL that does not
        change the database schema. Schema changes still require approval.
      </div>
    </div>
  );
}
