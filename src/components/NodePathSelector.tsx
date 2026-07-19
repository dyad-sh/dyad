import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Download,
  Trash2,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedNodeInstallProgress, NodeSystemInfo } from "@/ipc/types";

export function NodePathSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [isSelectingPath, setIsSelectingPath] = useState(false);
  const [isInstallingManagedNode, setIsInstallingManagedNode] = useState(false);
  const [isRemovingManagedNode, setIsRemovingManagedNode] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState<
    ManagedNodeInstallProgress["phase"] | null
  >(null);
  const [nodeStatus, setNodeStatus] = useState<{
    version: string | null;
    isValid: boolean;
    info: NodeSystemInfo | null;
  }>({
    version: null,
    isValid: false,
    info: null,
  });
  const [isCheckingNode, setIsCheckingNode] = useState(false);
  const [systemPath, setSystemPath] = useState<string>(() =>
    t("general.loading"),
  );

  // Check Node.js status when settings load or path changes.
  useEffect(() => {
    checkNodeStatus();
  }, [Boolean(settings), settings?.customNodePath]);

  const fetchSystemPath = async () => {
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      setSystemPath(debugInfo.nodePath || t("general.systemPathUnavailable"));
    } catch (err) {
      console.error("Failed to fetch system path:", err);
      setSystemPath(t("general.systemPathUnavailable"));
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
      const status = await ipc.system.getNodejsStatus();
      setNodeStatus({
        version: status.nodeVersion,
        isValid: !!status.nodeVersion,
        info: status,
      });
    } catch (error) {
      console.error("Failed to check Node.js status:", error);
      setNodeStatus({ version: null, isValid: false, info: null });
    } finally {
      setIsCheckingNode(false);
    }
  };

  useEffect(() => {
    return ipc.events.system.onManagedNodeInstallProgress((progress) => {
      setInstallProgress(progress.percent);
      setInstallPhase(progress.phase);
    });
  }, []);

  const handleSelectNodePath = async () => {
    setIsSelectingPath(true);
    try {
      // Call the IPC method to select folder
      const result = await ipc.system.selectNodeFolder();
      if (result.path) {
        // Save the custom path to settings
        await updateSettings({ customNodePath: result.path });
        // Update the environment PATH
        await ipc.system.reloadEnvPath();
        // Recheck Node.js status
        await checkNodeStatus();
        showSuccess(t("general.nodePathUpdated"));
      } else if (result.path === null && result.canceled === false) {
        showError(t("general.nodePathNotFound", { path: result.selectedPath }));
      }
    } catch (error: any) {
      showError(t("general.nodePathUpdateFailed", { message: error.message }));
    } finally {
      setIsSelectingPath(false);
    }
  };
  const handleResetToDefault = async () => {
    try {
      // Clear the custom path
      await updateSettings({ customNodePath: null });
      // Reload environment to use system PATH
      await ipc.system.reloadEnvPath();
      // Recheck Node.js status
      await fetchSystemPath();
      await checkNodeStatus();
      showSuccess(t("general.resetToSystemNodePath"));
    } catch (error: any) {
      showError(t("general.resetNodePathFailed", { message: error.message }));
    }
  };

  const refreshNodeStatus = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.system.nodejsStatus,
    });
    await fetchSystemPath();
    await checkNodeStatus();
  };

  const handlePreferenceChange = async (
    nodeRuntimePreference: "system" | "managed",
  ) => {
    if (
      nodeRuntimePreference === "managed" &&
      nodeStatus.info?.managedNodeSupported !== true
    ) {
      return;
    }
    try {
      await updateSettings({ nodeRuntimePreference });
      await ipc.system.reloadEnvPath();
      await refreshNodeStatus();
    } catch (error: any) {
      showError(
        t("general.runtimePreferenceUpdateFailed", {
          message: error.message,
        }),
      );
    }
  };

  const handleInstallManagedNode = async () => {
    setIsInstallingManagedNode(true);
    setInstallProgress(0);
    setInstallPhase(null);
    try {
      await ipc.system.installManagedNode();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.user,
      });
      await refreshNodeStatus();
      showSuccess(t("general.managedNodeInstalled"));
    } catch (error: any) {
      showError(error.message ?? t("general.managedNodeInstallFailed"));
    } finally {
      setIsInstallingManagedNode(false);
    }
  };

  const handleRemoveManagedNode = async () => {
    setIsRemovingManagedNode(true);
    try {
      await ipc.system.removeManagedNode();
      await updateSettings({ nodeRuntimePreference: "system" });
      await refreshNodeStatus();
      showSuccess(t("general.managedNodeRemoved"));
    } catch (error: any) {
      showError(error.message ?? t("general.managedNodeRemoveFailed"));
    } finally {
      setIsRemovingManagedNode(false);
    }
  };

  if (!settings) {
    return null;
  }
  const currentPath = settings.customNodePath || systemPath;
  const isCustomPath = !!settings.customNodePath;
  const runtimePreference = settings.nodeRuntimePreference ?? "system";
  const activeRuntime = nodeStatus.info?.source;
  const managedInstalled = !!nodeStatus.info?.managedNodeInstalled;
  const managedSupported = nodeStatus.info?.managedNodeSupported ?? false;
  const systemTooOld = !!nodeStatus.info?.systemNodeTooOld;
  const activeRuntimeSource =
    activeRuntime === "managed"
      ? t("general.nodeRuntimeSource.managed")
      : activeRuntime === "custom"
        ? t("general.nodeRuntimeSource.custom")
        : t("general.nodeRuntimeSource.system");
  const activeRuntimeLabel = nodeStatus.version
    ? t("general.nodeRuntimeActiveVersion", {
        version: nodeStatus.version,
        source: activeRuntimeSource,
      })
    : systemTooOld
      ? t("general.systemNodeTooOld")
      : t("general.noUsableNodeFound");
  const installPhaseLabel = (() => {
    switch (installPhase) {
      case "downloading":
        return t("general.managedNodeInstallPhases.downloading");
      case "verifying":
        return t("general.managedNodeInstallPhases.verifying");
      case "extracting":
        return t("general.managedNodeInstallPhases.extracting");
      case "installing":
        return t("general.managedNodeInstallPhases.installing");
      case "done":
        return t("general.managedNodeInstallPhases.done");
      default:
        return t("general.managedNodeInstallPhases.starting");
    }
  })();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          {t("general.nodeRuntime")}
        </Label>
        <div
          data-testid="node-runtime-settings"
          className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t("general.activeRuntime")}{" "}
                <span className="font-medium">{activeRuntimeLabel}</span>
              </p>
              {systemTooOld && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  {t("general.systemNodeTooOldDescription")}
                </p>
              )}
              {managedInstalled && nodeStatus.info?.managedNodeVersion && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("general.managedRuntimeVersion", {
                    version: nodeStatus.info.managedNodeVersion,
                  })}
                </p>
              )}
            </div>

            <div className="flex shrink-0 rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
              <button
                type="button"
                className={`h-8 rounded px-3 text-sm ${
                  runtimePreference === "system"
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
                onClick={() => handlePreferenceChange("system")}
                aria-pressed={runtimePreference === "system"}
              >
                {t("general.runtimeSystem")}
              </button>
              <button
                type="button"
                className={`h-8 rounded px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  runtimePreference === "managed"
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
                onClick={() => handlePreferenceChange("managed")}
                disabled={!managedSupported}
                aria-pressed={runtimePreference === "managed"}
              >
                {t("general.runtimeManaged")}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={handleInstallManagedNode}
              disabled={
                isInstallingManagedNode ||
                isRemovingManagedNode ||
                !managedSupported
              }
              variant={managedInstalled ? "outline" : "default"}
              size="sm"
            >
              {isInstallingManagedNode ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {managedInstalled
                ? t("general.reinstallManagedNode")
                : t("general.installManagedNode")}
            </Button>
            {managedInstalled && (
              <Button
                onClick={handleRemoveManagedNode}
                disabled={isInstallingManagedNode || isRemovingManagedNode}
                variant="outline"
                size="sm"
              >
                {isRemovingManagedNode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {t("general.removeManagedNode")}
              </Button>
            )}
          </div>

          {isInstallingManagedNode && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${installProgress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("general.installProgress", {
                  phase: installPhaseLabel,
                  percent: installProgress,
                })}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <Label className="text-sm font-medium">{t("general.nodePath")}</Label>

          <Button
            onClick={handleSelectNodePath}
            disabled={isSelectingPath}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            {isSelectingPath
              ? t("general.selecting")
              : t("general.browseForNode")}
          </Button>

          {isCustomPath && (
            <Button
              onClick={handleResetToDefault}
              variant="ghost"
              size="sm"
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {t("general.resetToDefault")}
            </Button>
          )}
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {isCustomPath
                    ? t("general.customPath")
                    : t("general.systemPath")}
                </span>
                {isCustomPath && (
                  <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                    {t("general.custom")}
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
                  <span className="text-xs">{t("general.notFound")}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {nodeStatus.isValid ? (
            <p>{t("general.nodeConfigured")}</p>
          ) : (
            <>
              <p>{t("general.nodeSelectFolder")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
