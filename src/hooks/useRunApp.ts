import { useState, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import {
  appOutputAtom,
  appUrlAtom,
  currentAppAtom,
  previewPanelKeyAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { App } from "@/ipc/ipc_types";

export function useRunApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [app, setApp] = useAtom(currentAppAtom);
  const setAppOutput = useSetAtom(appOutputAtom);
  const [appUrlObj, setAppUrlObj] = useAtom(appUrlAtom);
  const setPreviewPanelKey = useSetAtom(previewPanelKeyAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const runApp = useCallback(async (appId: number) => {
    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      console.debug("Running app", appId);

      // Clear the URL and add restart message
      if (appUrlObj?.appId !== appId) {
        setAppUrlObj({ appUrl: null, appId: null });
      }
      setAppOutput((prev) => [
        ...prev,
        { message: "Trying to restart app...", type: "stdout", appId },
      ]);
      const app = await ipcClient.getApp(appId);
      setApp(app);
      await ipcClient.runApp(appId, (output) => {
        setAppOutput((prev) => [...prev, output]);
        // Check if the output contains a localhost URL
        const urlMatch = output.message.match(/(https?:\/\/localhost:\d+\/?)/);
        if (urlMatch) {
          setAppUrlObj({ appUrl: urlMatch[1], appId });
        }
      });
      setError(null);
    } catch (error) {
      console.error(`Error running app ${appId}:`, error);
      setError(error instanceof Error ? error : new Error(String(error)));
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
      const ipcClient = IpcClient.getInstance();
      await ipcClient.stopApp(appId);

      setError(null);
    } catch (error) {
      console.error(`Error stopping app ${appId}:`, error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, []);

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
          removeNodeModules ? "with node_modules cleanup" : ""
        );

        // Clear the URL and add restart message
        setAppUrlObj({ appUrl: null, appId: null });
        setAppOutput((prev) => [
          ...prev,
          { message: "Restarting app...", type: "stdout", appId },
        ]);

        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.restartApp(
          appId,
          (output) => {
            setAppOutput((prev) => [...prev, output]);
            // Check if the output contains a localhost URL
            const urlMatch = output.message.match(
              /(https?:\/\/localhost:\d+\/?)/
            );
            if (urlMatch) {
              setAppUrlObj({ appUrl: urlMatch[1], appId });
            }
          },
          removeNodeModules
        );
        setError(null);
      } catch (error) {
        console.error(`Error restarting app ${appId}:`, error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setPreviewPanelKey((prevKey) => prevKey + 1);
        setLoading(false);
      }
    },
    [appId, setApp, setAppOutput, setAppUrlObj, setError, setPreviewPanelKey]
  );

  const refreshAppIframe = useCallback(async () => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
    setError(null);
  }, [setPreviewPanelKey, setError]);

  return { loading, error, runApp, stopApp, restartApp, app, refreshAppIframe };
}
