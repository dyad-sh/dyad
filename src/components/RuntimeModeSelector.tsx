import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";

  const handleRuntimeModeChange = async (value: "host" | "docker") => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center space-x-2">
          <Label className="text-sm font-medium" htmlFor="runtime-mode">
            Runtime Mode
          </Label>
          <Select
            value={settings.runtimeMode2 ?? "host"}
            onValueChange={handleRuntimeModeChange}
          >
            <SelectTrigger className="w-48" id="runtime-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Local (default)</SelectItem>
              <SelectItem value="docker">Docker (experimental)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Choose whether to run apps directly on the local machine or in Docker
          containers
        </div>
      </div>
      {isDockerMode && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          ⚠️ Docker mode is <b>experimental</b> and requires{" "}
          <button
            type="button"
            className="underline font-medium cursor-pointer"
            onClick={() =>
              IpcClient.getInstance().openExternalUrl(
                "https://www.docker.com/products/docker-desktop/",
              )
            }
          >
            Docker Desktop
          </button>{" "}
          to be installed and running
        </div>
      )}
    </div>
  );
}
