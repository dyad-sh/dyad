import { useAtom, useAtomValue } from "jotai";
import {
  appConsoleEntriesAtom,
  previewModeAtom,
  previewPanelKeyAtom,
  selectedAppIdAtom,
} from "../../atoms/appAtoms";

import { CodeView } from "./CodeView";
import { PreviewIframe } from "./PreviewIframe";
import { Problems } from "./Problems";
import { ConfigurePanel } from "./ConfigurePanel";
import { ChevronDown, ChevronUp, Logs } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { Console } from "./Console";
import { useRunApp } from "@/hooks/useRunApp";
import { PublishPanel } from "./PublishPanel";
import { SecurityPanel } from "./SecurityPanel";
import { PlanPanel } from "./PlanPanel";
import { useSupabase } from "@/hooks/useSupabase";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";

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
  const [previewMode] = useAtom(previewModeAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const { runApp, loading, app } = useRunApp();
  const { loadEdgeLogs } = useSupabase();
  const key = useAtomValue(previewPanelKeyAtom);
  const consoleEntries = useAtomValue(appConsoleEntriesAtom);

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

  useEffect(() => {
    // Notify backend which app is currently selected (for GC tracking)
    notifyAppSelected(selectedAppId);

    // Start the app if it's selected
    // The backend will handle the case where the app is already running
    if (selectedAppId !== null) {
      console.debug(
        "Running app (will start if not already running)",
        selectedAppId,
      );
      runApp(selectedAppId);
    }

    // Note: We no longer stop apps when switching. The backend garbage collector
    // will stop apps that haven't been viewed in 10 minutes.
    // Apps are only stopped explicitly when:
    // 1. User manually stops them
    // 2. App is deleted
    // 3. Garbage collector determines they've been idle too long
  }, [selectedAppId, runApp, notifyAppSelected]);

  // Note: We no longer stop all apps on unmount. The garbage collector
  // will handle cleanup of idle apps, and users may want apps to keep
  // running in the background.

  // Load edge logs if app has Supabase project configured
  useEffect(() => {
    const projectId = app?.supabaseProjectId;
    const organizationSlug = app?.supabaseOrganizationSlug ?? undefined;
    if (!projectId) return;

    // Load logs immediately
    loadEdgeLogs({ projectId, organizationSlug }).catch((error) => {
      console.error("Failed to load edge logs:", error);
    });

    // Poll for new logs every 5 seconds
    const intervalId = setInterval(() => {
      loadEdgeLogs({ projectId, organizationSlug }).catch((error) => {
        console.error("Failed to load edge logs:", error);
      });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [app?.supabaseProjectId, app?.supabaseOrganizationSlug, loadEdgeLogs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="vertical">
          <Panel id="content" minSize={30}>
            <div className="h-full overflow-y-auto">
              {previewMode === "preview" ? (
                <PreviewIframe key={key} loading={loading} />
              ) : previewMode === "code" ? (
                <CodeView loading={loading} app={app} />
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
