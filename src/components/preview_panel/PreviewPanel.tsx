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
  Globe,
  Loader2,
  Logs,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
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
                    appName={app?.name}
                    nodeDownloadUrl={nodeSystemInfo?.nodeDownloadUrl}
                    isCheckFailed={nodeCheckFailed}
                    onCheckAgain={async () => {
                      await ipc.system.reloadEnvPath();
                      await refetchNodeStatus();
                    }}
                    onInstallManagedNode={async () => {
                      await ipc.system.installManagedNode();
                      await ipc.system.reloadEnvPath();
                      await queryClient.invalidateQueries({
                        queryKey: queryKeys.settings.user,
                      });
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

const NODE_POLL_INTERVAL_MS = 4000;

function PreviewNodeRequirement({
  appName,
  nodeDownloadUrl,
  isCheckFailed,
  onCheckAgain,
  onInstallManagedNode,
  onSelectNodeFolder,
}: {
  appName?: string;
  nodeDownloadUrl?: string;
  isCheckFailed: boolean;
  onCheckAgain: () => Promise<void>;
  onInstallManagedNode: () => Promise<void>;
  onSelectNodeFolder: () => Promise<void>;
}) {
  const [isCheckingAgain, setIsCheckingAgain] = useState(false);
  const [isInstallingManagedNode, setIsInstallingManagedNode] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState<string>("starting");
  const [isSelectingNodeFolder, setIsSelectingNodeFolder] = useState(false);
  const [hasOpenedInstaller, setHasOpenedInstaller] = useState(false);

  useEffect(() => {
    return ipc.events.system.onManagedNodeInstallProgress((progress) => {
      setInstallProgress(progress.percent);
      setInstallPhase(progress.phase);
    });
  }, []);

  // Quietly re-check for Node.js while this state is visible so the preview
  // starts on its own the moment the installer finishes — no click required.
  const checkAgainRef = useRef(onCheckAgain);
  checkAgainRef.current = onCheckAgain;
  const isPollInFlightRef = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (isPollInFlightRef.current) {
        return;
      }
      isPollInFlightRef.current = true;
      void checkAgainRef
        .current()
        .catch(() => {})
        .finally(() => {
          isPollInFlightRef.current = false;
        });
    }, NODE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const handleInstallNode = () => {
    if (nodeDownloadUrl) {
      void ipc.system.openExternalUrl(nodeDownloadUrl);
      setHasOpenedInstaller(true);
    }
  };

  const handleInstallManagedNode = async () => {
    setIsInstallingManagedNode(true);
    setInstallProgress(0);
    setInstallPhase("starting");
    try {
      await onInstallManagedNode();
    } catch (error: any) {
      showError(error.message ?? "Failed to install Dyad-managed Node.js");
    } finally {
      setIsInstallingManagedNode(false);
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
    <div className="flex min-h-full bg-(--background-lighter) p-4 sm:p-6">
      <div className="relative flex min-h-[26rem] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        {/* Browser chrome: this panel IS their site's window, one step early */}
        <div className="flex items-center gap-3 border-b border-border bg-(--background-lighter) px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-red-400/70 dark:bg-red-400/50" />
            <span className="size-2.5 rounded-full bg-amber-400/70 dark:bg-amber-400/50" />
            <span className="size-2.5 rounded-full bg-green-400/70 dark:bg-green-400/50" />
          </div>
          <div className="mx-auto flex h-7 w-full min-w-0 max-w-xs items-center justify-center gap-1.5 rounded-full bg-(--background-darker)/70 px-3">
            <Globe className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs text-muted-foreground">
              {appName ? `${appName} · localhost` : "Your app · localhost"}
            </span>
          </div>
          <div className="w-13 shrink-0" aria-hidden="true" />
        </div>

        <div className="relative flex-1 overflow-hidden">
          {/* Setup card, centered in the waiting browser window */}
          <div className="absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-(--background-lightest) p-5 text-center shadow-lg">
              {isInstallingManagedNode ? (
                <>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    Installing Node.js
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-foreground/80">
                    Dyad is setting up a private Node.js runtime for previews.
                  </p>
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-(--background-darker)">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${installProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {installPhase} {installProgress}%
                    </p>
                  </div>
                </>
              ) : hasOpenedInstaller ? (
                <>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    Finish the Node.js install
                  </h3>
                  <ol className="mx-auto mt-3 max-w-xs space-y-1.5 text-left text-sm leading-6 text-foreground/80">
                    <li>1. Open the installer you just downloaded.</li>
                    <li>2. Click through with the default settings.</li>
                  </ol>
                  {/* Live watching status while polling for the install */}
                  <div className="mt-4 flex items-center justify-center gap-2.5 rounded-lg bg-(--background-lighter) px-3 py-2.5">
                    <span
                      className="relative flex size-2 shrink-0"
                      aria-hidden="true"
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 [animation-duration:2.5s] motion-reduce:animate-none" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    <p className="text-left text-xs leading-5 text-foreground/80">
                      Watching for Node.js…
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    Install Node.js to see your preview
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-foreground/80">
                    The free engine that runs your app on this computer. About
                    two minutes to install.
                  </p>
                  <Button
                    className="mt-4 h-10 w-full cursor-pointer"
                    onClick={handleInstallManagedNode}
                  >
                    <Download className="size-4" />
                    Install Node.js for me (~30 MB)
                  </Button>
                </>
              )}

              {isCheckFailed && (
                <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertCircle className="mr-1.5 inline size-3.5 align-[-2px]" />
                  Dyad couldn't check for Node.js. It will keep trying.
                </p>
              )}

              <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={handleSelectNodeFolder}
                  disabled={isSelectingNodeFolder || isInstallingManagedNode}
                >
                  {isSelectingNodeFolder ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="size-3.5" />
                  )}
                  I already have Node.js
                </Button>
                <div
                  className="h-4 w-px shrink-0 bg-border"
                  aria-hidden="true"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={handleCheckAgain}
                  disabled={isCheckingAgain || isInstallingManagedNode}
                >
                  {isCheckingAgain ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Check now
                </Button>
              </div>

              <div className="mt-2 flex items-center justify-center text-xs">
                {nodeDownloadUrl && (
                  <button
                    type="button"
                    onClick={handleInstallNode}
                    disabled={isInstallingManagedNode}
                    className="cursor-pointer font-medium text-muted-foreground transition-colors hover:text-primary hover:underline"
                  >
                    {hasOpenedInstaller
                      ? "Reopen nodejs.org download"
                      : "Download from nodejs.org instead"}
                  </button>
                )}
              </div>

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                You can install Node.js while your app is building.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
