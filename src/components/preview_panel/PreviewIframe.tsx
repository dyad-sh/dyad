import {
  selectedAppIdAtom,
  appUrlAtom,
  appConsoleEntriesAtom,
  previewErrorMessageAtom,
  previewCurrentUrlAtom,
} from "@/atoms/appAtoms";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Loader2,
  X,
  Sparkles,
  ChevronDown,
  Lightbulb,
  ChevronRight,
  MousePointerClick,
  Power,
  MonitorSmartphone,
  Monitor,
  Tablet,
  Smartphone,
  Pen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import { ipc } from "@/ipc/types";

import { useParseRouter } from "@/hooks/useParseRouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStreamChat } from "@/hooks/useStreamChat";
import {
  selectedComponentsPreviewAtom,
  visualEditingSelectedComponentAtom,
  currentComponentCoordinatesAtom,
  previewIframeRefAtom,
  annotatorModeAtom,
  screenshotDataUrlAtom,
  pendingVisualChangesAtom,
} from "@/atoms/previewAtoms";
import { isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { ComponentSelection } from "@/ipc/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRunApp } from "@/hooks/useRunApp";
import { useSettings } from "@/hooks/useSettings";
import { useShortcut } from "@/hooks/useShortcut";
import { cn } from "@/lib/utils";
import { normalizePath } from "../../../shared/normalizePath";
import { showError } from "@/lib/toast";
import type { DeviceMode } from "@/lib/schemas";
import { AnnotatorOnlyForPro } from "./AnnotatorOnlyForPro";
import { useAttachments } from "@/hooks/useAttachments";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { Annotator } from "@/pro/ui/components/Annotator/Annotator";
import { VisualEditingToolbar } from "./VisualEditingToolbar";

interface ErrorBannerProps {
  error: { message: string; source: "preview-app" | "dyad-app" } | undefined;
  onDismiss: () => void;
  onAIFix: () => void;
}

const ErrorBanner = ({ error, onDismiss, onAIFix }: ErrorBannerProps) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const { isStreaming } = useStreamChat();
  if (!error) return null;
  const isDockerError = error.message.includes("Cannot connect to the Docker");

  const getTruncatedError = () => {
    const firstLine = error.message.split("\n")[0];
    const snippetLength = 250;
    const snippet = error.message.substring(0, snippetLength);
    return firstLine.length < snippet.length
      ? firstLine
      : snippet + (snippet.length === snippetLength ? "..." : "");
  };

  return (
    <div
      className="absolute top-2 left-2 right-2 z-10 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md shadow-sm p-2"
      data-testid="preview-error-banner"
    >
      {/* Close button in top left */}
      <button
        onClick={onDismiss}
        className="absolute top-1 left-1 p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
      >
        <X size={14} className="text-red-500 dark:text-red-400" />
      </button>

      {/* Add a little chip that says "Internal error" if source is "dyad-app" */}
      {error.source === "dyad-app" && (
        <div className="absolute top-1 right-1 p-1 bg-red-100 dark:bg-red-900 rounded-md text-xs font-medium text-red-700 dark:text-red-300">
          Internal Dyad error
        </div>
      )}

      {/* Error message in the middle */}
      <div
        className={cn(
          "px-6 py-1 text-sm",
          error.source === "dyad-app" && "pt-6",
        )}
      >
        <div
          className="text-red-700 dark:text-red-300 text-wrap font-mono whitespace-pre-wrap break-words text-xs cursor-pointer flex gap-1 items-start"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <ChevronRight
            size={14}
            className={`mt-0.5 transform transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />

          {isCollapsed ? getTruncatedError() : error.message}
        </div>
      </div>

      {/* Tip message */}
      <div className="mt-2 px-6">
        <div className="relative p-2 bg-red-100 dark:bg-red-900 rounded-sm flex gap-1 items-center">
          <div>
            <Lightbulb size={16} className=" text-red-800 dark:text-red-300" />
          </div>
          <span className="text-sm text-red-700 dark:text-red-200">
            <span className="font-medium">Tip: </span>
            {isDockerError
              ? "Make sure Docker Desktop is running and try restarting the app."
              : error.source === "dyad-app"
                ? "Try restarting the Dyad app or restarting your computer to see if that fixes the error."
                : "Check if restarting the app fixes the error."}
          </span>
        </div>
      </div>

      {/* Action buttons at the bottom */}
      {!isDockerError && error.source === "preview-app" && (
        <div className="mt-3 px-6 flex justify-end gap-2">
          <CopyErrorMessage errorMessage={error.message} />
          <button
            disabled={isStreaming}
            onClick={onAIFix}
            className="cursor-pointer flex items-center space-x-1 px-2 py-1 bg-red-500 dark:bg-red-600 text-white rounded text-sm hover:bg-red-600 dark:hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={14} />
            <span>Fix error with AI</span>
          </button>
        </div>
      )}
    </div>
  );
};

// Preview iframe component
export const PreviewIframe = ({ loading }: { loading: boolean }) => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { appUrl, originalUrl } = useAtomValue(appUrlAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  // State to trigger iframe reload
  const [reloadKey, setReloadKey] = useState(0);
  const [errorMessage, setErrorMessage] = useAtom(previewErrorMessageAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const { routes: availableRoutes } = useParseRouter(selectedAppId);
  const { restartApp } = useRunApp();
  const { settings, updateSettings } = useSettings();
  const { userBudget } = useUserBudgetInfo();
  const isProMode = !!userBudget;

  // Preserved URL state (persists across HMR-induced remounts)
  const [preservedUrls, setPreservedUrls] = useAtom(previewCurrentUrlAtom);

  // Get the initial URL to use - check if we have a preserved URL from before HMR remount
  const initialUrl = selectedAppId ? preservedUrls[selectedAppId] : null;

  // Navigation state - initialize with preserved URL if available
  const [isComponentSelectorInitialized, setIsComponentSelectorInitialized] =
    useState(false);
  const [canGoBack, setCanGoBack] = useState(!!initialUrl);
  const [canGoForward, setCanGoForward] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<string[]>(() => {
    if (appUrl && initialUrl && initialUrl !== appUrl) {
      return [appUrl, initialUrl];
    }
    return appUrl ? [appUrl] : [];
  });
  const [currentHistoryPosition, setCurrentHistoryPosition] = useState(() => {
    if (appUrl && initialUrl && initialUrl !== appUrl) {
      return 1;
    }
    return 0;
  });
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const [visualEditingSelectedComponent, setVisualEditingSelectedComponent] =
    useAtom(visualEditingSelectedComponentAtom);
  const setCurrentComponentCoordinates = useSetAtom(
    currentComponentCoordinatesAtom,
  );
  const setPreviewIframeRef = useSetAtom(previewIframeRefAtom);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Ref to store the URL that the iframe should be showing - initialize with preserved URL if available
  // This is different from appUrl - it tracks the CURRENT route, not just the base URL
  const currentIframeUrlRef = useRef<string | null>(initialUrl || appUrl);
  const [isPicking, setIsPicking] = useState(false);
  const [annotatorMode, setAnnotatorMode] = useAtom(annotatorModeAtom);
  const [screenshotDataUrl, setScreenshotDataUrl] = useAtom(
    screenshotDataUrlAtom,
  );
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );

  const { addAttachments } = useAttachments();
  const setPendingChanges = useSetAtom(pendingVisualChangesAtom);

  // AST Analysis State
  const [isDynamicComponent, setIsDynamicComponent] = useState(false);
  const [hasStaticText, setHasStaticText] = useState(false);

  // Device mode state
  const deviceMode: DeviceMode = settings?.previewDeviceMode ?? "desktop";
  const [isDevicePopoverOpen, setIsDevicePopoverOpen] = useState(false);

  // Device configurations
  const deviceWidthConfig = {
    tablet: 768,
    mobile: 375,
  };

  //detect if the user is using Mac
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  const analyzeComponent = async (componentId: string) => {
    if (!componentId || !selectedAppId) return;

    try {
      const result = await ipc.visualEditing.analyzeComponent({
        appId: selectedAppId,
        componentId,
      });
      setIsDynamicComponent(result.isDynamic);
      setHasStaticText(result.hasStaticText);

      // Automatically enable text editing if component has static text
      if (result.hasStaticText && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: "enable-dyad-text-editing",
            data: {
              componentId: componentId,
              runtimeId: visualEditingSelectedComponent?.runtimeId,
            },
          },
          "*",
        );
      }
    } catch (err) {
      console.error("Failed to analyze component", err);
      setIsDynamicComponent(false);
      setHasStaticText(false);
    }
  };

  const handleTextUpdated = async (data: any) => {
    const { componentId, text } = data;
    if (!componentId || !selectedAppId) return;

    // Parse componentId to extract file path and line number
    const [filePath, lineStr] = componentId.split(":");
    const lineNumber = parseInt(lineStr, 10);

    if (!filePath || isNaN(lineNumber)) {
      console.error("Invalid componentId format:", componentId);
      return;
    }

    // Store text change in pending changes
    setPendingChanges((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(componentId);

      updated.set(componentId, {
        componentId: componentId,
        componentName:
          existing?.componentName || visualEditingSelectedComponent?.name || "",
        relativePath: filePath,
        lineNumber: lineNumber,
        styles: existing?.styles || {},
        textContent: text,
      });

      return updated;
    });
  };

  // Function to get current styles from selected element
  const getCurrentElementStyles = () => {
    if (!iframeRef.current?.contentWindow || !visualEditingSelectedComponent)
      return;

    try {
      // Send message to iframe to get current styles
      iframeRef.current.contentWindow.postMessage(
        {
          type: "get-dyad-component-styles",
          data: {
            elementId: visualEditingSelectedComponent.id,
            runtimeId: visualEditingSelectedComponent.runtimeId,
          },
        },
        "*",
      );
    } catch (error) {
      console.error("Failed to get element styles:", error);
    }
  };
  useEffect(() => {
    setAnnotatorMode(false);
  }, []);
  // Reset visual editing state when app changes or component unmounts
  useEffect(() => {
    return () => {
      // Cleanup on unmount or when app changes
      setVisualEditingSelectedComponent(null);
      setPendingChanges(new Map());
      setCurrentComponentCoordinates(null);
    };
  }, [selectedAppId]);

  // Update iframe ref atom
  useEffect(() => {
    setPreviewIframeRef(iframeRef.current);
  }, [iframeRef.current, setPreviewIframeRef]);

  // Send pro mode status to iframe
  useEffect(() => {
    if (iframeRef.current?.contentWindow && isComponentSelectorInitialized) {
      iframeRef.current.contentWindow.postMessage(
        { type: "dyad-pro-mode", enabled: isProMode },
        "*",
      );
    }
  }, [isProMode, isComponentSelectorInitialized]);

  // Add message listener for iframe errors and navigation events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle messages from our iframe
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      // Handle console logs from the iframe
      if (event.data?.type === "console-log") {
        const { level, args } = event.data;
        const formattedMessage = `[${level.toUpperCase()}] ${args.join(" ")}`;
        const logLevel: "info" | "warn" | "error" =
          level === "error" ? "error" : level === "warn" ? "warn" : "info";
        const logEntry = {
          level: logLevel,
          type: "client" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
        return;
      }

      // Handle network requests from the iframe
      if (event.data?.type === "network-request") {
        const { method, url } = event.data;
        const formattedMessage = `→ ${method} ${url}`;
        const logEntry = {
          level: "info" as const,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
        return;
      }

      // Handle network responses from the iframe
      if (event.data?.type === "network-response") {
        const { method, url, status, duration } = event.data;
        const formattedMessage = `[${status}] ${method} ${url} (${duration}ms)`;
        const level: "info" | "warn" | "error" =
          status >= 400 ? "error" : status >= 300 ? "warn" : "info";
        const logEntry = {
          level,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
        return;
      }

      // Handle network errors from the iframe
      if (event.data?.type === "network-error") {
        const { method, url, status, error, duration } = event.data;
        const statusCode = status && status !== 0 ? `[${status}] ` : "";
        const formattedMessage = `${statusCode}${method} ${url} - ${error} (${duration}ms)`;
        const logEntry = {
          level: "error" as const,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
        return;
      }

      if (event.data?.type === "dyad-component-selector-initialized") {
        setIsComponentSelectorInitialized(true);
        iframeRef.current?.contentWindow?.postMessage(
          { type: "dyad-pro-mode", enabled: isProMode },
          "*",
        );
        return;
      }

      if (event.data?.type === "dyad-text-updated") {
        handleTextUpdated(event.data);
        return;
      }

      if (event.data?.type === "dyad-text-finalized") {
        handleTextUpdated(event.data);
        return;
      }

      if (event.data?.type === "dyad-component-selected") {
        console.log("Component picked:", event.data);

        const component = parseComponentSelection(event.data);

        if (!component) return;

        // Store the coordinates
        if (event.data.coordinates && isProMode) {
          setCurrentComponentCoordinates(event.data.coordinates);
        }

        // Add to selected components if not already there
        setSelectedComponentsPreview((prev) => {
          const exists = prev.some((c) => {
            // Check by runtimeId if available otherwise by id
            // Stored components may have lost their runtimeId after re-renders or reloading the page
            if (component.runtimeId && c.runtimeId) {
              return c.runtimeId === component.runtimeId;
            }
            return c.id === component.id;
          });
          if (exists) {
            return prev;
          }
          return [...prev, component];
        });

        if (isProMode) {
          // Set as the highlighted component for visual editing
          setVisualEditingSelectedComponent(component);
          // Trigger AST analysis
          analyzeComponent(component.id);
        }

        return;
      }

      if (event.data?.type === "dyad-component-deselected") {
        const componentId = event.data.componentId;
        if (componentId) {
          // Disable text editing for the deselected component
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              {
                type: "disable-dyad-text-editing",
                data: { componentId },
              },
              "*",
            );
          }

          setSelectedComponentsPreview((prev) =>
            prev.filter((c) => c.id !== componentId),
          );
          setVisualEditingSelectedComponent((prev) => {
            const shouldClear = prev?.id === componentId;
            if (shouldClear) {
              setCurrentComponentCoordinates(null);
            }
            return shouldClear ? null : prev;
          });
        }
        return;
      }

      if (event.data?.type === "dyad-component-coordinates-updated") {
        if (event.data.coordinates) {
          setCurrentComponentCoordinates(event.data.coordinates);
        }
        return;
      }

      if (event.data?.type === "dyad-screenshot-response") {
        if (event.data.success && event.data.dataUrl) {
          setScreenshotDataUrl(event.data.dataUrl);
          setAnnotatorMode(true);
        } else {
          showError(event.data.error);
        }
        return;
      }

      const { type, payload } = event.data as {
        type:
          | "window-error"
          | "unhandled-rejection"
          | "iframe-sourcemapped-error"
          | "build-error-report"
          | "pushState"
          | "replaceState";
        payload?: {
          message?: string;
          stack?: string;
          reason?: string;
          newUrl?: string;
          file?: string;
          frame?: string;
        };
      };

      if (
        type === "window-error" ||
        type === "unhandled-rejection" ||
        type === "iframe-sourcemapped-error"
      ) {
        const stack =
          type === "iframe-sourcemapped-error"
            ? payload?.stack?.split("\n").slice(0, 1).join("\n")
            : payload?.stack;
        const errorMessage = `Error ${payload?.message || payload?.reason}\nStack trace: ${stack}`;
        console.error("Iframe error:", errorMessage);
        setErrorMessage({ message: errorMessage, source: "preview-app" });
        const logEntry = {
          level: "error" as const,
          type: "client" as const,
          message: `Iframe error: ${errorMessage}`,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
      } else if (type === "build-error-report") {
        console.debug(`Build error report: ${payload}`);
        const errorMessage = `${payload?.message} from file ${payload?.file}.\n\nSource code:\n${payload?.frame}`;
        setErrorMessage({ message: errorMessage, source: "preview-app" });
        const logEntry = {
          level: "error" as const,
          type: "client" as const,
          message: `Build error report: ${JSON.stringify(payload)}`,
          appId: selectedAppId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
      } else if (type === "pushState" || type === "replaceState") {
        // Update navigation history based on the type of state change
        if (type === "pushState" && payload?.newUrl) {
          // For pushState, we trim any forward history and add the new URL
          const newHistory = [
            ...navigationHistory.slice(0, currentHistoryPosition + 1),
            payload.newUrl,
          ];
          setNavigationHistory(newHistory);
          setCurrentHistoryPosition(newHistory.length - 1);
          // Update the current iframe URL ref to match the navigation
          currentIframeUrlRef.current = payload.newUrl;
          // Preserve URL for HMR remounts - only if it's a different route from root
          // Compare origins and check if there's a meaningful path
          if (selectedAppId && appUrl) {
            try {
              const newUrlObj = new URL(payload.newUrl);
              const appUrlObj = new URL(appUrl);
              // Only preserve if there's a non-root path
              if (
                newUrlObj.origin === appUrlObj.origin &&
                newUrlObj.pathname !== "/" &&
                newUrlObj.pathname !== ""
              ) {
                const urlToPreserve = payload.newUrl;
                setPreservedUrls((prev) => ({
                  ...prev,
                  [selectedAppId]: urlToPreserve,
                }));
              } else if (newUrlObj.origin === appUrlObj.origin) {
                // Clear preserved URL when navigating back to root
                setPreservedUrls((prev) => {
                  const next = { ...prev };
                  delete next[selectedAppId];
                  return next;
                });
              }
            } catch {
              // Invalid URL, don't preserve
            }
          }
        } else if (type === "replaceState" && payload?.newUrl) {
          // For replaceState, we replace the current URL
          const newHistory = [...navigationHistory];
          newHistory[currentHistoryPosition] = payload.newUrl;
          setNavigationHistory(newHistory);
          // Update the current iframe URL ref to match the navigation
          currentIframeUrlRef.current = payload.newUrl;
          // Preserve URL for HMR remounts - only if it's a different route from root
          if (selectedAppId && appUrl) {
            try {
              const newUrlObj = new URL(payload.newUrl);
              const appUrlObj = new URL(appUrl);
              // Only preserve if there's a non-root path
              if (
                newUrlObj.origin === appUrlObj.origin &&
                newUrlObj.pathname !== "/" &&
                newUrlObj.pathname !== ""
              ) {
                const urlToPreserve = payload.newUrl;
                setPreservedUrls((prev) => ({
                  ...prev,
                  [selectedAppId]: urlToPreserve,
                }));
              } else if (newUrlObj.origin === appUrlObj.origin) {
                // Clear preserved URL when navigating back to root
                setPreservedUrls((prev) => {
                  const next = { ...prev };
                  delete next[selectedAppId];
                  return next;
                });
              }
            } catch {
              // Invalid URL, don't preserve
            }
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    navigationHistory,
    currentHistoryPosition,
    selectedAppId,
    appUrl,
    errorMessage,
    setErrorMessage,
    setIsComponentSelectorInitialized,
    setSelectedComponentsPreview,
    setVisualEditingSelectedComponent,
    setPreservedUrls,
  ]);

  useEffect(() => {
    // Update navigation buttons state
    setCanGoBack(currentHistoryPosition > 0);
    setCanGoForward(currentHistoryPosition < navigationHistory.length - 1);
  }, [navigationHistory, currentHistoryPosition]);

  // Reset navigation when appUrl changes (different app selected)
  const prevAppUrlRef = useRef(appUrl);
  useEffect(() => {
    if (appUrl && appUrl !== prevAppUrlRef.current) {
      prevAppUrlRef.current = appUrl;
      setNavigationHistory([appUrl]);
      setCurrentHistoryPosition(0);
      setCanGoBack(false);
      setCanGoForward(false);
      // Reset iframe URL to the new app's base URL
      currentIframeUrlRef.current = appUrl;
    }
  }, [appUrl]);

  // Get current styles when component is selected for visual editing
  useEffect(() => {
    if (visualEditingSelectedComponent) {
      getCurrentElementStyles();
    }
  }, [visualEditingSelectedComponent]);

  // Function to activate component selector in the iframe
  const handleActivateComponentSelector = () => {
    if (iframeRef.current?.contentWindow) {
      const newIsPicking = !isPicking;
      if (!newIsPicking) {
        // Clean up any text editing states when deactivating
        iframeRef.current.contentWindow.postMessage(
          { type: "cleanup-all-text-editing" },
          "*",
        );
      }
      setIsPicking(newIsPicking);
      setVisualEditingSelectedComponent(null);
      iframeRef.current.contentWindow.postMessage(
        {
          type: newIsPicking
            ? "activate-dyad-component-selector"
            : "deactivate-dyad-component-selector",
        },
        "*",
      );
    }
  };

  // Function to handle annotator button click
  const handleAnnotatorClick = () => {
    if (annotatorMode) {
      setAnnotatorMode(false);
      return;
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "dyad-take-screenshot",
        },
        "*",
      );
    }
  };

  // Activate component selector using a shortcut
  useShortcut(
    "c",
    { shift: true, ctrl: !isMac, meta: isMac },
    handleActivateComponentSelector,
    isComponentSelectorInitialized,
    iframeRef,
  );

  // Function to navigate back
  const handleNavigateBack = () => {
    if (canGoBack && iframeRef.current?.contentWindow) {
      const newPosition = currentHistoryPosition - 1;
      if (newPosition < 0 || newPosition >= navigationHistory.length) return;
      const targetUrl = navigationHistory[newPosition];
      if (!targetUrl) return;

      // Send the target URL to navigate to (browser history.back() doesn't work in Electron iframes)
      iframeRef.current.contentWindow.postMessage(
        {
          type: "navigate",
          payload: { direction: "backward", url: targetUrl },
        },
        "*",
      );

      // Update our local state
      setCurrentHistoryPosition(newPosition);
      setCanGoBack(newPosition > 0);
      setCanGoForward(true);
      // Update iframe URL ref to match
      currentIframeUrlRef.current = targetUrl;

      // Update preservedUrls to match navigation (for HMR remounts)
      if (selectedAppId && appUrl) {
        try {
          const targetUrlObj = new URL(targetUrl);
          const appUrlObj = new URL(appUrl);
          if (targetUrlObj.origin === appUrlObj.origin) {
            // Clear preserved URL if navigating back to root, otherwise update it
            if (targetUrlObj.pathname === "/" || targetUrlObj.pathname === "") {
              setPreservedUrls((prev) => {
                const newUrls = { ...prev };
                delete newUrls[selectedAppId];
                return newUrls;
              });
            } else {
              setPreservedUrls((prev) => ({
                ...prev,
                [selectedAppId]: targetUrl,
              }));
            }
          }
        } catch {
          // Invalid URL, don't update preservedUrls
        }
      }
    }
  };

  // Function to navigate forward
  const handleNavigateForward = () => {
    if (canGoForward && iframeRef.current?.contentWindow) {
      const newPosition = currentHistoryPosition + 1;
      if (newPosition < 0 || newPosition >= navigationHistory.length) return;
      const targetUrl = navigationHistory[newPosition];
      if (!targetUrl) return;

      // Send the target URL to navigate to (browser history.forward() doesn't work in Electron iframes)
      iframeRef.current.contentWindow.postMessage(
        {
          type: "navigate",
          payload: { direction: "forward", url: targetUrl },
        },
        "*",
      );

      // Update our local state
      setCurrentHistoryPosition(newPosition);
      setCanGoBack(true);
      setCanGoForward(newPosition < navigationHistory.length - 1);
      // Update iframe URL ref to match
      currentIframeUrlRef.current = targetUrl;

      // Update preservedUrls to match navigation (for HMR remounts)
      if (selectedAppId && appUrl) {
        try {
          const targetUrlObj = new URL(targetUrl);
          const appUrlObj = new URL(appUrl);
          if (targetUrlObj.origin === appUrlObj.origin) {
            // Clear preserved URL if navigating forward to root, otherwise update it
            if (targetUrlObj.pathname === "/" || targetUrlObj.pathname === "") {
              setPreservedUrls((prev) => {
                const newUrls = { ...prev };
                delete newUrls[selectedAppId];
                return newUrls;
              });
            } else {
              setPreservedUrls((prev) => ({
                ...prev,
                [selectedAppId]: targetUrl,
              }));
            }
          }
        } catch {
          // Invalid URL, don't update preservedUrls
        }
      }
    }
  };

  // Function to handle reload
  const handleReload = () => {
    // Store the current URL to preserve the route during reload
    const currentUrl = navigationHistory[currentHistoryPosition] || appUrl;

    // Validate that the URL is same-origin as appUrl to prevent XSS/URL injection
    if (currentUrl && appUrl) {
      try {
        const currentOrigin = new URL(currentUrl).origin;
        const appOrigin = new URL(appUrl).origin;

        // Only use the current URL if it has the same origin as the app URL
        if (currentOrigin === appOrigin) {
          currentIframeUrlRef.current = currentUrl;
        } else {
          console.warn(
            `Rejecting reload URL ${currentUrl} - origin mismatch with app URL ${appUrl}`,
          );
          currentIframeUrlRef.current = appUrl;
        }
      } catch (e) {
        console.error("Invalid URL during reload validation", e);
        currentIframeUrlRef.current = appUrl;
      }
    } else {
      currentIframeUrlRef.current = currentUrl || null;
    }

    setReloadKey((prevKey) => prevKey + 1);
    setErrorMessage(undefined);
    // Reset visual editing state
    setVisualEditingSelectedComponent(null);
    setPendingChanges(new Map());
    setCurrentComponentCoordinates(null);
    console.debug("Reloading iframe preview for app", selectedAppId);
  };

  // Function to navigate to a specific route
  const navigateToRoute = (path: string) => {
    if (iframeRef.current?.contentWindow && appUrl) {
      // Create the full URL by combining the base URL with the path
      const baseUrl = new URL(appUrl).origin;
      const newUrl = `${baseUrl}${path}`;

      // Navigate to the URL
      iframeRef.current.contentWindow.location.href = newUrl;

      // iframeRef.current.src = newUrl;

      // Update navigation history
      const newHistory = [
        ...navigationHistory.slice(0, currentHistoryPosition + 1),
        newUrl,
      ];
      setNavigationHistory(newHistory);
      setCurrentHistoryPosition(newHistory.length - 1);
      setCanGoBack(true);
      setCanGoForward(false);
    }
  };

  // Display loading state
  if (loading) {
    return (
      <div className="flex flex-col h-full relative">
        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 bg-gray-50 dark:bg-gray-950">
          <div className="relative w-5 h-5 animate-spin">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-primary rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-primary rounded-full opacity-80"></div>
            <div className="absolute bottom-0 right-0 w-2 h-2 bg-primary rounded-full opacity-60"></div>
          </div>
          <p className="text-gray-600 dark:text-gray-300">
            Preparing app preview...
          </p>
        </div>
      </div>
    );
  }

  // Display message if no app is selected
  if (selectedAppId === null) {
    return (
      <div className="p-4 text-gray-500 dark:text-gray-400">
        Select an app to see the preview.
      </div>
    );
  }

  const onRestart = () => {
    restartApp();
  };

  // Convert null to undefined for iframe src prop compatibility
  const iframeSrc = currentIframeUrlRef.current ?? appUrl ?? undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Browser-style header - hide when annotator is active */}
      {!annotatorMode && (
        <div className="flex items-center p-2 border-b space-x-2">
          {/* Navigation Buttons */}
          <div className="flex space-x-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setIsChatPanelHidden(!isChatPanelHidden)}
                    className="p-1 rounded transition-colors duration-200 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                    data-testid="preview-toggle-chat-panel-button"
                  />
                }
              >
                {isChatPanelHidden ? (
                  <Maximize2 size={16} />
                ) : (
                  <Minimize2 size={16} />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {isChatPanelHidden ? "Show chat" : "Hide chat"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={handleActivateComponentSelector}
                    className={`p-1 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                      isPicking
                        ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
                        : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900"
                    }`}
                    disabled={
                      loading ||
                      !selectedAppId ||
                      !isComponentSelectorInitialized
                    }
                    data-testid="preview-pick-element-button"
                  />
                }
              >
                <MousePointerClick size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isPicking
                  ? "Deactivate component selector"
                  : `Select component (${isMac ? "⌘ + ⇧ + C" : "Ctrl + ⇧ + C"})`}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={handleAnnotatorClick}
                    className={`p-1 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                      annotatorMode
                        ? "bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700"
                        : " text-purple-700 hover:bg-purple-200  dark:text-purple-300 dark:hover:bg-purple-900"
                    }`}
                    disabled={
                      loading ||
                      !selectedAppId ||
                      isPicking ||
                      !isComponentSelectorInitialized
                    }
                    data-testid="preview-annotator-button"
                  />
                }
              >
                <Pen size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {annotatorMode ? "Annotator mode active" : "Activate annotator"}
              </TooltipContent>
            </Tooltip>
            <button
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-300"
              disabled={!canGoBack || loading || !selectedAppId}
              onClick={handleNavigateBack}
              data-testid="preview-navigate-back-button"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-300"
              disabled={!canGoForward || loading || !selectedAppId}
              onClick={handleNavigateForward}
              data-testid="preview-navigate-forward-button"
            >
              <ArrowRight size={16} />
            </button>
            <button
              onClick={handleReload}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-300"
              disabled={loading || !selectedAppId}
              data-testid="preview-refresh-button"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Address Bar with Routes Dropdown - using shadcn/ui dropdown-menu */}
          <div className="relative flex-grow min-w-20">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center justify-between px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200 cursor-pointer w-full min-w-0">
                <span
                  className="truncate flex-1 mr-2 min-w-0"
                  data-testid="preview-address-bar-path"
                >
                  {navigationHistory[currentHistoryPosition]
                    ? new URL(navigationHistory[currentHistoryPosition])
                        .pathname
                    : "/"}
                </span>
                <ChevronDown size={14} className="flex-shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                {availableRoutes.length > 0 ? (
                  availableRoutes.map((route) => (
                    <DropdownMenuItem
                      key={route.path}
                      onClick={() => navigateToRoute(route.path)}
                      className="flex justify-between"
                    >
                      <span>{route.label}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">
                        {route.path}
                      </span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    Loading routes...
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={onRestart}
                    className="flex items-center space-x-1 px-3 py-1 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
                  />
                }
              >
                <Power size={16} />
                <span>Restart</span>
              </TooltipTrigger>
              <TooltipContent>Restart App</TooltipContent>
            </Tooltip>
            <button
              data-testid="preview-open-browser-button"
              onClick={() => {
                if (originalUrl) {
                  ipc.system.openExternalUrl(originalUrl);
                }
              }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-300"
            >
              <ExternalLink size={16} />
            </button>

            {/* Device Mode Button */}
            <Popover open={isDevicePopoverOpen} modal={false}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      data-testid="device-mode-button"
                      onClick={() => {
                        // Toggle popover open/close
                        if (isDevicePopoverOpen)
                          updateSettings({ previewDeviceMode: "desktop" });
                        setIsDevicePopoverOpen(!isDevicePopoverOpen);
                      }}
                      className={cn(
                        "p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-gray-300",
                        deviceMode !== "desktop" &&
                          "bg-gray-200 dark:bg-gray-700",
                      )}
                    />
                  }
                >
                  <MonitorSmartphone size={16} />
                </TooltipTrigger>
                <TooltipContent>Device Mode</TooltipContent>
              </Tooltip>
              <PopoverContent className="w-auto p-2">
                <ToggleGroup
                  value={[deviceMode]}
                  onValueChange={(value) => {
                    if (value && value.length > 0) {
                      updateSettings({
                        previewDeviceMode: value[
                          value.length - 1
                        ] as DeviceMode,
                      });
                      setIsDevicePopoverOpen(false);
                    }
                  }}
                  variant="outline"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ToggleGroupItem
                          value="desktop"
                          aria-label="Desktop view"
                        />
                      }
                    >
                      <Monitor size={16} />
                    </TooltipTrigger>
                    <TooltipContent>Desktop</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ToggleGroupItem
                          value="tablet"
                          aria-label="Tablet view"
                        />
                      }
                    >
                      <Tablet size={16} className="scale-x-130" />
                    </TooltipTrigger>
                    <TooltipContent>Tablet</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ToggleGroupItem
                          value="mobile"
                          aria-label="Mobile view"
                        />
                      }
                    >
                      <Smartphone size={16} />
                    </TooltipTrigger>
                    <TooltipContent>Mobile</TooltipContent>
                  </Tooltip>
                </ToggleGroup>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      <div className="relative flex-grow overflow-hidden">
        <ErrorBanner
          error={errorMessage}
          onDismiss={() => setErrorMessage(undefined)}
          onAIFix={() => {
            if (selectedChatId) {
              streamMessage({
                prompt: `Fix error: ${errorMessage?.message}`,
                chatId: selectedChatId,
              });
            }
          }}
        />

        {!appUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 bg-gray-50 dark:bg-gray-950">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
            <p className="text-gray-600 dark:text-gray-300">
              Starting your app server...
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "w-full h-full",
              deviceMode !== "desktop" && "flex justify-center",
            )}
          >
            {annotatorMode && screenshotDataUrl ? (
              <div
                className="w-full h-full bg-white dark:bg-gray-950"
                style={
                  deviceMode == "desktop"
                    ? {}
                    : { width: `${deviceWidthConfig[deviceMode]}px` }
                }
              >
                {userBudget ? (
                  <Annotator
                    screenshotUrl={screenshotDataUrl}
                    onSubmit={addAttachments}
                    handleAnnotatorClick={handleAnnotatorClick}
                  />
                ) : (
                  <AnnotatorOnlyForPro
                    onGoBack={() => setAnnotatorMode(false)}
                  />
                )}
              </div>
            ) : (
              <>
                <iframe
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-downloads"
                  data-testid="preview-iframe-element"
                  onLoad={() => {
                    setErrorMessage(undefined);
                    // Note: We don't clear currentIframeUrlRef - it tracks the URL the iframe is showing
                    // This prevents re-renders from accidentally changing the iframe src
                  }}
                  ref={iframeRef}
                  key={reloadKey}
                  title={`Preview for App ${selectedAppId}`}
                  className="w-full h-full border-none bg-white dark:bg-gray-950"
                  style={
                    deviceMode == "desktop"
                      ? {}
                      : { width: `${deviceWidthConfig[deviceMode]}px` }
                  }
                  src={iframeSrc}
                  allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; display-capture; geolocation; autoplay; picture-in-picture"
                />
                {/* Visual Editing Toolbar */}
                {isProMode &&
                  visualEditingSelectedComponent &&
                  selectedAppId && (
                    <VisualEditingToolbar
                      selectedComponent={visualEditingSelectedComponent}
                      iframeRef={iframeRef}
                      isDynamic={isDynamicComponent}
                      hasStaticText={hasStaticText}
                    />
                  )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function parseComponentSelection(data: any): ComponentSelection | null {
  if (!data || data.type !== "dyad-component-selected") {
    return null;
  }

  const component = data.component;
  if (
    !component ||
    typeof component.id !== "string" ||
    typeof component.name !== "string"
  ) {
    return null;
  }

  const { id, name, runtimeId } = component;

  // The id is expected to be in the format "filepath:line:column"
  const parts = id.split(":");
  if (parts.length < 3) {
    console.error(`Invalid component selection id format: "${id}"`);
    return null;
  }

  const columnStr = parts.pop();
  const lineStr = parts.pop();
  const relativePath = parts.join(":");

  if (!columnStr || !lineStr || !relativePath) {
    console.error(`Could not parse component selection from id: "${id}"`);
    return null;
  }

  const lineNumber = parseInt(lineStr, 10);
  const columnNumber = parseInt(columnStr, 10);

  if (isNaN(lineNumber) || isNaN(columnNumber)) {
    console.error(`Could not parse line/column from id: "${id}"`);
    return null;
  }

  return {
    id,
    name,
    runtimeId,
    relativePath: normalizePath(relativePath),
    lineNumber,
    columnNumber,
  };
}
