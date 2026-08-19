import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Power,
  RefreshCw,
  X,
} from "lucide-react";

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  previewNativeOverlayActiveAtom,
  previewNativeViewAtom,
} from "@/atoms/previewAtoms";
import { currentTestRunStateAtom } from "@/atoms/testRuntimeAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrentAppUrl } from "@/hooks/useAppRun";
import { runAppLifecycleInBackground, useRunApp } from "@/hooks/useRunApp";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import type { PreviewViewNavigationState } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { formatPreviewAddressPath } from "./previewAddressPath";
import { resolvePreviewBrowserUrl } from "./previewBrowserUrl";
import { PreviewLoadingScreen } from "./PreviewLoadingScreen";
import { PREVIEW_TOOLBAR_BUTTON_CLASSES } from "./previewToolbarStyles";
import {
  boundsEqual,
  computePreviewViewBounds,
  getRendererZoomFactor,
} from "./previewViewBounds";
import type { PreviewViewBounds } from "@/ipc/types";

/**
 * ResizeObserver catches every layout change that alters the placeholder's
 * size, but a pure position shift leaves the size untouched. This low-frequency
 * tick re-measures so the view cannot stay misaligned; with the
 * compare-before-send guard it is a no-op in the steady state.
 */
const BOUNDS_VERIFY_INTERVAL_MS = 500;

interface LoadFailure {
  errorCode: number;
  errorDescription: string;
  url: string;
}

/**
 * Experimental preview backed by an Electron WebContentsView instead of an
 * iframe, used only while a test run drives the page over CDP — Playwright
 * cannot attach to an iframe inside the renderer, so a run needs a real page.
 * Nothing else opens it: leaving here returns to the iframe for good.
 *
 * The view is a native child of the window, so it is not part of the React
 * tree: this component renders a placeholder, measures it, and streams the
 * bounds to the main process. Because the page runs outside the renderer,
 * none of the postMessage-based tooling (component selector, visual editor,
 * annotator, browser console capture) is available here.
 */
