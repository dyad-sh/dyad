import { useAtom, useAtomValue } from "jotai";
import {
  appOutputAtom,
  previewModeAtom,
  previewPanelKeyAtom,
  selectedAppIdAtom,
} from "../../atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import { CodeView } from "./CodeView";
import { PreviewIframe } from "./PreviewIframe";
import { Problems } from "./Problems";
import {
  Eye,
  Code,
  ChevronDown,
  ChevronUp,
  Logs,
  MoreVertical,
  Cog,
  Power,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { Console } from "./Console";
import { useRunApp } from "@/hooks/useRunApp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showError, showSuccess } from "@/lib/toast";
import { useMutation } from "@tanstack/react-query";
import { useCheckProblems } from "@/hooks/useCheckProblems";

type PreviewMode = "preview" | "code" | "problems";

interface PreviewHeaderProps {
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
  onRestart: () => void;
  onCleanRestart: () => void;
  onClearSessionData: () => void;
}

interface ConsoleHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
  latestMessage?: string;
}

// Preview Header component with preview mode toggle
const PreviewHeader = ({
  previewMode,
  setPreviewMode,
  onRestart,
  onCleanRestart,
  onClearSessionData,
}: PreviewHeaderProps) => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const previewRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLButtonElement>(null);
  const problemsRef = useRef<HTMLButtonElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const { problemReport } = useCheckProblems(selectedAppId);
  // Get the problem count for the selected app
  const problemCount = problemReport ? problemReport.problems.length : 0;

  // Format the problem count for display
  const formatProblemCount = (count: number): string => {
    if (count === 0) return "";
    if (count > 100) return "100+";
    return count.toString();
  };

  const displayCount = formatProblemCount(problemCount);

  // Update indicator position when mode changes
  useEffect(() => {
    const updateIndicator = () => {
      let targetRef: React.RefObject<HTMLButtonElement | null>;

      switch (previewMode) {
        case "preview":
          targetRef = previewRef;
          break;
        case "code":
          targetRef = codeRef;
          break;
        case "problems":
          targetRef = problemsRef;
          break;
        default:
          return;
      }

      if (targetRef.current) {
        const button = targetRef.current;
        const container = button.parentElement;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          const left = buttonRect.left - containerRect.left;
          const width = buttonRect.width;

          setIndicatorStyle({ left, width });
        }
      }
    };

    // Small delay to ensure DOM is updated
    const timeoutId = setTimeout(updateIndicator, 10);
    return () => clearTimeout(timeoutId);
  }, [previewMode, displayCount]);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border">
      <div className="relative flex bg-[var(--background-darkest)] rounded-md p-0.5">
        <motion.div
          className="absolute top-0.5 bottom-0.5 bg-[var(--background-lightest)] shadow rounded-md"
          animate={{
            left: indicatorStyle.left,
            width: indicatorStyle.width,
          }}
          transition={{
            type: "spring",
            stiffness: 600,
            damping: 35,
            mass: 0.6,
          }}
        />
        <button
          data-testid="preview-mode-button"
          ref={previewRef}
          className="relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => setPreviewMode("preview")}
        >
          <Eye size={14} />
          <span>Preview</span>
        </button>
        <button
          data-testid="problems-mode-button"
          ref={problemsRef}
          className="relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => setPreviewMode("problems")}
        >
          <AlertTriangle size={14} />
          <span>Problems</span>
          {displayCount && (
            <span className="ml-0.5 px-1 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full min-w-[16px] text-center">
              {displayCount}
            </span>
          )}
        </button>
        <button
          data-testid="code-mode-button"
          ref={codeRef}
          className="relative flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium z-10"
          onClick={() => setPreviewMode("code")}
        >
          <Code size={14} />
          <span>Code</span>
        </button>
      </div>
      <div className="flex items-center">
        <button
          onClick={onRestart}
          className="flex items-center space-x-1 px-3 py-1 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
          title="Restart App"
        >
          <Power size={16} />
          <span>Restart</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="preview-more-options-button"
              className="flex items-center justify-center p-1.5 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
              title="More options"
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={onCleanRestart}>
              <Cog size={16} />
              <div className="flex flex-col">
                <span>Rebuild</span>
                <span className="text-xs text-muted-foreground">
                  Re-installs node_modules and restarts
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClearSessionData}>
              <Trash2 size={16} />
              <div className="flex flex-col">
                <span>Clear Cache</span>
                <span className="text-xs text-muted-foreground">
                  Clears cookies and local storage and other app cache
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

