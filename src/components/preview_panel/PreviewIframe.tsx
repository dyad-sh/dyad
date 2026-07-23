import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  currentAppUrlAtom,
  currentPreviewErrorAtom,
  setPreviewErrorForAppAtom,
  type PreviewErrorUpdate,
} from "@/atoms/previewRuntimeAtoms";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Cloud,
  Cog,
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
} from "lucide-react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import { ipc } from "@/ipc/types";

import { useParseRouter } from "@/hooks/useParseRouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  boundPreviewConsoleEntry,
  formatPreviewConsoleMessage,
  formatPreviewNetworkStatus,
} from "@/lib/preview_console_buffer";
import { queryKeys } from "@/lib/queryKeys";
import { AnnotatorOnlyForPro } from "./AnnotatorOnlyForPro";
import { useAttachments } from "@/hooks/useAttachments";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { Annotator } from "@/pro/ui/components/Annotator/Annotator";
import { VisualEditingToolbar } from "./VisualEditingToolbar";
import { resolvePreviewBrowserUrl } from "./previewBrowserUrl";
import { PreviewLoadingScreen } from "./PreviewLoadingScreen";
import { useTranslation } from "react-i18next";
import {
  formatPreviewAddressPath,
  normalizePreviewAddressPath,
} from "./previewAddressPath";
import { getPreviewToolbarActionVisibility } from "./previewToolbarLayout";
import { usePreviewIframe } from "@/preview_iframe/usePreviewIframe";
import { selectCanGoBack, selectCanGoForward } from "@/preview_iframe/state";
import {
  useScreenshot,
  type ScreenshotAdapterEvent,
} from "@/screenshot/useScreenshot";

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

const PREVIEW_TOOLBAR_BUTTON_CLASSES =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40";

