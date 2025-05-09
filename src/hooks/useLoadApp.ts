import { useState, useEffect } from "react";
import { IpcClient } from "@/ipc/ipc_client";

import { useAtom } from "jotai";
import { currentAppAtom } from "@/atoms/appAtoms";

export function useLoadApp(appId: number | null) {
  const [app, setApp] = useAtom(currentAppAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loadApp = async () => {
      if (appId === null) {
        setApp(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const ipcClient = IpcClient.getInstance();
        const appData = await ipcClient.getApp(appId);

        setApp(appData);
        setError(null);
      } catch (error) {
        console.error(`Error loading app ${appId}:`, error);
        setError(error instanceof Error ? error : new Error(String(error)));
        setApp(null);
      } finally {
        setLoading(false);
      }
    };

    loadApp();
  }, [appId]);

  const refreshApp = async () => {
    if (appId === null) {
      return;
    }

    setLoading(true);
    try {
      console.log("Refreshing app", appId);
      const ipcClient = IpcClient.getInstance();
      const appData = await ipcClient.getApp(appId);
      console.log("App data", appData);
      setApp(appData);
      setError(null);
    } catch (error) {
      console.error(`Error refreshing app ${appId}:`, error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  };

  return { app, loading, error, refreshApp };
}
