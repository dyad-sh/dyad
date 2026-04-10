import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { toast } from "sonner";

export interface AutoDeployStep {
  step: string;
  status: string;
  message: string;
  details?: string;
}

export interface AutoDeployResult {
  success: boolean;
  steps: AutoDeployStep[];
  deploymentUrl?: string;
  error?: string;
  completenessReport?: {
    isComplete: boolean;
    issues: Array<{ file: string; line: number; type: string; message: string }>;
  };
}

type DeployTarget = "vercel" | "4everland" | "fleek" | "ipfs-pinata" | "ipfs-web3storage" | "arweave" | "spheron";

export function useAutoDeploy(appId: number | null) {
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<AutoDeployStep[]>([]);
  const ipc = IpcClient.getInstance();

  // Listen for progress events
  useEffect(() => {
    if (!appId) return;
    const cleanup = ipc.onAutoDeployProgress((data) => {
      if (data.appId === appId) {
        setSteps(data.steps);
      }
    });
    return cleanup;
  }, [appId, ipc]);

  const deployMutation = useMutation<
    AutoDeployResult,
    Error,
    {
      target: DeployTarget;
      skipCompletenessCheck?: boolean;
      buildCommand?: string;
      outputDir?: string;
    }
  >({
    mutationFn: async (params) => {
      if (!appId) throw new Error("No app selected");
      setSteps([]);
      return ipc.autoDeploy({
        appId,
        ...params,
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          result.deploymentUrl
            ? `Deployed successfully! ${result.deploymentUrl}`
            : "Deployment triggered successfully",
        );
        // Invalidate app data to refresh GitHub/Vercel state
        queryClient.invalidateQueries({ queryKey: ["app", appId] });
      } else {
        showError(result.error || "Deployment failed");
      }
    },
    onError: (error) => {
      showError(error.message);
    },
  });

  const completenessQuery = useQuery({
    queryKey: ["site-completeness", appId],
    queryFn: async () => {
      if (!appId) throw new Error("No app selected");
      return ipc.checkSiteCompleteness(appId);
    },
    enabled: false, // Manual trigger only
  });

  const deploy = useCallback(
    (
      target: DeployTarget,
      options?: {
        skipCompletenessCheck?: boolean;
        buildCommand?: string;
        outputDir?: string;
      },
    ) => {
      deployMutation.mutate({
        target,
        ...options,
      });
    },
    [deployMutation],
  );

  const checkCompleteness = useCallback(() => {
    completenessQuery.refetch();
  }, [completenessQuery]);

  return {
    deploy,
    checkCompleteness,
    isDeploying: deployMutation.isPending,
    deployResult: deployMutation.data ?? null,
    steps,
    completenessReport: completenessQuery.data ?? null,
    isCheckingCompleteness: completenessQuery.isFetching,
    error: deployMutation.error?.message ?? null,
  };
}
