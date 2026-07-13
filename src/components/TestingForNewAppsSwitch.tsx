import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TestingForNewAppsSwitch() {
  const { settings, updateSettings } = useSettings();
  const enabled = settings?.enableTestingForNewApps ?? false;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-testing-for-new-apps"
        aria-label="Enable Testing for New Apps"
        checked={enabled}
        onCheckedChange={(checked) => {
          updateSettings({ enableTestingForNewApps: checked });
        }}
      />
      <Label htmlFor="enable-testing-for-new-apps">
        Enable Testing for New Apps
      </Label>
    </div>
  );
}
