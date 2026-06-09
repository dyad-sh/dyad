import { useCallback, useEffect, useReducer, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  getInitialGitHubRepoSetupState,
  githubDeviceFlowReducer,
  githubRepoSetupReducer,
  initialGithubDeviceFlowState,
} from "./GitHubConnector.state";

interface UseGitHubDeviceFlowParams {
  appId: number | null;
  refreshSettings: () => void;
  onConnected: () => void;
}

export function useGitHubDeviceFlow({
  appId,
  refreshSettings,
  onConnected,
}: UseGitHubDeviceFlowParams) {
  const [flow, dispatch] = useReducer(
    githubDeviceFlowReducer,
    initialGithubDeviceFlowState,
  );

  const connect = useCallback(() => {
    dispatch({ type: "start" });
    ipc.github.startFlow({ appId });
  }, [appId]);

  useEffect(() => {
    const cleanupFunctions: (() => void)[] = [];

    cleanupFunctions.push(
      ipc.events.github.onFlowUpdate((data) => {
        console.log("Received github:flow-update", data);
        dispatch({
          type: "update",
          userCode: data.userCode,
          verificationUri: data.verificationUri,
          message: data.message,
        });
      }),
    );

    cleanupFunctions.push(
      ipc.events.github.onFlowSuccess((data) => {
        console.log("Received github:flow-success", data);
        dispatch({ type: "success" });
        refreshSettings();
        onConnected();
      }),
    );

    cleanupFunctions.push(
      ipc.events.github.onFlowError((data) => {
        console.log("Received github:flow-error", data);
        dispatch({ type: "error", error: data.error });
      }),
    );

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
      dispatch({ type: "reset" });
    };
  }, [onConnected, refreshSettings]);

  return {
    flow,
    isConnecting: flow.status === "requesting" || flow.status === "waiting",
    connect,
  };
}

interface UseGitHubRepoSetupParams {
  appId: number | null;
  folderName: string;
  hasGitHubCredentials: boolean;
  onSetupComplete: () => void;
}

export function useGitHubRepoSetup({
  appId,
  folderName,
  hasGitHubCredentials,
  onSetupComplete,
}: UseGitHubRepoSetupParams) {
  const [state, dispatch] = useReducer(
    githubRepoSetupReducer,
    folderName,
    getInitialGitHubRepoSetupState,
  );
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const githubOrg = "";

  const reposQuery = useQuery({
    queryKey: queryKeys.github.repos,
    queryFn: () => ipc.github.listRepos(),
    enabled: hasGitHubCredentials && state.mode === "existing",
  });

  const branchesQuery = useQuery({
    queryKey: queryKeys.github.branches({ repoFullName: state.selectedRepo }),
    queryFn: async () => {
      const [owner, repo] = state.selectedRepo.split("/");
      return ipc.github.getRepoBranches({ owner, repo });
    },
    enabled: state.mode === "existing" && !!state.selectedRepo,
  });

  useEffect(() => {
    if (branchesQuery.data) {
      dispatch({ type: "branches-loaded", branches: branchesQuery.data });
    }
  }, [branchesQuery.data]);

  const checkRepoAvailability = useCallback(
    async (name: string) => {
      if (!name) {
        dispatch({ type: "repo-check-skipped" });
        return;
      }
      dispatch({ type: "repo-check-started" });
      try {
        const result = await ipc.github.isRepoAvailable({
          org: githubOrg,
          repo: name,
        });
        dispatch({
          type: "repo-check-succeeded",
          available: result.available,
          error: result.error,
        });
      } catch (err: any) {
        dispatch({
          type: "repo-check-failed",
          error: err.message || "Failed to check repo availability.",
        });
      }
    },
    [githubOrg],
  );

  const setRepoName = useCallback(
    (name: string) => {
      dispatch({ type: "set-repo-name", name });
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        checkRepoAvailability(name);
      }, 500);
    },
    [checkRepoAvailability],
  );

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const setupRepoMutation = useMutation({
    mutationFn: async () => {
      if (!appId) return;
      if (state.mode === "create") {
        await ipc.github.createRepo({
          org: githubOrg,
          repo: state.repoName,
          appId,
          branch: state.selectedBranch,
        });
      } else {
        const [owner, repo] = state.selectedRepo.split("/");
        const branchToUse =
          state.branchInputMode === "custom"
            ? state.customBranchName
            : state.selectedBranch;
        await ipc.github.connectExistingRepo({
          owner,
          repo,
          branch: branchToUse,
          appId,
        });
      }
    },
    onSuccess: () => {
      onSetupComplete();
    },
  });

  const submit = useCallback(async () => {
    await setupRepoMutation.mutateAsync().catch(() => undefined);
  }, [setupRepoMutation]);

  const canSubmit =
    !setupRepoMutation.isPending &&
    (state.mode === "create"
      ? state.repoAvailable !== false && !!state.repoName
      : !!state.selectedRepo &&
        !!state.selectedBranch &&
        (state.branchInputMode !== "custom" ||
          !!state.customBranchName.trim()));

  return {
    state: {
      ...state,
      availableRepos: reposQuery.data ?? [],
      isLoadingRepos: reposQuery.isLoading,
      availableBranches: branchesQuery.data ?? [],
      isLoadingBranches: branchesQuery.isLoading,
      isCreatingRepo: setupRepoMutation.isPending,
      createRepoError:
        setupRepoMutation.error?.message ||
        (setupRepoMutation.error
          ? `Failed to ${state.mode === "create" ? "create" : "connect to"} repository.`
          : null),
      createRepoSuccess: setupRepoMutation.isSuccess,
    },
    actions: {
      setMode: (mode: "create" | "existing") =>
        dispatch({ type: "set-mode", mode }),
      setRepoName,
      selectRepo: (repo: string) => dispatch({ type: "select-repo", repo }),
      selectBranch: (branch: string) =>
        dispatch({ type: "select-branch", branch }),
      useCustomBranch: () => dispatch({ type: "use-custom-branch" }),
      setCustomBranch: (branch: string) =>
        dispatch({ type: "set-custom-branch", branch }),
      submit,
    },
    canSubmit,
  };
}
