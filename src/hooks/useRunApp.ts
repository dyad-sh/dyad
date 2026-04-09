import { useCallback, useEffect, useRef } from "react";
import { atom } from "jotai";
import { ipc, type AppOutput } from "@/ipc/types";
import {
  appConsoleEntriesAtom,
  appUrlAtom,
  currentAppAtom,
  previewPanelKeyAtom,
  previewErrorMessageAtom,
  previewCurrentUrlAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { showError, showInputRequest } from "@/lib/toast";
import type { RuntimeMode2 } from "@/lib/schemas";

const useRunAppLoadingAtom = atom(false);
const CLOUD_SYNC_ERROR_TOAST_WINDOW_MS = 30_000;

/**
 * Hook to subscribe to app output events from the main process.
 * IMPORTANT: This hook should only be called ONCE in the app (in layout.tsx)
 * to avoid duplicate event subscriptions causing duplicate log entries.
 */
export function useAppOutputSubscription() {
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const [, setAppUrlObj] = useAtom(appUrlAtom);
  const [, setPreviewErrorMessage] = useAtom(previewErrorMessageAtom);
  const setPreviewPanelKey = useSetAtom(previewPanelKeyAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const syncErrorToastRef = useRef(
    new Map<number, { message: string; shownAt: number }>(),
  );

  const processProxyServerOutput = useCallback(
    (output: AppOutput) => {
      const matchesProxyServerStart = output.message.includes(
        "[dyad-proxy-server]started=[",
      );
      if (matchesProxyServerStart) {
        // Extract both proxy URL and original URL using regex
        const proxyUrlMatch = output.message.match(
          /\[dyad-proxy-server\]started=\[(.*?)\]/,
        );
        const originalUrlMatch = output.message.match(/original=\[(.*?)\]/);
        const modeMatch = output.message.match(/mode=\[(.*?)\]/);

        if (proxyUrlMatch && proxyUrlMatch[1]) {
          const proxyUrl = proxyUrlMatch[1];
          const originalUrl = originalUrlMatch && originalUrlMatch[1];
          const mode = (modeMatch?.[1] as RuntimeMode2 | undefined) ?? "host";
          setAppUrlObj({
            appUrl: proxyUrl,
            appId: output.appId,
            originalUrl: originalUrl!,
            mode,
          });
        }
      }
    },
    [setAppUrlObj],
  );

  const onHotModuleReload = useCallback(() => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
  }, [setPreviewPanelKey]);

  const processAppOutput = useCallback(
    (output: AppOutput) => {
      // Handle input requests specially
      if (output.type === "input-requested") {
        showInputRequest(output.message, async (response) => {
          try {
            await ipc.app.respondToAppInput({
              appId: output.appId,
              response,
            });
          } catch (error) {
            console.error("Failed to respond to app input:", error);
          }
        });
        return null; // Don't add to regular output
      }

      if (output.type === "sync-error") {
        const previousToast = syncErrorToastRef.current.get(output.appId);
        const now = Date.now();

        if (
          !previousToast ||
          previousToast.message !== output.message ||
          now - previousToast.shownAt >= CLOUD_SYNC_ERROR_TOAST_WINDOW_MS
        ) {
          showError(output.message);
          syncErrorToastRef.current.set(output.appId, {
            message: output.message,
            shownAt: now,
          });
        }

        setPreviewErrorMessage((current) =>
          current && current.source !== "dyad-sync"
            ? current
            : {
                message: output.message,
                source: "dyad-sync",
              },
        );
      }

      if (output.type === "sync-recovered") {
        syncErrorToastRef.current.delete(output.appId);
        setPreviewErrorMessage((current) =>
          current?.source === "dyad-sync" ? undefined : current,
        );
      }

      // Handle HMR updates
      if (
        output.message.includes("hmr update") &&
        output.message.includes("[vite]")
      ) {
        onHotModuleReload();
      }

      // Process proxy server output
      processProxyServerOutput(output);

      // Only send client-error logs to central store
      // Server logs (stdout/stderr) are already stored in the main process
      const logEntry = {
        level:
          output.type === "stderr" ||
          output.type === "client-error" ||
          output.type === "sync-error"
            ? ("error" as const)
            : ("info" as const),
        type: "server" as const,
        message: output.message,
        appId: output.appId,
        timestamp: output.timestamp ?? Date.now(),
      };

      if (output.type === "client-error") {
        ipc.misc.addLog(logEntry);
      }

      return logEntry;
    },
    [onHotModuleReload, processProxyServerOutput, setPreviewErrorMessage],
  );

  // Subscribe to immediate app output events (input-requested)
  useEffect(() => {
    const unsubscribe = ipc.events.misc.onAppOutput((output) => {
      if (appId !== null && output.appId === appId) {
        const entry = processAppOutput(output);
        if (entry) {
          setConsoleEntries((prev) => [...prev, entry]);
        }
      }
    });

    return unsubscribe;
  }, [appId, processAppOutput, setConsoleEntries]);

  // Subscribe to batched app output events (stdout/stderr)
  useEffect(() => {
    const unsubscribe = ipc.events.misc.onAppOutputBatch((outputs) => {
      const newEntries: ReturnType<typeof processAppOutput>[] = [];
      for (const output of outputs) {
        if (appId !== null && output.appId === appId) {
          const entry = processAppOutput(output);
          if (entry) {
            newEntries.push(entry);
          }
        }
      }

      if (newEntries.length > 0) {
        setConsoleEntries((prev) => [
          ...prev,
          ...(newEntries as NonNullable<(typeof newEntries)[number]>[]),
        ]);
      }
    });

    return unsubscribe;
  }, [appId, processAppOutput, setConsoleEntries]);
}

export function useRunApp() {
  const [loading, setLoading] = useAtom(useRunAppLoadingAtom);
  const [app, setApp] = useAtom(currentAppAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const [, setAppUrlObj] = useAtom(appUrlAtom);
  const setPreviewPanelKey = useSetAtom(previewPanelKeyAtom);
  const setPreservedUrls = useSetAtom(previewCurrentUrlAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setPreviewErrorMessage = useSetAtom(previewErrorMessageAtom);

  const runApp = useCallback(async (appId: number) => {
    setLoading(true);
    try {
      console.debug("Running app", appId);

      // Clear the URL and add restart message
      setAppUrlObj((prevAppUrlObj) => {
        if (prevAppUrlObj?.appId !== appId) {
          return { appUrl: null, appId: null, originalUrl: null, mode: null };
        }
        return prevAppUrlObj; // No change needed
      });

      const logEntry = {
        level: "info" as const,
        type: "server" as const,
        message: "Connecting to app...",
        appId,
        timestamp: Date.now(),
      };

      // Send to central log store
      ipc.misc.addLog(logEntry);

      // Also update UI state
      setConsoleEntries((prev) => [...prev, logEntry]);
      const app = await ipc.app.getApp(appId);
      setApp(app);
      await ipc.app.runApp({ appId });
      setPreviewErrorMessage(undefined);
    } catch (error) {
      console.error(`Error running app ${appId}:`, error);
      setPreviewErrorMessage(
        error instanceof Error
          ? { message: error.message, source: "dyad-app" }
          : {
              message: error?.toString() || "Unknown error",
              source: "dyad-app",
            },
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const stopApp = useCallback(async (appId: number) => {
    if (appId === null) {
      return;
    }

    setLoading(true);
    try {
      await ipc.app.stopApp({ appId });

      setPreviewErrorMessage(undefined);
    } catch (error) {
      console.error(`Error stopping app ${appId}:`, error);
      setPreviewErrorMessage(
        error instanceof Error
          ? { message: error.message, source: "dyad-app" }
          : {
              message: error?.toString() || "Unknown error",
              source: "dyad-app",
            },
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const restartApp = useCallback(
    async ({
      removeNodeModules = false,
      recreateSandbox = false,
    }: { removeNodeModules?: boolean; recreateSandbox?: boolean } = {}) => {
      if (appId === null) {
        return;
      }
      setLoading(true);
      try {
        console.debug(
          "Restarting app",
          appId,
          recreateSandbox ? "with sandbox recreation" : "",
          removeNodeModules ? "with node_modules cleanup" : "",
        );

        // Clear the URL and add restart message
        setAppUrlObj({
          appUrl: null,
          appId: null,
          originalUrl: null,
          mode: null,
        });

        // Clear preserved URL to prevent stale route restoration after restart
        setPreservedUrls((prev) => {
          const next = { ...prev };
          delete next[appId];
          return next;
        });

        // Clear logs in both the backend store and UI state
        await ipc.misc.clearLogs({ appId });
        setConsoleEntries([]);

        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: "Restarting app...",
          appId: appId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        ipc.misc.addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);

        const app = await ipc.app.getApp(appId);
        setApp(app);
        await ipc.app.restartApp({ appId, removeNodeModules, recreateSandbox });
      } catch (error) {
        console.error(`Error restarting app ${appId}:`, error);
        setPreviewErrorMessage(
          error instanceof Error
            ? { message: error.message, source: "dyad-app" }
            : {
                message: error?.toString() || "Unknown error",
                source: "dyad-app",
              },
        );
      } finally {
        setPreviewPanelKey((prevKey) => prevKey + 1);
        setLoading(false);
      }
    },
    [
      appId,
      setApp,
      setConsoleEntries,
      setAppUrlObj,
      setPreviewPanelKey,
      setPreservedUrls,
    ],
  );

  const refreshAppIframe = useCallback(async () => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
  }, [setPreviewPanelKey]);

  return {
    loading,
    runApp,
    stopApp,
    restartApp,
    app,
    refreshAppIframe,
  };
}