// Preview iframe component
export const PreviewIframe = ({ loading }: { loading: boolean }) => {
  const { t } = useTranslation("home");
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { appUrl, originalUrl, mode } = useAtomValue(currentAppUrlAtom);
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const errorMessage = useAtomValue(currentPreviewErrorAtom);
  const setPreviewErrorForApp = useSetAtom(setPreviewErrorForAppAtom);
  const setErrorMessage = useCallback(
    (update: PreviewErrorUpdate) => {
      if (selectedAppId === null) {
        return;
      }
      setPreviewErrorForApp({ appId: selectedAppId, error: update });
    },
    [selectedAppId, setPreviewErrorForApp],
  );
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
  const componentMessageHandlerRef = useRef<(event: MessageEvent) => void>(
    () => undefined,
  );
  const screenshotAdapterHandlerRef = useRef<
    (event: ScreenshotAdapterEvent) => void
  >(() => undefined);
  const {
    state: iframeState,
    send: sendIframeEvent,
    iframeSrc,
    postMessage: postPreviewMessage,
    onIframeLoaded,
  } = usePreviewIframe({
    appId: selectedAppId,
    appUrl,
    iframeRef,
    onSharedMachineEvent: (event) => screenshotAdapterHandlerRef.current(event),
    onComponentMessage: (event) => componentMessageHandlerRef.current(event),
  });
  screenshotAdapterHandlerRef.current = useScreenshot({
    appId: selectedAppId,
    postMessage: postPreviewMessage,
  });
  const navigationHistory = iframeState.history;
  const currentHistoryPosition = iframeState.position;
  const isComponentSelectorInitialized = iframeState.selectorReady;
  const isPicking = iframeState.picking;
  const canGoBack = selectCanGoBack(iframeState);
  const canGoForward = selectCanGoForward(iframeState);
  const [annotatorMode, setAnnotatorMode] = useAtom(annotatorModeAtom);
  const previewToolbarRef = useRef<HTMLDivElement>(null);
  const [previewToolbarWidth, setPreviewToolbarWidth] = useState<number | null>(
    null,
  );
  const [screenshotDataUrl, setScreenshotDataUrl] = useAtom(
    screenshotDataUrlAtom,
  );
  const currentHistoryUrl = navigationHistory[currentHistoryPosition] ?? null;
  const currentAddressPath = formatPreviewAddressPath(currentHistoryUrl);
  const [addressBarValue, setAddressBarValue] = useState(currentAddressPath);
  const [isEditingAddressBar, setIsEditingAddressBar] = useState(false);
  const isEditingAddressBarRef = useRef(false);

  const { addAttachments } = useAttachments();
  const setPendingChanges = useSetAtom(pendingVisualChangesAtom);
  const pendingAnnotatorScreenshotRequestIdRef = useRef<string | null>(null);
  const skipNextAddressBarBlurRef = useRef(false);

  useEffect(() => {
    isEditingAddressBarRef.current = isEditingAddressBar;
  }, [isEditingAddressBar]);

  useLayoutEffect(() => {
    const node = previewToolbarRef.current;
    if (!node) return;

    const updateWidth = () => {
      setPreviewToolbarWidth(Math.floor(node.getBoundingClientRect().width));
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    updateWidth();
    return () => observer.disconnect();
  }, [annotatorMode, selectedAppId]);

  useEffect(() => {
    if (!isEditingAddressBarRef.current) {
      setAddressBarValue(currentAddressPath);
    }
  }, [currentAddressPath]);

  useEffect(() => {
    pendingAnnotatorScreenshotRequestIdRef.current = null;
    setAnnotatorMode(false);
    setScreenshotDataUrl(null);
  }, [selectedAppId]);

  useEffect(() => {
    return () => {
      pendingAnnotatorScreenshotRequestIdRef.current = null;
      setAnnotatorMode(false);
      setScreenshotDataUrl(null);
    };
  }, []);

  const requestAnnotatorScreenshot = () => {
    if (!iframeRef.current?.contentWindow) {
      return;
    }

    const requestId = crypto.randomUUID();
    pendingAnnotatorScreenshotRequestIdRef.current = requestId;
    postPreviewMessage({ type: "dyad-take-screenshot", requestId });
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

  // Component-side postMessage routes. The preview-iframe hook owns the one
  // window listener and claims navigation/selector lifecycle messages before
  // forwarding all other routes here.
  const handleComponentMessage = useCallback(
    (event: MessageEvent) => {
      // Handle console logs from the iframe
      if (event.data?.type === "console-log") {
        const { level } = event.data;
        const rawArgs: unknown = event.data.args;
        const args: unknown[] = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
        const levelLabel =
          level === "log" ||
          level === "warn" ||
          level === "error" ||
          level === "info" ||
          level === "debug"
            ? level.toUpperCase()
            : "LOG";
        const formattedMessage = formatPreviewConsoleMessage(
          `[${levelLabel}]`,
          args,
        );
        const logLevel: "info" | "warn" | "error" =
          level === "error" ? "error" : level === "warn" ? "warn" : "info";
        const logEntry = boundPreviewConsoleEntry({
          level: logLevel,
          type: "client" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
        return;
      }

      // Handle network requests from the iframe
      if (event.data?.type === "network-request") {
        const { method, url } = event.data;
        const formattedMessage = formatPreviewConsoleMessage("→", [
          method,
          url,
        ]);
        const logEntry = boundPreviewConsoleEntry({
          level: "info" as const,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
        return;
      }

      // Handle network responses from the iframe
      if (event.data?.type === "network-response") {
        const { method, url, status, duration } = event.data;
        const numericStatus = typeof status === "number" ? status : 0;
        const durationLabel =
          typeof duration === "number"
            ? `(${duration}ms)`
            : "(unknown duration)";
        const formattedMessage = formatPreviewConsoleMessage(
          formatPreviewNetworkStatus(status),
          [method, url, durationLabel],
        );
        const level: "info" | "warn" | "error" =
          numericStatus >= 400
            ? "error"
            : numericStatus >= 300
              ? "warn"
              : "info";
        const logEntry = boundPreviewConsoleEntry({
          level,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
        return;
      }

      // Handle network errors from the iframe
      if (event.data?.type === "network-error") {
        const { method, url, status, error, duration } = event.data;
        const statusCode =
          typeof status === "number" && status !== 0 ? `[${status}]` : "";
        const durationLabel =
          typeof duration === "number"
            ? `(${duration}ms)`
            : "(unknown duration)";
        const formattedMessage = formatPreviewConsoleMessage(statusCode, [
          method,
          url,
          "-",
          error,
          durationLabel,
        ]);
        const logEntry = boundPreviewConsoleEntry({
          level: "error" as const,
          type: "network-requests" as const,
          message: formattedMessage,
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
        return;
      }

      if (event.data?.type === "dyad-component-selector-initialized") {
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
          | "build-error-report";
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
        const logEntry = boundPreviewConsoleEntry({
          level: "error" as const,
          type: "client" as const,
          message: `Iframe error: ${errorMessage}`,
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
      } else if (type === "build-error-report") {
        console.debug(`Build error report: ${payload}`);
        const errorMessage = `${payload?.message} from file ${payload?.file}.\n\nSource code:\n${payload?.frame}`;
        setErrorMessage({ message: errorMessage, source: "preview-app" });
        const logEntry = boundPreviewConsoleEntry({
          level: "error" as const,
          type: "client" as const,
          message: formatPreviewConsoleMessage("Build error report:", [
            payload?.message,
            "from file",
            payload?.file,
            "Source code:",
            payload?.frame,
          ]),
          appId: selectedAppId!,
          timestamp: Date.now(),
        });

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        appendConsoleEntries({ appId: logEntry.appId, entries: [logEntry] });
      }
    },
    [
      selectedAppId,
      appendConsoleEntries,
      setErrorMessage,
      setSelectedComponentsPreview,
      setVisualEditingSelectedComponent,
      queryClient,
    ],
  );
  componentMessageHandlerRef.current = handleComponentMessage;

  // Get current styles when component is selected for visual editing
  useEffect(() => {
    if (visualEditingSelectedComponent) {
      getCurrentElementStyles();
    }
  }, [visualEditingSelectedComponent]);

  // Function to activate component selector in the iframe
  const handleActivateComponentSelector = () => {
    if (iframeRef.current?.contentWindow) {
      setVisualEditingSelectedComponent(null);
      sendIframeEvent({ type: "PICKER_TOGGLED" });
    }
  };

  // Function to handle annotator button click
  const handleAnnotatorClick = () => {
    if (annotatorMode) {
      pendingAnnotatorScreenshotRequestIdRef.current = null;
      setAnnotatorMode(false);
      setScreenshotDataUrl(null);
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
      sendIframeEvent({ type: "GO_BACK" });
    }
  };

  // Function to navigate forward
  const handleNavigateForward = () => {
    if (canGoForward && iframeRef.current?.contentWindow) {
      sendIframeEvent({ type: "GO_FORWARD" });
    }
  };

  // Function to handle reload
  const handleReload = () => {
    sendIframeEvent({ type: "RELOAD_REQUESTED" });
    // Reset visual editing state
    setVisualEditingSelectedComponent(null);
    setPendingChanges(new Map());
    setCurrentComponentCoordinates(null);
    console.debug("Reloading iframe preview for app", selectedAppId);
  };

  // Function to navigate to a specific route
  const navigateToRoute = (path: string) => {
    if (!iframeRef.current?.contentWindow || !appUrl) {
      return false;
    }

    const normalized = normalizePreviewAddressPath(path);
    if (normalized.type === "empty") {
      return false;
    }
    if (normalized.type === "invalid") {
      showError(normalized.message);
      return false;
    }

    // Create the full URL by combining the base URL with the path
    const baseUrl = new URL(appUrl).origin;
    const newUrl = new URL(normalized.path, baseUrl).href;

    sendIframeEvent({ type: "NAVIGATE", path: newUrl });

    return true;
  };

  const submitAddressBarValue = () => {
    const result = normalizePreviewAddressPath(addressBarValue);
    if (result.type === "empty") {
      setAddressBarValue(currentAddressPath);
      setIsEditingAddressBar(false);
      return;
    }

    if (result.type === "invalid") {
      showError(result.message);
      setAddressBarValue(currentAddressPath);
      setIsEditingAddressBar(false);
      return;
    }

    const didNavigate = navigateToRoute(result.path);
    if (didNavigate) {
      skipNextAddressBarBlurRef.current = true;
      setAddressBarValue(result.path);
    } else {
      setAddressBarValue(currentAddressPath);
    }
    setIsEditingAddressBar(false);
  };

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

  const openPreviewInBrowser = async () => {
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
  };

  const onCleanRestart = () => {
    restartApp({ removeNodeModules: true });
  };

  const onRecreateSandbox = () => {
    restartApp({ recreateSandbox: true });
  };

  const { showOpenBrowser } =
    getPreviewToolbarActionVisibility(previewToolbarWidth);
  const openBrowserDisabled = isCloudMode
    ? isCreatingCloudSandboxShareLink
    : !originalUrl;

  return (
    <div className="flex flex-col h-full">
      {/* Browser-style header - hide when annotator is active */}
      {!annotatorMode && (
        <div
          ref={previewToolbarRef}
          className="flex min-w-0 items-center gap-1.5 border-b px-2 py-1.5"
        >
          <div
            className="flex shrink-0 items-center overflow-hidden rounded-md border border-border"
            aria-label="Preview editing tools"
            role="group"
          >
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
                    className={cn(
                      PREVIEW_TOOLBAR_BUTTON_CLASSES,
                      "rounded-none",
                      isPicking
                        ? "bg-purple-500 text-white hover:bg-purple-600 hover:text-white dark:bg-purple-600 dark:hover:bg-purple-700"
                        : "text-purple-700 hover:bg-purple-100 hover:text-purple-800 dark:text-purple-300 dark:hover:bg-purple-900/50 dark:hover:text-purple-200",
                    )}
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
                    className={cn(
                      PREVIEW_TOOLBAR_BUTTON_CLASSES,
                      "rounded-none border-l border-border",
                      annotatorMode
                        ? "bg-purple-500 text-white hover:bg-purple-600 hover:text-white dark:bg-purple-600 dark:hover:bg-purple-700"
                        : "text-purple-700 hover:bg-purple-100 hover:text-purple-800 dark:text-purple-300 dark:hover:bg-purple-900/50 dark:hover:text-purple-200",
                    )}
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
          </div>

          {/* Browser navigation group */}
          <div className="flex shrink-0 items-center gap-1.5">
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
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
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
                      className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
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

          {/* Device mode sits beside the route field because it controls the
              preview viewport rather than the current route. */}
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
                      PREVIEW_TOOLBAR_BUTTON_CLASSES,
                      deviceMode !== "desktop" &&
                        "bg-primary/10 text-primary dark:bg-purple-900/40 dark:text-purple-300",
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
                      previewDeviceMode: value[value.length - 1] as DeviceMode,
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

          {/* Flexible route field keeps priority as the panel narrows. */}
          <div className="relative flex h-8 min-w-24 flex-1 items-center rounded-md border border-border bg-(--background-lighter) px-1">
            <div className="flex min-w-[2rem] flex-1 items-center">
              <input
                aria-label="Preview path"
                className="min-w-0 flex-1 rounded-sm bg-transparent px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                data-testid="preview-address-bar-input"
                disabled={loading || !selectedAppId}
                onBlur={() => {
                  if (skipNextAddressBarBlurRef.current) {
                    skipNextAddressBarBlurRef.current = false;
                    return;
                  }
                  setAddressBarValue(currentAddressPath);
                  setIsEditingAddressBar(false);
                }}
                onChange={(event) => setAddressBarValue(event.target.value)}
                onFocus={(event) => {
                  setIsEditingAddressBar(true);
                  event.currentTarget.select();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAddressBarValue();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setAddressBarValue(currentAddressPath);
                    setIsEditingAddressBar(false);
                    event.currentTarget.blur();
                  }
                }}
                spellCheck={false}
                value={addressBarValue}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Show detected routes"
                  className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="preview-address-bar-routes-button"
                  disabled={loading || !selectedAppId}
                >
                  <ChevronDown size={12} />
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
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={handleReload}
                    className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
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
          </div>

          {showOpenBrowser && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    data-testid="preview-open-browser-button"
                    aria-label="Open in browser"
                    onClick={openPreviewInBrowser}
                    disabled={openBrowserDisabled}
                    className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
                  />
                }
              >
                <ExternalLink size={14} />
              </TooltipTrigger>
              <TooltipContent>Open in browser</TooltipContent>
            </Tooltip>
          )}

          {/* Right action group - runtime and overflow actions */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={onRestart}
                    data-testid="preview-restart-button"
                    aria-label={
                      isCloudMode ? "Restart Cloud Sandbox" : "Restart"
                    }
                    className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
                  />
                }
              >
                <Power size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isCloudMode ? "Restart Cloud Sandbox" : "Restart App"}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="preview-more-options-button"
                aria-label={t("preview.moreOptions")}
                className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              >
                <MoreVertical size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {!showOpenBrowser && (
                  <DropdownMenuItem
                    onClick={openPreviewInBrowser}
                    disabled={openBrowserDisabled}
                    data-testid="preview-open-browser-menu-item"
                  >
                    <ExternalLink size={16} />
                    <span>Open in browser</span>
                  </DropdownMenuItem>
                )}
                {!showOpenBrowser && <DropdownMenuSeparator />}
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
        </div>
      )}

      <div className="relative flex-grow overflow-hidden">
        {!loading && (
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
        )}
        <PreviewLoadingScreen
          loading={loading}
          isAppUrlReady={!!appUrl}
          hasStartupError={!loading && errorMessage?.source === "dyad-app"}
        />
        {!loading && appUrl && (
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
                  <AnnotatorOnlyForPro onGoBack={handleAnnotatorClick} />
                )}
              </div>
            ) : (
              <>
                <iframe
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-downloads"
                  data-testid="preview-iframe-element"
                  onLoad={() => {
                    onIframeLoaded();
                  }}
                  ref={iframeRef}
                  key={iframeState.iframeEpoch}
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
