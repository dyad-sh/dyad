import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { FolderOpen, RotateCcw } from "lucide-react";

export function CustomAppsFolderSelector() {
  const [isSelectingPath, setIsSelectingPath] = useState(false);
  const [customAppsFolder, setCustomAppsFolder] =
    useState<string>("Loading...");
  const [isPathAvailable, setIsPathAvailable] = useState(true);
  const [isPathDefault, setIsPathDefault] = useState(true);

  useEffect(() => {
    // Fetch path on mount
    fetchCustomAppsFolder();
  }, []);

  const handleSelectCustomAppsFolder = async () => {
    setIsSelectingPath(true);
    try {
      // Call the IPC method to select folder
      const result = await ipc.system.selectCustomAppsFolder();
      if (result.path) {
        // Save the custom path to settings
        await ipc.system.setCustomAppsFolder(result.path);
        await fetchCustomAppsFolder();
        showSuccess("Custom apps folder updated successfully");
      } else if (result.path === null && result.canceled === false) {
        showError(
          "Unable to use selected folder. Please ensure it is a valid directory with write permissions.",
        );
      }
    } catch (error: any) {
      showError(`Failed to set custom apps folder: ${error.message}`);
    } finally {
      setIsSelectingPath(false);
    }
  };

  const handleResetToDefault = async () => {
    try {
      // Clear the custom path
      await ipc.system.setCustomAppsFolder(null);
      // Update UI to show default directory
      await fetchCustomAppsFolder();
      showSuccess("Dyad apps folder reset successfully");
    } catch (error: any) {
      showError(`Failed to reset Dyad Apps folder path: ${error.message}`);
    }
  };

  const fetchCustomAppsFolder = async () => {
    try {
      const { path, isPathAvailable, isPathDefault } =
        await ipc.system.getCustomAppsFolder();
      setCustomAppsFolder(path);
      setIsPathAvailable(isPathAvailable);
      setIsPathDefault(isPathDefault);
    } catch (error: any) {
      showError(`Failed to fetch Dyad apps folder path: ${error.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Label className="text-sm font-medium">Customize Apps Folder</Label>

          <Button
            onClick={handleSelectCustomAppsFolder}
            disabled={isSelectingPath}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            data-testid="customize-apps-folder-button"
          >
            <FolderOpen className="w-4 h-4" />
            {isSelectingPath ? "Selecting..." : "Select A Folder"}
          </Button>

          {!isPathDefault && (
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
                  {isPathDefault ? "Default Folder:" : "Custom Folder:"}
                </span>
              </div>
              <p
                className={`text-sm font-mono ${isPathAvailable ? "text-gray-700 dark:text-gray-300" : "text-red-800 dark:text-red-400"} break-all max-h-32 overflow-y-auto`}
              >
                {customAppsFolder}
              </p>
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <p>
            {isPathAvailable
              ? "This is the top-level folder that Dyad will store new applications in."
              : "Your apps folder is inaccessible. Make sure that the folder exists and has write permissions, or change it."}
          </p>
        </div>
      </div>
    </div>
  );
}
