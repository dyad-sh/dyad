import { useEffect } from "react";
import { useQuery, QueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { useAtom } from "jotai";
import { currentAppAtom } from "@/atoms/appAtoms";
import { App } from "@/ipc/ipc_types";

/**
 * A hook for loading an app.
 * @param {number | null} appId - The ID of the app to load.
 * @returns {object} An object with the app data, loading state, error, and a function to refresh the app.
 * @property {App | null | undefined} app - The app data.
 * @property {boolean} loading - Whether the app is being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => void} refreshApp - A function to refresh the app.
 */
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

/**
 * Invalidates the app query.
 * @param {QueryClient} queryClient - The query client.
 * @param {object} options - The options for invalidating the query.
 * @param {number | null} options.appId - The ID of the app.
 * @returns {Promise<void>}
 */
export const invalidateAppQuery = (
  queryClient: QueryClient,
  { appId }: { appId: number | null },
) => {
  return queryClient.invalidateQueries({ queryKey: ["app", appId] });
};
