import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";
import { FolderOpen, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";

export function NodePathSelector() {
  const { settings, updateSettings } = useSettings();
  const [isSelectingPath, setIsSelectingPath] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<{
    version: string | null;
    isValid: boolean;
  }>({
    version: null,
    isValid: false,
  });
  const [isCheckingNode, setIsCheckingNode] = useState(false);
  const [systemPath, setSystemPath] = useState<string>("Loading...");

  // Check Node.js status when component mounts or path changes
  useEffect(() => {
    checkNodeStatus();
  }, [settings?.customNodePath]);

  const fetchSystemPath = async () => {
    try {
      const debugInfo = await IpcClient.getInstance().getSystemDebugInfo();
      setSystemPath(debugInfo.nodePath || "System PATH (not available)");
    } catch (err) {
      console.error("Failed to fetch system path:", err);
      setSystemPath("System PATH (not available)");
    }
  };

  useEffect(() => {
    // Fetch system path on mount
    fetchSystemPath();
  }, []);

  const checkNodeStatus = async () => {
    if (!settings) return;
    setIsCheckingNode(true);
    try {
      const status = await IpcClient.getInstance().getNodejsStatus();
      setNodeStatus({
        version: status.nodeVersion,
        isValid: !!status.nodeVersion,
      });
    } catch (error) {
      console.error("Failed to check Node.js status:", error);
      setNodeStatus({ version: null, isValid: false });
    } finally {
      setIsCheckingNode(false);
    }
  };
  const handleSelectNodePath = async () => {
    setIsSelectingPath(true);
    try {
      // Call the IPC method to select folder
      const result = await IpcClient.getInstance().selectNodeFolder();
      if (result.path) {
        // Save the custom path to settings
        await updateSettings({ customNodePath: result.path });
        // Update the environment PATH
        await IpcClient.getInstance().reloadEnvPath();
        // Recheck Node.js status
        await checkNodeStatus();
        showSuccess("Node.js path updated successfully");
      } else if (result.path === null && result.canceled === false) {
        showError(
          `Could not find Node.js at the path "${result.selectedPath}"`,
        );
      }
    } catch (error: any) {
      showError(`Failed to set Node.js path: ${error.message}`);
    } finally {
      setIsSelectingPath(false);
    }
  };
  const handleResetToDefault = async () => {
    try {
      // Clear the custom path
      await updateSettings({ customNodePath: null });
      // Reload environment to use system PATH
      await IpcClient.getInstance().reloadEnvPath();
      // Recheck Node.js status
      await fetchSystemPath();
      await checkNodeStatus();
      showSuccess("Reset to system Node.js path");
    } catch (error: any) {
      showError(`Failed to reset Node.js path: ${error.message}`);
    }
  };

  if (!settings) {
    return null;
  }
  const currentPath = settings.customNodePath || systemPath;
  const isCustomPath = !!settings.customNodePath;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Label className="text-sm font-medium">
            Node.js Path Configuration
          </Label>

          <Button
            onClick={handleSelectNodePath}
            disabled={isSelectingPath}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            {isSelectingPath ? "Selecting..." : "Browse for Node.js"}
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
                  {isCustomPath ? "Custom Path:" : "System PATH:"}
                </span>
                {isCustomPath && (
                  <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                    Custom
                  </span>
                )}
              </div>
              <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all max-h-32 overflow-y-auto">
                {currentPath}
              </p>
            </div>

            {/* Status Indicator */}
            <div className="ml-3 flex items-center">
              {isCheckingNode ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500" />
              ) : nodeStatus.isValid ? (
                <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-xs">{nodeStatus.version}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs">Not found</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {nodeStatus.isValid ? (
            <p>Node.js is properly configured and ready to use.</p>
          ) : (
            <>
              <p>
                Select the folder where Node.js is installed if it's not in your
                system PATH.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
