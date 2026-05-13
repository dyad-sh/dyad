import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function CloudSandboxExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = !!settings?.experiments?.enableCloudSandbox;
  const isCloudModeActive = settings?.runtimeMode2 === "cloud";

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
      {!isEnabled && isCloudModeActive && (
        <div className="rounded bg-amber-50 p-2 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
          Cloud Sandbox is still active for the current app. Switch the runtime
          mode back to Local to fully turn it off.
        </div>
      )}
    </div>
  );
}
