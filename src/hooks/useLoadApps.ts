import { useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { appsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import log from "electron-log";

const logger = log.scope("useLoadApps");

export function useLoadApps() {
  const [apps, setApps] = useAtom(appsListAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      const appListResponse = await ipcClient.listApps();
      setApps(appListResponse.apps);
      setError(null);
    } catch (error) {
      logger.error("Error refreshing apps:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [setApps, setError, setLoading]);

  useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  return { apps, loading, error, refreshApps };
}