// Console header component
const ConsoleHeader = ({
  isOpen,
  onToggle,
  latestMessage,
}: ConsoleHeaderProps) => (
  <div
    onClick={onToggle}
    className="flex items-start gap-2 px-4 py-1.5 border-t border-border cursor-pointer hover:bg-[var(--background-darkest)] transition-colors"
  >
    <Logs size={16} className="mt-0.5" />
    <div className="flex flex-col">
      <span className="text-sm font-medium">System Messages</span>
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

// Main PreviewPanel component
export function PreviewPanel() {
  const [previewMode, setPreviewMode] = useAtom(previewModeAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const { runApp, stopApp, restartApp, loading, app, refreshAppIframe } =
    useRunApp();
  const runningAppIdRef = useRef<number | null>(null);
  const key = useAtomValue(previewPanelKeyAtom);
  const appOutput = useAtomValue(appOutputAtom);

  const messageCount = appOutput.length;
  const latestMessage =
    messageCount > 0 ? appOutput[messageCount - 1]?.message : undefined;

  const handleRestart = useCallback(() => {
    restartApp();
  }, [restartApp]);

  const handleCleanRestart = useCallback(() => {
    restartApp({ removeNodeModules: true });
  }, [restartApp]);

  const useClearSessionData = () => {
    return useMutation({
      mutationFn: () => {
        const ipcClient = IpcClient.getInstance();
        return ipcClient.clearSessionData();
      },
      onSuccess: async () => {
        await refreshAppIframe();
        showSuccess("Preview data cleared");
        // Optionally invalidate relevant queries
      },
      onError: (error) => {
        showError(`Error clearing preview data: ${error}`);
      },
    });
  };

  const { mutate: clearSessionData } = useClearSessionData();

  const handleClearSessionData = useCallback(() => {
    clearSessionData();
  }, [selectedAppId, clearSessionData]);

  useEffect(() => {
    const previousAppId = runningAppIdRef.current;

    // Check if the selected app ID has changed
    if (selectedAppId !== previousAppId) {
      // Stop the previously running app, if any
      if (previousAppId !== null) {
        console.debug("Stopping previous app", previousAppId);
        stopApp(previousAppId);
        // We don't necessarily nullify the ref here immediately,
        // let the start of the next app update it or unmount handle it.
      }

      // Start the new app if an ID is selected
      if (selectedAppId !== null) {
        console.debug("Starting new app", selectedAppId);
        runApp(selectedAppId); // Consider adding error handling for the promise if needed
        runningAppIdRef.current = selectedAppId; // Update ref to the new running app ID
      } else {
        // If selectedAppId is null, ensure no app is marked as running
        runningAppIdRef.current = null;
      }
    }

    // Cleanup function: This runs when the component unmounts OR before the effect runs again.
    // We only want to stop the app on actual unmount. The logic above handles stopping
    // when the appId changes. So, we capture the running appId at the time the effect renders.
    const appToStopOnUnmount = runningAppIdRef.current;
    return () => {
      if (appToStopOnUnmount !== null) {
        const currentRunningApp = runningAppIdRef.current;
        if (currentRunningApp !== null) {
          console.debug(
            "Component unmounting or selectedAppId changing, stopping app",
            currentRunningApp,
          );
          stopApp(currentRunningApp);
          runningAppIdRef.current = null; // Clear ref on stop
        }
      }
    };
    // Dependencies: run effect when selectedAppId changes.
    // runApp/stopApp are stable due to useCallback.
  }, [selectedAppId, runApp, stopApp]);
  return (
    <div className="flex flex-col h-full">
      <PreviewHeader
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        onRestart={handleRestart}
        onCleanRestart={handleCleanRestart}
        onClearSessionData={handleClearSessionData}
      />
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="vertical">
          <Panel id="content" minSize={30}>
            <div className="h-full overflow-y-auto">
              {previewMode === "preview" ? (
                <PreviewIframe key={key} loading={loading} />
              ) : previewMode === "code" ? (
                <CodeView loading={loading} app={app} />
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
