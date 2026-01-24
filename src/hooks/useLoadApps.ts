import { useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { appsListAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";

export function useLoadApps() {
  const [apps, setApps] = useAtom(appsListAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const appListResponse = await ipc.app.listApps();
      setApps(appListResponse.apps);
      setError(null);
    } catch (error) {
      console.error("Error refreshing apps:", error);
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