export const PreviewWebContentsView = ({ loading }: { loading: boolean }) => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { appUrl, originalUrl, mode } = useCurrentAppUrl(selectedAppId);
  const { settings } = useSettings();
  const setPreviewNativeView = useSetAtom(previewNativeViewAtom);
  const isNativeOverlayActive = useAtomValue(previewNativeOverlayActiveAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  // A preview-driven test run keeps this view alive even while the user browses
  // to another tab, so advertise it and offer the way back.
  const isTestRunActive =
    useAtomValue(currentTestRunStateAtom).phase !== "idle";
  const { restartApp } = useRunApp();

  const hostRef = useRef<HTMLDivElement>(null);
  const lastSentBoundsRef = useRef<PreviewViewBounds | null>(null);
  const frameRef = useRef<number | null>(null);

  const [navState, setNavState] = useState<PreviewViewNavigationState | null>(
    null,
  );
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(
    null,
  );

  const isCloudMode = mode === "cloud";
  const zoomLevel = settings?.zoomLevel;
  const isViewActive = !loading && !!appUrl;

  const {
    mutateAsync: createCloudSandboxShareLink,
    isPending: isCreatingCloudSandboxShareLink,
  } = useMutation({
    mutationFn: async ({ appId }: { appId: number }) =>
      ipc.app.createCloudSandboxShareLink({ appId }),
  });

  const measureBounds = useCallback((): PreviewViewBounds | null => {
    const node = hostRef.current;
    if (!node) return null;
    return computePreviewViewBounds(
      node.getBoundingClientRect(),
      getRendererZoomFactor(),
    );
  }, []);

  const sendBoundsIfChanged = useCallback(() => {
    const bounds = measureBounds();
    if (!bounds || boundsEqual(bounds, lastSentBoundsRef.current)) return;

    lastSentBoundsRef.current = bounds;
    ipc.previewView.setBounds(bounds);
  }, [measureBounds]);

  const scheduleBoundsUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      sendBoundsIfChanged();
    });
  }, [sendBoundsIfChanged]);

  // Subscribe before the show effect runs so the replayed navigation state that
  // `show` emits for an already-loaded view is not missed.
  useEffect(() => {
    const unsubscribeNavigation =
      ipc.events.previewView.onNavigationState(setNavState);
    const unsubscribeLoadFailed = ipc.events.previewView.onLoadFailed(
      (failure) => setLoadFailure(failure),
    );
    const unsubscribeScreenshot = ipc.events.previewView.onScreenshotUpdated(
      ({ dataUrl }) => {
        // Replacing the state value releases the older in-memory screenshot.
        setScreenshotDataUrl(dataUrl);
      },
    );

    return () => {
      unsubscribeNavigation();
      unsubscribeLoadFailed();
      unsubscribeScreenshot();
    };
  }, []);

  useEffect(() => {
    if (!isViewActive || !appUrl) return;

    setLoadFailure(null);
    const bounds = measureBounds();
    if (!bounds) return;

    lastSentBoundsRef.current = bounds;
    void ipc.previewView.show({ url: appUrl, bounds }).catch((error) => {
      showError(
        error instanceof Error
          ? error.message
          : "Failed to open the native preview.",
      );
    });

    return () => {
      lastSentBoundsRef.current = null;
      setNavState(null);
      void ipc.previewView.hide().catch(() => {
        // The window may already be gone; nothing left to clean up.
      });
    };
  }, [appUrl, isViewActive, measureBounds]);

  // The toolbar sends this synchronously before opening its menu. Mirroring
  // the current atom here also covers a native view that mounts while another
  // overlapping workbench surface is already open.
  useEffect(() => {
    if (!isViewActive) return;
    ipc.previewView.setOverlayActive({ active: isNativeOverlayActive });
  }, [isNativeOverlayActive, isViewActive]);

  useEffect(() => {
    if (!isViewActive) return;

    const node = hostRef.current;
    if (!node) return;

    const observer = new ResizeObserver(scheduleBoundsUpdate);
    observer.observe(node);
    window.addEventListener("resize", scheduleBoundsUpdate);
    const interval = window.setInterval(
      scheduleBoundsUpdate,
      BOUNDS_VERIFY_INTERVAL_MS,
    );

    // Zoom changes the CSS-pixel-to-DIP ratio without resizing the element.
    scheduleBoundsUpdate();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsUpdate);
      window.clearInterval(interval);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [isViewActive, scheduleBoundsUpdate, zoomLevel]);

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
          : "Failed to open the preview in a browser.",
      );
    }
  };

  const openBrowserDisabled = isCloudMode
    ? isCreatingCloudSandboxShareLink
    : !originalUrl;

  const currentPath = navState?.url
    ? formatPreviewAddressPath(navState.url)
    : "/";

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex min-w-0 items-center gap-1.5 border-b px-2 py-1.5"
        data-testid="preview-native-toolbar"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => void ipc.previewView.goBack()}
                disabled={!navState?.canGoBack}
                aria-label="Go back"
                data-testid="preview-native-back-button"
                className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              />
            }
          >
            <ArrowLeft size={16} />
          </TooltipTrigger>
          <TooltipContent>Go back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => void ipc.previewView.goForward()}
                disabled={!navState?.canGoForward}
                aria-label="Go forward"
                data-testid="preview-native-forward-button"
                className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              />
            }
          >
            <ArrowRight size={16} />
          </TooltipTrigger>
          <TooltipContent>Go forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => {
                  setLoadFailure(null);
                  void ipc.previewView.reload();
                }}
                aria-label="Reload preview"
                data-testid="preview-native-reload-button"
                className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              />
            }
          >
            <RefreshCw size={16} />
          </TooltipTrigger>
          <TooltipContent>Reload</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-border px-2 py-1">
          <span
            className="truncate text-xs text-muted-foreground"
            data-testid="preview-native-path"
          >
            {currentPath}
          </span>
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            title="Shown while tests drive your app. Component selection and the visual editor are unavailable here."
          >
            Test view
          </span>
          {isTestRunActive && (
            <button
              onClick={() => setPreviewMode("tests")}
              title="Show the Tests panel. The run keeps going."
              data-testid="preview-native-tests-running-chip"
              className="flex shrink-0 items-center gap-1.5 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              Tests running…
            </button>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={openPreviewInBrowser}
                disabled={openBrowserDisabled}
                aria-label="Open in browser"
                data-testid="preview-native-open-browser-button"
                className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              />
            }
          >
            <ExternalLink size={14} />
          </TooltipTrigger>
          <TooltipContent>Open in browser</TooltipContent>
        </Tooltip>

        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() =>
                    runAppLifecycleInBackground("restart", restartApp())
                  }
                  aria-label={isCloudMode ? "Restart Cloud Sandbox" : "Restart"}
                  data-testid="preview-native-restart-button"
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

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setPreviewNativeView(false)}
                  aria-label="Exit the test view"
                  data-testid="preview-native-exit-button"
                  className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
                />
              }
            >
              <X size={16} />
            </TooltipTrigger>
            <TooltipContent>
              {isTestRunActive
                ? "Exit the test view. The run keeps going in the background."
                : "Exit the test view and go back to the normal preview"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/*
        Laid out as a column rather than with an overlay: the native view is
        positioned over the host element below, so anything that must stay
        visible has to take real space instead of stacking on top of it.
      */}
      <div className="relative flex flex-grow flex-col overflow-hidden">
        <PreviewLoadingScreen
          loading={loading}
          isAppUrlReady={!!appUrl}
          hasStartupError={false}
        />
        {loadFailure && (
          <div
            className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
            data-testid="preview-native-load-error"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Failed to load {loadFailure.url}: {loadFailure.errorDescription}
            </span>
            <button
              className="shrink-0 rounded border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
              onClick={() => {
                setLoadFailure(null);
                void ipc.previewView.reload();
              }}
            >
              Retry
            </button>
          </div>
        )}
        {/* The native view is positioned over this element by the main process. */}
        <div
          ref={hostRef}
          data-testid="preview-native-view-host"
          className="relative min-h-0 flex-1 overflow-hidden bg-background"
        >
          {isNativeOverlayActive && screenshotDataUrl && (
            <img
              src={screenshotDataUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              data-testid="preview-native-screenshot"
              className="pointer-events-none absolute inset-0 size-full select-none object-fill"
            />
          )}
        </div>
      </div>
    </div>
  );
};
