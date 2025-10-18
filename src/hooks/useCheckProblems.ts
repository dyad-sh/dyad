import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProblemReport } from "@/ipc/ipc_types";
import { useSettings } from "./useSettings";

/**
 * A hook for checking problems in an app.
 * @param {number | null} appId - The ID of the app to check.
 * @returns {object} An object with the problem report, loading state, error, and a function to refetch the problems.
 * @property {ProblemReport | undefined} problemReport - The problem report.
 * @property {boolean} isChecking - Whether the problems are being checked.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => void} checkProblems - A function to refetch the problems.
 */
export function useCheckProblems(appId: number | null) {
  const { settings } = useSettings();
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

  return {
    problemReport,
    isChecking,
    error,
    checkProblems,
  };
}
