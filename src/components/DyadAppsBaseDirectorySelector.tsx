import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { FolderOpen, RotateCcw } from "lucide-react";

export function DyadAppsBaseDirectorySelector() {
  const [isSelectingPath, setIsSelectingPath] = useState(false);
  const [dyadAppsBasePath, setDyadAppsBasePath] =
    useState<string>("Loading...");
  const [isCustomPath, setIsCustomPath] = useState(true);

  useEffect(() => {
    // Fetch path on mount
    fetchDyadAppsBaseDirectory();
  }, []);

  const handleSelectDyadAppsBaseDirectory = async () => {
    setIsSelectingPath(true);
    try {
      // Call the IPC method to select folder
      const result = await ipc.system.selectDyadAppsBaseDirectory();
      if (result.path) {
        // Save the custom path to settings
        await ipc.system.setDyadAppsBaseDirectory(result.path);
        await fetchDyadAppsBaseDirectory();
        showSuccess("Dyad apps folder updated successfully");
      } else if (result.path === null && result.canceled === false) {
        showError(`Could not find folder`);
      }
    } catch (error: any) {
      showError(`Failed to set Dyad apps folder: ${error.message}`);
    } finally {
      setIsSelectingPath(false);
    }
  };

  const handleResetToDefault = async () => {
    try {
      // Clear the custom path
      await ipc.system.setDyadAppsBaseDirectory(null);
      // Update UI to show default directory
      await fetchDyadAppsBaseDirectory();
      showSuccess("Dyad apps folder reset successfully");
    } catch (error: any) {
      showError(`Failed to reset Dyad Apps folder path: ${error.message}`);
    }
  };

  const fetchDyadAppsBaseDirectory = async () => {
    try {
      const { path, isCustomPath } =
        await ipc.system.getDyadAppsBaseDirectory();
      setDyadAppsBasePath(path);
      setIsCustomPath(isCustomPath);
    } catch (error: any) {
      showError(`Failed to fetch Dyad apps folder path: ${error.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Label className="text-sm font-medium">
            Folder to Store Dyad Apps
          </Label>

          <Button
            onClick={handleSelectDyadAppsBaseDirectory}
            disabled={isSelectingPath}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            {isSelectingPath ? "Selecting..." : "Select A Folder"}
          </Button>

          {isCustomPath && (
            <Button
              onClick={handleResetToDefault}
              variant="ghost"
              size="sm"
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Default
            </Button>
          )}
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {isCustomPath ? "Custom Folder:" : "Default Folder:"}
                </span>
              </div>
              <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all max-h-32 overflow-y-auto">
                {dyadAppsBasePath}
              </p>
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <p>
            This is the top-level folder that Dyad will store new applications
            in.
          </p>
        </div>
      </div>
    </div>
  );
}
