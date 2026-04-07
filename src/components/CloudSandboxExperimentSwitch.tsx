import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function CloudSandboxExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = !!settings?.experiments?.enableCloudSandbox;

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-cloud-sandbox-experiment"
          aria-label="Enable Cloud Sandbox"
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              experiments: {
                ...settings?.experiments,
                enableCloudSandbox: checked,
              },
            });
          }}
        />
        <Label htmlFor="enable-cloud-sandbox-experiment">
          Enable Cloud Sandbox (Pro)
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Run your app on the Cloud (more secure and uses less local system
        resources. Note: using Cloud resources consumes Pro credits)
      </div>
    </div>
  );
}
