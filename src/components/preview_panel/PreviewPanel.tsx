import { useAtomValue } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "../../atoms/appAtoms";
import {
  currentConsoleEntriesAtom,
  currentPreviewReloadTokenAtom,
} from "@/atoms/previewRuntimeAtoms";

import { CodeView } from "./CodeView";
import { PreviewIframe } from "./PreviewIframe";
import { PreviewToolbar } from "./PreviewToolbar";
import { Problems } from "./Problems";
import { ConfigurePanel } from "./ConfigurePanel";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Loader2,
  Logs,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { Console } from "./Console";
import { useRunApp } from "@/hooks/useRunApp";
import { PublishPanel } from "./PublishPanel";
import { SecurityPanel } from "./SecurityPanel";
import { PlanPanel } from "./PlanPanel";
import { PackageManagerWarningBanner } from "./PackageManagerWarningBanner";
import { useSupabase } from "@/hooks/useSupabase";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";

interface ConsoleHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
  latestMessage?: string;
}

// Console header component
const ConsoleHeader = ({
  isOpen,
  onToggle,
  latestMessage,
}: ConsoleHeaderProps) => {
  const { t } = useTranslation("home");
  return (
    <div
      onClick={onToggle}
      className="flex items-start gap-2 px-4 py-1.5 border-t border-border cursor-pointer hover:bg-[var(--background-darkest)] transition-colors"
    >
      <Logs size={16} className="mt-0.5" />
      <div className="flex flex-col">
        <span className="text-sm font-medium">
          {t("preview.systemMessages")}
        </span>
        {!isOpen && latestMessage && (
          <span className="text-xs text-gray-500 truncate max-w-[200px] md:max-w-[400px]">
            {latestMessage}
          </span>
        )}
      </div>
      <div className="flex-1" />
      {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </div>
  );
};

// Main PreviewPanel component
export function PreviewPanel() {
  const previewMode = useAtomValue(previewModeAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const { runApp, loading } = useRunApp();
  const { app } = useLoadApp(selectedAppId);
  const { updateSettings } = useSettings();
  const key = useAtomValue(currentPreviewReloadTokenAtom);
  const consoleEntries = useAtomValue(currentConsoleEntriesAtom);
  const {
    data: nodeSystemInfo,
    isLoading: isCheckingNode,
    isError: nodeCheckFailed,
    refetch: refetchNodeStatus,
  } = useQuery({
    queryKey: queryKeys.system.nodejsStatus,
    queryFn: () => ipc.system.getNodejsStatus(),
    enabled: selectedAppId !== null,
  });
  const nodeVersion = nodeSystemInfo?.nodeVersion;
  const isNodeMissing =
    selectedAppId !== null &&
    previewMode === "preview" &&
    !isCheckingNode &&
    !nodeVersion;

  const latestMessage =
    consoleEntries.length > 0
      ? consoleEntries[consoleEntries.length - 1]?.message
      : undefined;

  // Notify backend about app selection changes (for garbage collection tracking)
  const notifyAppSelected = useCallback(async (appId: number | null) => {
    try {
      await ipc.app.selectAppForPreview({ appId });
    } catch (error) {
      console.error("Failed to notify app selection:", error);
    }
  }, []);

  useSupabase({
    edgeLogsProjectId: app?.supabaseProjectId,
    edgeLogsOrganizationSlug: app?.supabaseOrganizationSlug,
    edgeLogsAppId: app?.id,
  });

  useEffect(() => {
    let cancelled = false;

    const handleAppSelection = async () => {
      // Notify backend which app is currently selected (for GC tracking)
      await notifyAppSelected(selectedAppId);

      // If the effect was cleaned up while awaiting, don't proceed
      if (cancelled) return;

      // Start the app if it's selected
      // The backend will handle the case where the app is already running
      if (selectedAppId !== null) {
        if (!nodeVersion) {
          return;
        }

        console.debug(
          "Running app (will start if not already running)",
          selectedAppId,
        );
        runApp(selectedAppId);
      }
    };

    handleAppSelection();

    return () => {
      cancelled = true;
      // Notify backend that no app is being previewed so GC can reclaim idle apps
      notifyAppSelected(null);
    };
    // Note: We no longer stop apps when switching. The backend garbage collector
    // will stop apps that haven't been viewed in 10 minutes.
    // Apps are only stopped explicitly when:
    // 1. User manually stops them
    // 2. App is deleted
    // 3. Garbage collector determines they've been idle too long
  }, [selectedAppId, runApp, notifyAppSelected, nodeVersion]);

  // Note: We no longer stop all apps on unmount. The garbage collector
  // will handle cleanup of idle apps, and users may want apps to keep
  // running in the background.

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="vertical">
          <Panel id="content" minSize={30}>
            <div className="flex h-full flex-col">
              {previewMode !== "preview" && (
                <PreviewToolbar compactThreshold={0} />
              )}
              <PackageManagerWarningBanner />
              <div className="flex-1 overflow-y-auto">
                {isNodeMissing ? (
                  <PreviewNodeRequirement
                    nodeDownloadUrl={nodeSystemInfo?.nodeDownloadUrl}
                    isCheckFailed={nodeCheckFailed}
                    onCheckAgain={async () => {
                      await ipc.system.reloadEnvPath();
                      await refetchNodeStatus();
                    }}
                    onSelectNodeFolder={async () => {
                      const result = await ipc.system.selectNodeFolder();
                      if (result.path) {
                        await updateSettings({ customNodePath: result.path });
                        await ipc.system.reloadEnvPath();
                        await refetchNodeStatus();
                      } else if (
                        result.path === null &&
                        result.canceled === false
                      ) {
                        showError(
                          `Could not find Node.js at the path "${result.selectedPath}"`,
                        );
                      }
                    }}
                  />
                ) : previewMode === "preview" ? (
                  <PreviewIframe key={key} loading={loading} />
                ) : previewMode === "code" ? (
                  <CodeView loading={loading} app={app ?? null} />
                ) : previewMode === "configure" ? (
                  <ConfigurePanel />
                ) : previewMode === "publish" ? (
                  <PublishPanel />
                ) : previewMode === "security" ? (
                  <SecurityPanel />
                ) : previewMode === "plan" ? (
                  <PlanPanel />
                ) : (
                  <Problems />
                )}
              </div>
            </div>
          </Panel>
          {isConsoleOpen && (
            <>
              <PanelResizeHandle className="h-1 bg-border hover:bg-gray-400 transition-colors cursor-row-resize" />
              <Panel id="console" minSize={10} defaultSize={30}>
                <div className="flex flex-col h-full">
                  <ConsoleHeader
                    isOpen={true}
                    onToggle={() => setIsConsoleOpen(false)}
                    latestMessage={latestMessage}
                  />
                  <Console />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      {!isConsoleOpen && (
        <ConsoleHeader
          isOpen={false}
          onToggle={() => setIsConsoleOpen(true)}
          latestMessage={latestMessage}
        />
      )}
    </div>
  );
}

function PreviewNodeRequirement({
  nodeDownloadUrl,
  isCheckFailed,
  onCheckAgain,
  onSelectNodeFolder,
}: {
  nodeDownloadUrl?: string;
  isCheckFailed: boolean;
  onCheckAgain: () => Promise<void>;
  onSelectNodeFolder: () => Promise<void>;
}) {
  const [isCheckingAgain, setIsCheckingAgain] = useState(false);
  const [isSelectingNodeFolder, setIsSelectingNodeFolder] = useState(false);
  const [hasOpenedInstaller, setHasOpenedInstaller] = useState(false);

  const handleInstallNode = () => {
    if (nodeDownloadUrl) {
      void ipc.system.openExternalUrl(nodeDownloadUrl);
      setHasOpenedInstaller(true);
    }
  };

  const handleCheckAgain = async () => {
    setIsCheckingAgain(true);
    try {
      await onCheckAgain();
    } finally {
      setIsCheckingAgain(false);
    }
  };

  const handleSelectNodeFolder = async () => {
    setIsSelectingNodeFolder(true);
    try {
      await onSelectNodeFolder();
    } catch (error) {
      showError("Error setting Node.js path:" + error);
    } finally {
      setIsSelectingNodeFolder(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-(--background-lighter) p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <AlertCircle className="size-6" />
        </div>

        <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
          Node.js is required for preview
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Dyad needs Node.js to run your app locally. Install it once, then
          return here to start the preview.
        </p>

        {isCheckFailed && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Dyad could not check your Node.js setup.
          </p>
        )}

        <div className="mt-6 space-y-2">
          <Button
            variant={hasOpenedInstaller ? "outline" : "default"}
            className="h-11 w-full cursor-pointer"
            onClick={handleInstallNode}
            disabled={!nodeDownloadUrl}
          >
            <Download className="size-4" />
            Install Node.js
          </Button>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className={`h-10 cursor-pointer bg-background ${hasOpenedInstaller ? "sm:col-span-2" : ""}`}
              onClick={handleSelectNodeFolder}
              disabled={isSelectingNodeFolder}
            >
              {isSelectingNodeFolder ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderOpen className="size-4" />
              )}
              I already have it
            </Button>
            {!hasOpenedInstaller && (
              <Button
                variant="outline"
                className="h-10 cursor-pointer bg-background"
                onClick={handleCheckAgain}
                disabled={isCheckingAgain}
              >
                {isCheckingAgain ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Check again
              </Button>
            )}
          </div>
        </div>

        {hasOpenedInstaller && (
          <div className="mt-4 rounded-lg border border-primary/25 bg-primary/8 px-4 py-4 text-left">
            <div className="flex flex-col gap-4">
              <div>
                <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-primary">
                  Next step
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  Node.js downloaded
                </p>
                <ol className="mt-2 space-y-1 text-sm leading-5 text-muted-foreground">
                  <li>1. Open the Node.js installer and finish setup.</li>
                  <li>2. Return to Dyad and click the button.</li>
                </ol>
              </div>
              <Button
                size="lg"
                className="h-11 w-full cursor-pointer"
                onClick={handleCheckAgain}
                disabled={isCheckingAgain}
              >
                {isCheckingAgain ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                I installed Node.js
              </Button>
            </div>
          </div>
        )}

        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          You can keep editing your app while Node.js installs.
        </p>
      </div>
    </div>
  );
}
