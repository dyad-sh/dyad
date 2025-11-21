import { useEffect, useRef } from "react";
import { useQuery, QueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { useAtom, useSetAtom } from "jotai";
import { currentAppAtom, homeModeAtom } from "@/atoms/appAtoms";
import { App } from "@/ipc/ipc_types";
import { useLocation } from "@tanstack/react-router";

export function useLoadApp(appId: number | null) {
  const [, setApp] = useAtom(currentAppAtom);
  const setHomeMode = useSetAtom(homeModeAtom);
  const previousAppIdRef = useRef<number | null>(null);
  const location = useLocation();

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
      // Only auto-switch to translate mode when:
      // 1. We're on the chat page (actually working on the project)
      // 2. Switching TO a contract project (not if we're already viewing it)
      if (
        location.pathname === "/chat" &&
        appData &&
        appData.isContractProject &&
        previousAppIdRef.current !== appId
      ) {
        setHomeMode("translate");
      }
      previousAppIdRef.current = appId;
    }
  }, [appId, appData, setApp, setHomeMode, location.pathname]);

  return { app: appData, loading, error, refreshApp };
}

// Function to invalidate the app query
export const invalidateAppQuery = (
  queryClient: QueryClient,
  { appId }: { appId: number | null },
) => {
  return queryClient.invalidateQueries({ queryKey: ["app", appId] });
};
