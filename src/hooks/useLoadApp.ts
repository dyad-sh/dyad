import { useEffect } from "react";
import { useQuery, QueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { useAtom } from "jotai";
import { currentAppAtom } from "@/atoms/appAtoms";
import { App } from "@/ipc/ipc_types";

export function useLoadApp(appId: number | null) {
  const [, setApp] = useAtom(currentAppAtom);

  const {
    data: appData,
    isLoading: loading,
    error,
    refetch: refreshApp,
  } = useQuery<App | null, Error>({
    queryKey: ["app", appId],
    queryFn: async () => {
      if (appId === null) {
        return null;
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getApp(appId);
    },
    enabled: appId !== null,
    // Deliberately not showing error toast here because
    // this will pop up when app is deleted.
    // meta: { showErrorToast: true },
  });

  useEffect(() => {
    if (appId === null) {
      setApp(null);
    } else if (appData !== undefined) {
      setApp(appData);
    }
  }, [appId, appData, setApp]);

  return { app: appData, loading, error, refreshApp };
}

// Function to invalidate the app query
export const invalidateAppQuery = (
  queryClient: QueryClient,
  { appId }: { appId: number | null },
) => {
  return queryClient.invalidateQueries({ queryKey: ["app", appId] });
};
