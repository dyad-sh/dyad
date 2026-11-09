import {
  ipc,
  type NeonProjectListItem,
  type NeonBranch,
  type NeonAuthEmailAndPasswordConfig,
} from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export function useNeon(appId: number | null) {
  const { settings } = useSettings();
  const { app } = useLoadApp(appId);

  const isConnected = !!settings?.neon?.accessToken?.value;
  const requiresReconnection =
    !!settings &&
    (!!settings.neon?.reconnectRequired ||
      (!!app?.neonProjectId && !isConnected));
  const canQuery = isConnected && !requiresReconnection;

  // Fetch projects list
  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    isFetching: isFetchingProjects,
    error: projectsError,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: queryKeys.neon.projects,
    queryFn: () => ipc.neon.listProjects(),
    enabled: canQuery,
  });

  const projects: NeonProjectListItem[] = projectsData?.projects ?? [];

  // Fetch branches for the connected project
  const {
    data: projectInfo,
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useQuery({
    queryKey: queryKeys.neon.project({ appId }),
    queryFn: () => ipc.neon.getProject({ appId: appId! }),
    enabled: canQuery && !!appId && !!app?.neonProjectId,
  });

  const branches: NeonBranch[] = projectInfo?.branches ?? [];

  // Fetch email and password config for the active branch
  const { data: emailPasswordConfig, isLoading: isLoadingEmailConfig } =
    useQuery({
      queryKey: queryKeys.neon.emailPasswordConfig({
        appId,
        branchId:
          app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId ?? null,
      }),
      queryFn: () => ipc.neon.getEmailPasswordConfig({ appId: appId! }),
      enabled:
        canQuery &&
        !!appId &&
        !!app?.neonProjectId &&
        !!(app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId),
    });

  return {
    isConnected,
    requiresReconnection,
    projectAccessDenied:
      branchesError instanceof DyadError &&
      branchesError.kind === DyadErrorKind.Auth,
    projects,
    projectInfo,
    branches,
    emailPasswordConfig: emailPasswordConfig as
      | NeonAuthEmailAndPasswordConfig
      | undefined,
    isLoadingEmailConfig,

    isLoadingProjects,
    isFetchingProjects,
    projectsError,
    isLoadingBranches,
    branchesError,

    refetchProjects,
  };
}
