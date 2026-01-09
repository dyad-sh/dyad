import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProblemReport, ProblemsUpdatePayload } from "@/ipc/ipc_types";
import { useSettings } from "./useSettings";

export function useCheckProblems(appId: number | null) {
  const { settings } = useSettings();
  const queryClient = useQueryClient();

  const {
    data: problemReport,
    isLoading: isChecking,
    error,
    refetch: checkProblems,
  } = useQuery<ProblemReport, Error>({
    queryKey: ["problems", appId],
    queryFn: async (): Promise<ProblemReport> => {
      if (!appId) {
        throw new Error("App ID is required");
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.checkProblems({ appId });
    },
    enabled: !!appId && settings?.enableAutoFixProblems,
    // DO NOT SHOW ERROR TOAST.
  });

  // Subscribe to real-time problem updates from TSC watch
  useEffect(() => {
    if (!appId) return;

    const ipcClient = IpcClient.getInstance();
    const unsubscribe = ipcClient.onProblemsUpdate(
      (payload: ProblemsUpdatePayload) => {
        // Only update if this is for our app
        if (payload.appId === appId) {
          // Update the query cache with the new problem report
          queryClient.setQueryData<ProblemReport>(
            ["problems", appId],
            payload.problemReport,
          );
        }
      },
    );

    return unsubscribe;
  }, [appId, queryClient]);

  return {
    problemReport,
    isChecking,
    error,
    checkProblems,
  };
}
