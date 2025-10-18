import { useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { appBasePathAtom, appsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook for loading the list of apps.
 * @returns {object} An object with the list of apps, loading state, error, and a function to refresh the apps.
 * @property {import("@/ipc/ipc_types").App[]} apps - The list of apps.
 * @property {boolean} loading - Whether the apps are being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => Promise<void>} refreshApps - A function to refresh the apps.
 */
export function useLoadApps() {
  const [apps, setApps] = useAtom(appsListAtom);
  const [, setAppBasePath] = useAtom(appBasePathAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      const appListResponse = await ipcClient.listApps();
      setApps(appListResponse.apps);
      setAppBasePath(appListResponse.appBasePath);
      setError(null);
    } catch (error) {
      console.error("Error refreshing apps:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [setApps, setAppBasePath, setError, setLoading]);

  useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  return { apps, loading, error, refreshApps };
}
