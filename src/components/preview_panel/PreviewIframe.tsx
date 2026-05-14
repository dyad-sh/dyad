import {
  selectedAppIdAtom,
  appUrlAtom,
  appConsoleEntriesAtom,
  previewErrorMessageAtom,
  previewCurrentUrlAtom,
} from "@/atoms/appAtoms";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Cloud,
  Cog,
  Loader2,
  X,
  Sparkles,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  MousePointerClick,
  Power,
  MonitorSmartphone,
  Monitor,
  Tablet,
  Smartphone,
  Pen,
  MoreVertical,
  Trash2,
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
  isRestoringQueuedSelectionAtom,
  pendingScreenshotAppIdAtom,
} from "@/atoms/previewAtoms";
import { isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { ComponentSelection } from "@/ipc/types";
import { mergePendingChange } from "@/ipc/types/visual-editing";
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
import { showError, showSuccess } from "@/lib/toast";
import type { DeviceMode } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { AnnotatorOnlyForPro } from "./AnnotatorOnlyForPro";
import { useAttachments } from "@/hooks/useAttachments";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { Annotator } from "@/pro/ui/components/Annotator/Annotator";
import { VisualEditingToolbar } from "./VisualEditingToolbar";
import { resolvePreviewBrowserUrl } from "./previewBrowserUrl";
import { PreviewToolbar } from "./PreviewToolbar";
import { useTranslation } from "react-i18next";

interface ErrorBannerProps {
  error:
    | {
        message: string;
        source: "preview-app" | "dyad-app" | "dyad-sync";
      }
    | undefined;
  onDismiss: () => void;
  onAIFix: () => void;
}

const ErrorBanner = ({ error, onDismiss, onAIFix }: ErrorBannerProps) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const { isStreaming } = useStreamChat();
  if (!error) return null;
  const isDockerError = error.message.includes("Cannot connect to the Docker");
  const isInternalDyadError = error.source === "dyad-app";
  const isSyncError = error.source === "dyad-sync";

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

      {(isInternalDyadError || isSyncError) && (
        <div className="absolute top-1 right-1 p-1 bg-red-100 dark:bg-red-900 rounded-md text-xs font-medium text-red-700 dark:text-red-300">
          {isSyncError ? "Cloud sync issue" : "Internal Dyad error"}
        </div>
      )}

      {/* Error message in the middle */}
      <div
        className={cn(
          "px-6 py-1 text-sm",
          (isInternalDyadError || isSyncError) && "pt-6",
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
              : isSyncError
                ? "Dyad could not upload your latest local changes to the cloud sandbox. Check your network connection or wait for sync to recover."
                : isInternalDyadError
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

const SCREENSHOT_CAPTURE_DELAY_MS = 3_000;

// Preview iframe component
export const PreviewIframe = ({ loading }: { loading: boolean }) => {
  const { t } = useTranslation("home");
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { appUrl, originalUrl, mode } = useAtomValue(appUrlAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  // State to trigger iframe reload
  const [reloadKey, setReloadKey] = useState(0);
  const [errorMessage, setErrorMessage] = useAtom(previewErrorMessageAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const {
    routes: availableRoutes,
    loading: routesLoading,
    error: routesError,
  } = useParseRouter(selectedAppId);
  const { restartApp, refreshAppIframe } = useRunApp();
  const { settings, updateSettings } = useSettings();
  const { userBudget } = useUserBudgetInfo();
  const isProMode = !!userBudget;
  const queryClient = useQueryClient();

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
  const [selectedComponentsPreview, setSelectedComponentsPreview] = useAtom(
    selectedComponentsPreviewAtom,
  );
  const [isRestoringQueuedSelection, setIsRestoringQueuedSelection] = useAtom(
    isRestoringQueuedSelectionAtom,
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
  const [pendingScreenshotAppId, setPendingScreenshotAppId] = useAtom(
    pendingScreenshotAppIdAtom,
  );
  const pendingScreenshotAppIdRef = useRef<number | null>(null);
  // Track the latest screenshot requests so stale responses from earlier reloads
  // don't get mistaken for annotator screenshots.
  const pendingCommitScreenshotRequestRef = useRef<{
    appId: number;
    requestId: string;
    commitHash: string;
  } | null>(null);
  const pendingAnnotatorScreenshotRequestIdRef = useRef<string | null>(null);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read the latest selected app inside the capture timeout so the bail-out
  // check compares against the current selection, not a stale render closure.
  const selectedAppIdRef = useRef<number | null>(selectedAppId);
  // Track which apps have already had the on-load fallback attempted this
  // session so the check doesn't re-run on every HMR/reload.
  const fallbackAttemptedAppIdsRef = useRef<Set<number>>(new Set());

  // Keep refs in sync so the message handler and timeout callbacks always read
  // the latest values.
  useEffect(() => {
    pendingScreenshotAppIdRef.current = pendingScreenshotAppId;
  }, [pendingScreenshotAppId]);

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  // Drop any in-flight request state when the user switches apps so a stale
  // guard from a replaced iframe doesn't block future captures.
  useEffect(() => {
    pendingCommitScreenshotRequestRef.current = null;
    if (captureTimeoutRef.current !== null) {
      clearTimeout(captureTimeoutRef.current);
      captureTimeoutRef.current = null;
    }
  }, [selectedAppId]);

  // Clean up pending screenshot timeout on unmount
  useEffect(() => {
    return () => {
      if (captureTimeoutRef.current !== null) {
        clearTimeout(captureTimeoutRef.current);
        captureTimeoutRef.current = null;
      }
    };
  }, []);

  const captureScreenshot = (appId: number) => {
    // If a capture is already scheduled, let it run — repeated triggers
    // (HMR, onLoad, selector-initialized) shouldn't endlessly extend the wait.
    if (captureTimeoutRef.current !== null) {
      return;
    }

    // Wait for page animations to finish before capturing.
    captureTimeoutRef.current = setTimeout(async () => {
      captureTimeoutRef.current = null;
      // Bail out if the user switched to a different app during the delay.
      // Read from a ref so the comparison uses the current selection, not the
      // render closure that scheduled this timeout.
      if (selectedAppIdRef.current !== appId) {
        if (pendingScreenshotAppIdRef.current === appId) {
          setPendingScreenshotAppId(null);
        }
        return;
      }
      // Re-read contentWindow inside the timeout to avoid stale references
      // (e.g. if the iframe reloads or gets replaced during the delay).
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow) {
        if (pendingScreenshotAppIdRef.current === appId) {
          setPendingScreenshotAppId(null);
        }
        return;
      }
      // Resolve the commit hash at capture time so the saved screenshot
      // corresponds to the current HEAD and not to a later commit that may
      // land before the iframe responds with the image.
      let commitHash: string | null = null;
      try {
        const result = await ipc.app.getCurrentCommitHash({ appId });
        commitHash = result.commitHash;
      } catch (err) {
        console.warn("Failed to resolve commit hash for screenshot", err);
      }
      if (!commitHash) {
        if (pendingScreenshotAppIdRef.current === appId) {
          setPendingScreenshotAppId(null);
        }
        return;
      }
      // The user may have switched apps while resolving the commit hash.
      if (selectedAppIdRef.current !== appId) {
        if (pendingScreenshotAppIdRef.current === appId) {
          setPendingScreenshotAppId(null);
        }
        return;
      }
      const requestId = crypto.randomUUID();
      pendingCommitScreenshotRequestRef.current = {
        appId,
        requestId,
        commitHash,
      };
      contentWindow.postMessage(
        { type: "dyad-take-screenshot", requestId },
        "*",
      );
    }, SCREENSHOT_CAPTURE_DELAY_MS);
  };

  const requestCommitScreenshot = () => {
    if (
      pendingScreenshotAppIdRef.current === null ||
      pendingScreenshotAppIdRef.current !== selectedAppId ||
      !iframeRef.current?.contentWindow
    ) {
      return;
    }

    captureScreenshot(selectedAppId);
  };

  const requestAnnotatorScreenshot = () => {
    if (!iframeRef.current?.contentWindow) {
      return;
    }

    const requestId = crypto.randomUUID();
    pendingAnnotatorScreenshotRequestIdRef.current = requestId;
    iframeRef.current.contentWindow.postMessage(
      { type: "dyad-take-screenshot", requestId },
      "*",
    );
  };

  // AST Analysis State
  const [isDynamicComponent, setIsDynamicComponent] = useState(false);
  const [hasStaticText, setHasStaticText] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [isDynamicImage, setIsDynamicImage] = useState(false);
  const [currentImageSrc, setCurrentImageSrc] = useState("");

  // Device mode state
  const deviceMode: DeviceMode = settings?.previewDeviceMode ?? "desktop";
  const [isDevicePopoverOpen, setIsDevicePopoverOpen] = useState(false);
  const {
    mutateAsync: createCloudSandboxShareLink,
    isPending: isCreatingCloudSandboxShareLink,
  } = useMutation({
    mutationFn: async ({ appId }: { appId: number }) => {
      return ipc.app.createCloudSandboxShareLink({ appId });
    },
  });

  // Device configurations
  const deviceWidthConfig = {
    tablet: 768,
    mobile: 375,
  };

  //detect if the user is using Mac
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isCloudMode = mode === "cloud";
  const isCloudSandboxMode = settings?.runtimeMode2 === "cloud";
  const { mutate: clearSessionData } = useMutation({
    mutationFn: () => {
      return ipc.system.clearSessionData();
    },
    onSuccess: async () => {
      await refreshAppIframe();
      showSuccess("Preview data cleared");
    },
    onError: (error) => {
      showError(`Error clearing preview data: ${error}`);
    },
  });
  const { data: cloudSandboxStatus } = useQuery({
    queryKey: queryKeys.cloudSandboxes.status({ appId: selectedAppId }),
    queryFn: async () => {
      if (selectedAppId === null) {
        return null;
      }
      return ipc.app.getCloudSandboxStatus({ appId: selectedAppId });
    },
    enabled: isCloudMode && selectedAppId !== null,
    refetchInterval: 15_000,
    retry: false,
  });

  useEffect(() => {
    if (!isCloudMode || !cloudSandboxStatus) {
      return;
    }

    if (
      cloudSandboxStatus.status === "destroyed" &&
      (cloudSandboxStatus.terminationReason === "credits_exhausted" ||
        cloudSandboxStatus.terminationReason === "billing_unavailable" ||
        cloudSandboxStatus.lastErrorCode === "sandbox_credits_exhausted" ||
        cloudSandboxStatus.lastErrorCode === "sandbox_billing_unavailable")
    ) {
      setErrorMessage({
        message: cloudSandboxStatus.lastErrorMessage
          ? cloudSandboxStatus.lastErrorMessage.includes("Dyad stopped")
            ? cloudSandboxStatus.lastErrorMessage
            : cloudSandboxStatus.terminationReason === "credits_exhausted"
              ? "This cloud sandbox was stopped because your Dyad Pro credits ran out. Add credits and start it again."
              : "This cloud sandbox was stopped because Dyad could not confirm billing. Please try starting it again."
          : cloudSandboxStatus.terminationReason === "credits_exhausted"
            ? "This cloud sandbox was stopped because your Dyad Pro credits ran out. Add credits and start it again."
            : "This cloud sandbox was stopped because Dyad could not confirm billing. Please try starting it again.",
        source: "dyad-app",
      });
    }
  }, [cloudSandboxStatus, isCloudMode, setErrorMessage]);

  useEffect(() => {
    if (!isCloudMode || !cloudSandboxStatus) {
      return;
    }

    const localSyncErrorMessage = cloudSandboxStatus.localSyncErrorMessage;

    if (localSyncErrorMessage) {
      setErrorMessage((current) =>
        current && current.source !== "dyad-sync"
          ? current
          : {
              message: localSyncErrorMessage,
              source: "dyad-sync",
            },
      );
      return;
    }

    setErrorMessage((current) =>
      current?.source === "dyad-sync" ? undefined : current,
    );
  }, [cloudSandboxStatus, isCloudMode, setErrorMessage]);

  useEffect(() => {
    if (!isCloudMode || !cloudSandboxStatus) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: queryKeys.userBudget.info,
    });
  }, [
    cloudSandboxStatus?.billingSlicesCharged,
    cloudSandboxStatus?.terminationReason,
    isCloudMode,
    queryClient,
  ]);

  const analyzeComponent = async (componentId: string) => {
    if (!componentId || !selectedAppId) return;

    try {
      const result = await ipc.visualEditing.analyzeComponent({
        appId: selectedAppId,
        componentId,
      });
      setIsDynamicComponent(result.isDynamic);
      setHasStaticText(result.hasStaticText);
      setHasImage(result.hasImage);
      setIsDynamicImage(result.isDynamicImage || false);
      setCurrentImageSrc(result.imageSrc || "");

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
      setHasImage(false);
      setIsDynamicImage(false);
      setCurrentImageSrc("");
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

      updated.set(
        componentId,
        mergePendingChange(existing, {
          componentId,
          componentName:
            existing?.componentName ||
            visualEditingSelectedComponent?.name ||
            "",
          relativePath: filePath,
          lineNumber,
          textContent: text,
        }),
      );

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

  // Restore component overlays in iframe only during queued-message edit restoration.
  // Normal interactive selections are already handled by the iframe's own click handler,
  // so we guard this effect to avoid redundant clear-and-restore round-trips.
  useEffect(() => {
    if (!isRestoringQueuedSelection) return;
    if (!iframeRef.current?.contentWindow || !isComponentSelectorInitialized) {
      return;
    }
    // Clear the flag before sending so it doesn't re-trigger
    setIsRestoringQueuedSelection(false);
    if (selectedComponentsPreview.length === 0) {
      iframeRef.current.contentWindow.postMessage(
        { type: "clear-dyad-component-overlays" },
        "*",
      );
      return;
    }
    iframeRef.current.contentWindow.postMessage(
      {
        type: "restore-dyad-component-overlays",
        componentIds: selectedComponentsPreview.map((c) => c.id),
      },
      "*",
    );
  }, [
    isRestoringQueuedSelection,
    selectedComponentsPreview,
    isComponentSelectorInitialized,
    setIsRestoringQueuedSelection,
  ]);

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

        // Take a screenshot if a commit just happened for this app.
        // Read from ref to avoid stale closure issues.
        if (
          pendingScreenshotAppIdRef.current !== null &&
          pendingScreenshotAppIdRef.current === selectedAppId &&
          iframeRef.current?.contentWindow
        ) {
          requestCommitScreenshot();
        } else if (
          selectedAppId !== null &&
          iframeRef.current?.contentWindow &&
          captureTimeoutRef.current === null &&
          pendingCommitScreenshotRequestRef.current === null &&
          !fallbackAttemptedAppIdsRef.current.has(selectedAppId)
        ) {
          // No pending commit screenshot and no capture already in flight —
          // check if the app already has a screenshot on disk. If not (e.g.
          // iframe was still loading when earlier commits happened), capture
          // one now. Only attempt once per app per session so repeated HMR
          // reloads don't spam capture attempts for apps whose saves fail.
          const appId = selectedAppId;
          fallbackAttemptedAppIdsRef.current.add(appId);
          ipc.app
            .listAppScreenshots({ appId })
            .then((result) => {
              // Guard against app switches while this promise was in flight —
              // otherwise the stale callback would occupy `captureTimeoutRef`
              // for the old app and block the current app's commit-triggered
              // captures.
              if (selectedAppIdRef.current !== appId) {
                return;
              }
              if (result.screenshots.length === 0) {
                captureScreenshot(appId);
              }
            })
            .catch(() => {
              // Ignore — screenshot check is best-effort
            });
        }
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

      if (event.data?.type === "dyad-image-load-error") {
        showError("Image failed to load. Please check the URL and try again.");
        // Remove the broken image from pending changes
        const { elementId } = event.data;
        if (elementId) {
          setPendingChanges((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(elementId);
            if (existing?.imageSrc) {
              const hasStyles =
                existing.styles && Object.keys(existing.styles).length > 0;
              if (!hasStyles && !existing.textContent) {
                // No other changes, remove entirely
                updated.delete(elementId);
              } else {
                // Keep the entry but remove image data
                updated.set(elementId, {
                  ...existing,
                  imageSrc: undefined,
                  imageUpload: undefined,
                });
              }
            }
            return updated;
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
        const requestId =
          typeof event.data.requestId === "string"
            ? event.data.requestId
            : null;
        const pendingCommitScreenshotRequest =
          pendingCommitScreenshotRequestRef.current;

        if (
          requestId !== null &&
          pendingCommitScreenshotRequest !== null &&
          requestId === pendingCommitScreenshotRequest.requestId
        ) {
          const appId = pendingCommitScreenshotRequest.appId;
          const commitHash = pendingCommitScreenshotRequest.commitHash;
          pendingCommitScreenshotRequestRef.current = null;
          // Only clear the pending-screenshot atom if it still points to the
          // same app — otherwise another flow may have queued a newer capture
          // for a different app and we'd erase its pending state.
          const clearPendingIfMatches = () => {
            if (pendingScreenshotAppIdRef.current === appId) {
              setPendingScreenshotAppId(null);
            }
          };
          if (event.data.success && event.data.dataUrl) {
            console.debug("App screenshot taken for app", appId);
            clearPendingIfMatches();
            ipc.app
              .saveAppScreenshot({
                appId,
                dataUrl: event.data.dataUrl,
                commitHash,
              })
              .then(() =>
                queryClient.invalidateQueries({
                  queryKey: queryKeys.apps.screenshots({ appId }),
                }),
              )
              .then(() =>
                queryClient.invalidateQueries({
                  queryKey: queryKeys.apps.thumbnails,
                }),
              )
              .catch((err: unknown) => {
                console.error("Failed to save app screenshot:", err);
              });
          } else {
            console.warn("App screenshot capture failed for app", appId);
            clearPendingIfMatches();
          }
          return;
        }

        if (
          requestId !== null &&
          requestId === pendingAnnotatorScreenshotRequestIdRef.current
        ) {
          pendingAnnotatorScreenshotRequestIdRef.current = null;
          if (event.data.success && event.data.dataUrl) {
            setScreenshotDataUrl(event.data.dataUrl);
            setAnnotatorMode(true);
          } else {
            showError(event.data.error);
          }
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
        // Resolve relative URLs against the app's base URL so that all
        // entries in navigationHistory are always absolute URLs.
        let resolvedUrl = payload?.newUrl;
        if (resolvedUrl) {
          try {
            resolvedUrl = new URL(resolvedUrl, appUrl ?? undefined).href;
          } catch {
            // If it can't be resolved at all, keep the raw value
          }
        }

        // Update navigation history based on the type of state change
        if (type === "pushState" && resolvedUrl) {
          // For pushState, we trim any forward history and add the new URL
          const newHistory = [
            ...navigationHistory.slice(0, currentHistoryPosition + 1),
            resolvedUrl,
          ];
          setNavigationHistory(newHistory);
          setCurrentHistoryPosition(newHistory.length - 1);
          // Update the current iframe URL ref to match the navigation
          currentIframeUrlRef.current = resolvedUrl;
          // Preserve URL for HMR remounts - only if it's a different route from root
          // Compare origins and check if there's a meaningful path
          if (selectedAppId && appUrl) {
            try {
              const newUrlObj = new URL(resolvedUrl);
              const appUrlObj = new URL(appUrl);
              // Only preserve if there's a non-root path
              if (
                newUrlObj.origin === appUrlObj.origin &&
                newUrlObj.pathname !== "/" &&
                newUrlObj.pathname !== ""
              ) {
                setPreservedUrls((prev) => ({
                  ...prev,
                  [selectedAppId]: resolvedUrl,
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
        } else if (type === "replaceState" && resolvedUrl) {
          // For replaceState, we replace the current URL
          const newHistory = [...navigationHistory];
          newHistory[currentHistoryPosition] = resolvedUrl;
          setNavigationHistory(newHistory);
          // Update the current iframe URL ref to match the navigation
          currentIframeUrlRef.current = resolvedUrl;
          // Preserve URL for HMR remounts - only if it's a different route from root
          if (selectedAppId && appUrl) {
            try {
              const newUrlObj = new URL(resolvedUrl);
              const appUrlObj = new URL(appUrl);
              // Only preserve if there's a non-root path
              if (
                newUrlObj.origin === appUrlObj.origin &&
                newUrlObj.pathname !== "/" &&
                newUrlObj.pathname !== ""
              ) {
                setPreservedUrls((prev) => ({
                  ...prev,
                  [selectedAppId]: resolvedUrl,
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
    queryClient,
    setPendingScreenshotAppId,
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
      requestAnnotatorScreenshot();
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

      // Use postMessage to navigate (same as back/forward) - this uses location.replace()
      // which provides smooth navigation without the black screen flicker that location.href causes
      iframeRef.current.contentWindow.postMessage(
        {
          type: "navigate",
          payload: { url: newUrl },
        },
        "*",
      );

      // Update navigation history
      const newHistory = [
        ...navigationHistory.slice(0, currentHistoryPosition + 1),
        newUrl,
      ];
      setNavigationHistory(newHistory);
      setCurrentHistoryPosition(newHistory.length - 1);
      setCanGoBack(true);
      setCanGoForward(false);

      // Update iframe URL ref to match
      currentIframeUrlRef.current = newUrl;

      // Update preservedUrls to match navigation (for HMR remounts)
      if (selectedAppId) {
        // Clear preserved URL if navigating to root, otherwise update it
        if (path === "/" || path === "") {
          setPreservedUrls((prev) => {
            const newUrls = { ...prev };
            delete newUrls[selectedAppId];
            return newUrls;
          });
        } else {
          setPreservedUrls((prev) => ({
            ...prev,
            [selectedAppId]: newUrl,
          }));
        }
      }
    }
  };

  // Freeze iframe src between remounts so in-iframe SPA navigation (pushState/replaceState)
  // doesn't cause React to set a new src and trigger a second full navigation flicker.
  const iframeSrc = useMemo(() => {
    if (!appUrl) {
      return undefined;
    }

    const currentUrl = currentIframeUrlRef.current;
    if (!currentUrl) {
      return appUrl;
    }

    try {
      const currentOrigin = new URL(currentUrl).origin;
      const appOrigin = new URL(appUrl).origin;
      return currentOrigin === appOrigin ? currentUrl : appUrl;
    } catch {
      return appUrl;
    }
  }, [appUrl, reloadKey, selectedAppId]);

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

  const onCleanRestart = () => {
    restartApp({ removeNodeModules: true });
  };

  const onRecreateSandbox = () => {
    restartApp({ recreateSandbox: true });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Browser-style header - hide when annotator is active */}
      {!annotatorMode && (
        <PreviewToolbar>
          {/* Browser navigation group */}
          <div className="flex items-center space-x-2 ml-auto">
            {isCloudMode && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      aria-label="Running in a cloud sandbox"
                      className="flex items-center rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                      data-testid="preview-cloud-badge"
                      role="status"
                    />
                  }
                >
                  <Cloud size={14} />
                </TooltipTrigger>
                <TooltipContent>Running in a Cloud sandbox</TooltipContent>
              </Tooltip>
            )}
            <div className="flex items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full p-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
                      disabled={!canGoBack || loading || !selectedAppId}
                      onClick={handleNavigateBack}
                      data-testid="preview-navigate-back-button"
                      aria-label="Navigate back"
                    />
                  }
                >
                  <ArrowLeft size={16} />
                </TooltipTrigger>
                <TooltipContent>Navigate back</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
                      disabled={!canGoForward || loading || !selectedAppId}
                      onClick={handleNavigateForward}
                      data-testid="preview-navigate-forward-button"
                      aria-label="Navigate forward"
                    />
                  }
                >
                  <ArrowRight size={16} />
                </TooltipTrigger>
                <TooltipContent>Navigate forward</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Address Bar - white pill with device mode, refresh + external inside */}
          <div className="relative w-1/2 min-w-20 flex items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-1 pr-1">
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
                        "flex-shrink-0 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300",
                        deviceMode !== "desktop" &&
                          "bg-gray-200 dark:bg-gray-700",
                      )}
                    />
                  }
                >
                  <MonitorSmartphone size={14} />
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
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center flex-1 min-w-[2rem] py-1 pl-2 pr-1 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <span
                  className="truncate flex-1 min-w-0 text-left"
                  data-testid="preview-address-bar-path"
                >
                  {(() => {
                    try {
                      return new URL(navigationHistory[currentHistoryPosition])
                        .pathname;
                    } catch {
                      return "/";
                    }
                  })()}
                </span>
                <ChevronDown
                  size={12}
                  className="flex-shrink-0 ml-1 opacity-50"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                {routesLoading ? (
                  <DropdownMenuItem disabled>
                    Loading routes...
                  </DropdownMenuItem>
                ) : routesError ? (
                  <DropdownMenuItem disabled>
                    Unable to load routes
                  </DropdownMenuItem>
                ) : availableRoutes.length > 0 ? (
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
                    No routes detected
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={handleReload}
                    className="flex-shrink-0 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
                    disabled={loading || !selectedAppId}
                    data-testid="preview-refresh-button"
                    aria-label="Refresh preview"
                  />
                }
              >
                <RefreshCw size={14} />
              </TooltipTrigger>
              <TooltipContent>Refresh preview</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    data-testid="preview-open-browser-button"
                    aria-label="Open in browser"
                    onClick={async () => {
                      try {
                        const url = await resolvePreviewBrowserUrl({
                          isCloudMode,
                          selectedAppId,
                          originalUrl,
                          createCloudSandboxShareLink,
                        });
                        await ipc.system.openExternalUrl(url);
                      } catch (error) {
                        showError(
                          error instanceof Error
                            ? error.message
                            : "Failed to open cloud sandbox share link.",
                        );
                      }
                    }}
                    disabled={
                      isCloudMode
                        ? selectedAppId === null ||
                          isCreatingCloudSandboxShareLink
                        : !originalUrl
                    }
                    className="flex-shrink-0 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
                  />
                }
              >
                <ExternalLink size={14} />
              </TooltipTrigger>
              <TooltipContent>Open in browser</TooltipContent>
            </Tooltip>
          </div>

          {/* Right action group - restart, editing tools, panel toggle */}
          <div className="flex items-center space-x-1 ml-auto pl-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={onRestart}
                    data-testid="preview-restart-button"
                    aria-label={
                      isCloudMode ? "Restart Cloud Sandbox" : "Restart"
                    }
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                  />
                }
              >
                <Power size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isCloudMode ? "Restart Cloud Sandbox" : "Restart App"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={handleActivateComponentSelector}
                    aria-label={
                      isPicking
                        ? "Deactivate component selector"
                        : "Select component"
                    }
                    aria-pressed={isPicking}
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
                    aria-label={
                      annotatorMode
                        ? "Annotator mode active"
                        : "Activate annotator"
                    }
                    aria-pressed={annotatorMode}
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setIsChatPanelHidden(!isChatPanelHidden)}
                    aria-label={isChatPanelHidden ? "Show chat" : "Hide chat"}
                    aria-pressed={isChatPanelHidden}
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
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="preview-more-options-button"
                aria-label={t("preview.moreOptions")}
                className="p-1 rounded transition-colors duration-200 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                <MoreVertical size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={onCleanRestart}>
                  <Cog size={16} />
                  <div className="flex flex-col">
                    <span>{t("preview.rebuild")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("preview.rebuildDescription")}
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => clearSessionData()}>
                  <Trash2 size={16} />
                  <div className="flex flex-col">
                    <span>{t("preview.clearCache")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("preview.clearCacheDescription")}
                    </span>
                  </div>
                </DropdownMenuItem>
                {isCloudSandboxMode && (
                  <DropdownMenuItem onClick={onRecreateSandbox}>
                    <Cog size={16} />
                    <div className="flex flex-col">
                      <span>Recreate Sandbox</span>
                      <span className="text-xs text-muted-foreground">
                        Destroys the current sandbox and creates a new one
                      </span>
                    </div>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PreviewToolbar>
      )}

      <div className="relative flex-grow overflow-hidden">
        {loading ? (
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
        ) : (
          <>
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
                        requestCommitScreenshot();
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
                          hasImage={hasImage}
                          isDynamicImage={isDynamicImage}
                          currentImageSrc={currentImageSrc}
                        />
                      )}
                  </>
                )}
              </div>
            )}
          </>
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
