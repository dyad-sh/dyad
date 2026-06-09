import { useCallback, useEffect, useReducer, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  getInitialVercelProjectSetupState,
  initialVercelTokenState,
  vercelProjectSetupReducer,
  vercelTokenReducer,
} from "./VercelConnector.state";

interface UseVercelTokenSetupParams {
  refreshSettings: () => void;
}

export function useVercelTokenSetup({
  refreshSettings,
}: UseVercelTokenSetupParams) {
  const [state, dispatch] = useReducer(
    vercelTokenReducer,
    initialVercelTokenState,
  );

  const saveTokenMutation = useMutation({
    mutationFn: async () => {
      if (!state.accessToken.trim()) return;
      await ipc.vercel.saveToken({
        token: state.accessToken.trim(),
      });
    },
    onSuccess: () => {
      dispatch({ type: "clear-token" });
      refreshSettings();
    },
  });

  const submit = useCallback(async () => {
    await saveTokenMutation.mutateAsync().catch(() => undefined);
  }, [saveTokenMutation]);

  return {
    state: {
      ...state,
      isSavingToken: saveTokenMutation.isPending,
      tokenError: saveTokenMutation.error?.message || null,
      tokenSuccess: saveTokenMutation.isSuccess,
    },
    actions: {
      setToken: (token: string) => dispatch({ type: "set-token", token }),
      submit,
    },
    canSubmit: !!state.accessToken.trim() && !saveTokenMutation.isPending,
  };
}

interface UseVercelProjectSetupParams {
  appId: number | null;
  folderName: string;
  hasVercelCredentials: boolean;
  refreshApp: () => void;
}

export function useVercelProjectSetup({
  appId,
  folderName,
  hasVercelCredentials,
  refreshApp,
}: UseVercelProjectSetupParams) {
  const [state, dispatch] = useReducer(
    vercelProjectSetupReducer,
    folderName,
    getInitialVercelProjectSetupState,
  );
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const projectsQuery = useQuery({
    queryKey: queryKeys.vercel.projects,
    queryFn: () => ipc.vercel.listProjects(),
    enabled: hasVercelCredentials && state.mode === "existing",
  });

  const checkProjectAvailability = useCallback(async (name: string) => {
    if (!name) {
      dispatch({ type: "project-check-skipped" });
      return;
    }
    dispatch({ type: "project-check-started" });
    try {
      const result = await ipc.vercel.isProjectAvailable({
        name,
      });
      dispatch({
        type: "project-check-succeeded",
        available: result.available,
        error: result.error,
      });
    } catch (err: any) {
      dispatch({
        type: "project-check-failed",
        error: err.message || "Failed to check project availability.",
      });
    }
  }, []);

  const setProjectName = useCallback(
    (name: string) => {
      dispatch({ type: "set-project-name", name });
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        checkProjectAvailability(name);
      }, 500);
    },
    [checkProjectAvailability],
  );

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const setupProjectMutation = useMutation({
    mutationFn: async () => {
      if (!appId) return;
      if (state.mode === "create") {
        const result = await ipc.vercel.createProject({
          name: state.projectName,
          appId,
        });
        if (result?.syncWarning) {
          toast.warning(result.syncWarning);
        }
      } else {
        await ipc.vercel.connectExistingProject({
          projectId: state.selectedProject,
          appId,
        });
      }
    },
    onSuccess: () => {
      refreshApp();
    },
  });

  const submit = useCallback(async () => {
    await setupProjectMutation.mutateAsync().catch(() => undefined);
  }, [setupProjectMutation]);

  const canSubmit =
    !setupProjectMutation.isPending &&
    (state.mode === "create"
      ? state.projectAvailable !== false && !!state.projectName
      : !!state.selectedProject);

  return {
    state: {
      ...state,
      availableProjects: projectsQuery.data ?? [],
      isLoadingProjects: projectsQuery.isLoading,
      isCreatingProject: setupProjectMutation.isPending,
      createProjectError:
        setupProjectMutation.error?.message ||
        (setupProjectMutation.error
          ? `Failed to ${state.mode === "create" ? "create" : "connect to"} project.`
          : null),
      createProjectSuccess: setupProjectMutation.isSuccess,
    },
    actions: {
      setMode: (mode: "create" | "existing") =>
        dispatch({ type: "set-mode", mode }),
      setProjectName,
      selectProject: (projectId: string) =>
        dispatch({ type: "select-project", projectId }),
      submit,
    },
    canSubmit,
  };
}
