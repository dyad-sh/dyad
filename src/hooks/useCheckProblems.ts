import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProblemReport } from "@/ipc/ipc_types";

export function useCheckProblems(appId: number | null) {
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
    enabled: !!appId,
    // DO NOT SHOW ERROR TOAST.
  });

  return {
    problemReport,
    isChecking,
    error,
    checkProblems,
  };
}
