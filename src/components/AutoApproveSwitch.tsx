import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showInfo } from "@/lib/toast";

export function AutoApproveSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-approve"
        checked={settings?.autoApproveChanges}
        onCheckedChange={() => {
          updateSettings({ autoApproveChanges: !settings?.autoApproveChanges });
          if (!settings?.autoApproveChanges && showToast) {
            showInfo("You can disable auto-approve in the Settings.");
          }
        }}
      />
      <Label htmlFor="auto-approve">Auto-approve</Label>
    </div>
  );
}
