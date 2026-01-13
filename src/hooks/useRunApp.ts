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
        let proxyUrl = proxyUrlMatch[1];
        if (proxyUrl.startsWith("/")) {
          proxyUrl = window.location.origin + proxyUrl;
        }

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
      const logEntry = {
        level:
          output.type === "stderr" || output.type === "client-error"
            ? ("error" as const)
            : ("info" as const),
        type: "build-time" as const,
        message: output.message,
        appId: output.appId,
        timestamp: output.timestamp,
      };

      // Only send client-error logs to central store
      // Server logs (stdout/stderr) are already stored in the main process
      if (output.type === "client-error") {
        IpcClient.getInstance().addLog(logEntry);
      }

      // Also update UI state
      setConsoleEntries((prev) => [...prev, logEntry]);

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

        const logEntry = {
          level: "info" as const,
          type: "build-time" as const,
          message: "Trying to restart app...",
          appId,
          timestamp: Date.now(),
        };

        // Send to central log store
        IpcClient.getInstance().addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);
        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.runApp(appId, processAppOutput);
        setPreviewErrorMessage(undefined);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Handle different error types with specific messages
        if (errorMessage.includes("NO_FILES") || errorMessage.includes("No files found")) {
          console.log("App has no files, waiting for code generation.");
          setAppOutput((prev) => [
            ...prev,
            {
              message: "⏳ Waiting for AI to generate code...",
              type: "stdout",
              appId,
              timestamp: Date.now(),
            },
          ]);
          // Do not show red error banner for this expected state
          setPreviewErrorMessage(undefined);
        } else if (errorMessage.includes("MISSING_PACKAGE_JSON") || errorMessage.includes("package.json is missing")) {
          console.log("Files exist but package.json is missing.");
          setAppOutput((prev) => [
            ...prev,
            {
              message: "⚠️  Files were generated but package.json is missing.",
              type: "stderr",
              appId,
              timestamp: Date.now(),
            },
            {
              message: "💡 Ask AI: 'Please create package.json with the required dependencies'",
              type: "stdout",
              appId,
              timestamp: Date.now(),
            },
          ]);
          setPreviewErrorMessage({
            message: "Missing package.json - Ask AI to create it",
            source: "dyad-app",
          });
        } else if (errorMessage.includes("npm install failed") || errorMessage.includes("failed with code")) {
          console.log("Dependency installation failed.");
          setAppOutput((prev) => [
            ...prev,
            {
              message: "❌ Failed to install dependencies.",
              type: "stderr",
              appId,
              timestamp: Date.now(),
            },
            {
              message: "💡 Check package.json for errors or ask AI to fix it",
              type: "stdout",
              appId,
              timestamp: Date.now(),
            },
          ]);
          setPreviewErrorMessage({
            message: "Dependency installation failed - Check package.json",
            source: "dyad-app",
          });
        } else if (errorMessage.includes("App is empty")) {
          // Legacy error message support
          console.log("App is empty (legacy), waiting for code generation.");
          setAppOutput((prev) => [
            ...prev,
            {
              message: "⏳ Waiting for AI to generate code...",
              type: "stdout",
              appId,
              timestamp: Date.now(),
            },
          ]);
          setPreviewErrorMessage(undefined);
        } else {
          // Generic error
          console.error(`Error running app ${appId}:`, error);
          setPreviewErrorMessage({
            message: errorMessage,
            source: "dyad-app",
          });
        }
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

        // Clear logs in both the backend store and UI state
        await ipcClient.clearLogs(appId);
        setConsoleEntries([]);

        const logEntry = {
          level: "info" as const,
          type: "build-time" as const,
          message: "Restarting app...",
          appId: appId!,
          timestamp: Date.now(),
        };

        // Send to central log store
        IpcClient.getInstance().addLog(logEntry);

        // Also update UI state
        setConsoleEntries((prev) => [...prev, logEntry]);

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
