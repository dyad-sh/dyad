import { appFilesAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";

export function useAppFiles() {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [appFiles, setAppFiles] = useAtom(appFilesAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const getAppFiles = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedAppId) return;
      const ipcClient = IpcClient.getInstance();
      const appFilesResponse = await ipcClient.getAppFiles(selectedAppId);
      setAppFiles(appFilesResponse);
      setError(null);
    } catch (error) {
      console.error("Error refreshing apps:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [selectedAppId, setAppFiles, setError, setLoading]);

  useEffect(() => {
    const fetchAppFiles = async () => {
      if (selectedAppId) {
        await getAppFiles();
      } else {
        setAppFiles([]);
        setError(null);
        setLoading(false);
      }
    };
    fetchAppFiles();
  }, [selectedAppId, getAppFiles]);

  return { appFiles, error, loading };
}
