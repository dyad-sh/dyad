import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

export function useSecurityReview(appId: number | null) {
  return useQuery({
    queryKey: ["security-review", appId],
    queryFn: async () => {
      if (!appId) {
        throw new Error("App ID is required");
      }
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getLatestSecurityReview(appId);
    },
    enabled: appId !== null,
    retry: false,
    meta: {
      showErrorToast: false, // Don't show error toast if no security review found
    },
  });
}
