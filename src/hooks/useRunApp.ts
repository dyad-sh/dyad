import { useCallback } from "react";
import { atom } from "jotai";
import { IpcClient } from "@/ipc/ipc_client";
import {
  appConsoleEntriesAtom,
  appUrlAtom,
  currentAppAtom,
  previewPanelKeyAtom,
  previewErrorMessageAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AppOutput } from "@/ipc/ipc_types";
import { showInputRequest } from "@/lib/toast";

const useRunAppLoadingAtom = atom(false);

export function useRunApp() {
  const [loading, setLoading] = useAtom(useRunAppLoadingAtom);
  const [app, setApp] = useAtom(currentAppAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const [, setAppUrlObj] = useAtom(appUrlAtom);
  const setPreviewPanelKey = useSetAtom(previewPanelKeyAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setPreviewErrorMessage = useSetAtom(previewErrorMessageAtom);

  const processProxyServerOutput = (output: AppOutput) => {
    const matchesProxyServerStart = output.message.includes(
      "[dyad-proxy-server]started=[",
    );
    if (matchesProxyServerStart) {
      // Extract both proxy URL and original URL using regex
      const proxyUrlMatch = output.message.match(
        /\[dyad-proxy-server\]started=\[(.*?)\]/,
      );
      const originalUrlMatch = output.message.match(/original=\[(.*?)\]/);

      if (proxyUrlMatch && proxyUrlMatch[1]) {
        const proxyUrl = proxyUrlMatch[1];
        const originalUrl = originalUrlMatch && originalUrlMatch[1];
        setAppUrlObj({
          appUrl: proxyUrl,
          appId: output.appId,
          originalUrl: originalUrl!,
        });
      }
    }
  };

  const processAppOutput = useCallback(
    (output: AppOutput) => {
      // Handle input requests specially
      if (output.type === "input-requested") {
        showInputRequest(output.message, async (response) => {
          try {
            const ipcClient = IpcClient.getInstance();
            await ipcClient.respondToAppInput({
              appId: output.appId,
              response,
            });
          } catch (error) {
            console.error("Failed to respond to app input:", error);
          }
        });
        return; // Don't add to regular output
      }

      // Add to console entries
      const level =
        output.type === "stderr" || output.type === "client-error"
          ? "error"
          : "info";
      setConsoleEntries((prev) => [
        ...prev,
        {
          level,
          type: "build-time",
          message: output.message,
          timestamp: output.timestamp,
          appId: output.appId,
        },
      ]);

      // Process proxy server output
      processProxyServerOutput(output);
    },
    [setConsoleEntries],
  );
  const runApp = useCallback(
    async (appId: number) => {
      setLoading(true);
      try {
        const ipcClient = IpcClient.getInstance();
        console.debug("Running app", appId);

        // Clear the URL and add restart message
        setAppUrlObj((prevAppUrlObj) => {
          if (prevAppUrlObj?.appId !== appId) {
            return { appUrl: null, appId: null, originalUrl: null };
          }
          return prevAppUrlObj; // No change needed
        });

        setConsoleEntries((prev) => [
          ...prev,
          {
            level: "info",
            type: "build-time",
            message: "Trying to restart app...",
            timestamp: Date.now(),
            appId,
          },
        ]);
        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.runApp(appId, processAppOutput);
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
    },
    [processAppOutput],
  );

  const stopApp = useCallback(async (appId: number) => {
    if (appId === null) {
      return;
    }

    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.stopApp(appId);

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

  const onHotModuleReload = useCallback(() => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
  }, [setPreviewPanelKey]);

  const restartApp = useCallback(
    async ({
      removeNodeModules = false,
    }: { removeNodeModules?: boolean } = {}) => {
      if (appId === null) {
        return;
      }
      setLoading(true);
      try {
        const ipcClient = IpcClient.getInstance();
        console.debug(
          "Restarting app",
          appId,
          removeNodeModules ? "with node_modules cleanup" : "",
        );

        // Clear the URL and add restart message
        setAppUrlObj({ appUrl: null, appId: null, originalUrl: null });
        setConsoleEntries((prev) => [
          ...prev,
          {
            level: "info",
            type: "build-time",
            message: "Restarting app...",
            timestamp: Date.now(),
            appId,
          },
        ]);

        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.restartApp(
          appId,
          (output) => {
            // Handle HMR updates before processing
            if (
              output.message.includes("hmr update") &&
              output.message.includes("[vite]")
            ) {
              onHotModuleReload();
            }
            // Process normally (including input requests)
            processAppOutput(output);
          },
          removeNodeModules,
        );
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
      processAppOutput,
      onHotModuleReload,
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
