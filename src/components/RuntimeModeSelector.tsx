import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();

  const isDockerMode = settings?.runtimeMode2 === "docker";

  const handleToggle = async (checked: boolean) => {
    try {
      await updateSettings({
        runtimeMode2: checked ? "docker" : "host",
      });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Runtime Mode</Label>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Choose whether to run apps on the host machine or in Docker
            containers
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`text-sm ${!isDockerMode ? "font-medium" : "text-gray-500"}`}
          >
            Host
          </span>
          <Switch checked={isDockerMode} onCheckedChange={handleToggle} />
          <span
            className={`text-sm ${isDockerMode ? "font-medium" : "text-gray-500"}`}
          >
            Docker
          </span>
        </div>
      </div>
      {isDockerMode && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          ⚠️ Docker mode requires Docker Desktop to be installed and running
        </div>
      )}
    </div>
  );
}
