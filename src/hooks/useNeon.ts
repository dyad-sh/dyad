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
import {
  NEON_PROJECT_ACCESS_DENIED_MESSAGE,
  NEON_PROJECT_NOT_FOUND_MESSAGE,
  NEON_RECONNECT_REQUIRED_MESSAGE,
} from "@/shared/neon_auth";

function isProjectAccessError(
  error: unknown,
  kind: DyadErrorKind,
  message: string,
): boolean {
  return (
    error instanceof DyadError &&
    error.kind === kind &&
    error.message === message
  );
}

export function useNeon(
  appId: number | null,
  {
    projectOnly = false,
  }: {
    /** Skip the account's project list and the branch auth config, for
     * panels that only show the linked project. */
    projectOnly?: boolean;
  } = {},
) {
  const { settings } = useSettings();
  const { app, loading: isLoadingApp } = useLoadApp(appId);

  const isConnected = !!settings?.neon?.accessToken?.value;
  const settingsRequireReconnection =
    !!settings &&
    (!!settings.neon?.reconnectRequired ||
      (!!app?.neonProjectId && !isConnected));
  // Keep query eligibility settings-based so cached auth errors cannot prevent
  // the project from refetching after a successful sign-in.
  const canQuery = isConnected && !settingsRequireReconnection;

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
    enabled: canQuery && !projectOnly,
  });

  const projects: NeonProjectListItem[] = projectsData?.projects ?? [];

  // Fetch branches for the connected project
  const isProjectQueryEnabled = canQuery && !!appId && !!app?.neonProjectId;
  const {
    data: projectInfo,
    isLoading: isLoadingBranches,
    isFetching: isFetchingBranches,
    error: branchesError,
  } = useQuery({
    queryKey: queryKeys.neon.project({ appId }),
    queryFn: () => ipc.neon.getProject({ appId: appId! }),
    enabled: isProjectQueryEnabled,
  });

  const branches: NeonBranch[] = projectInfo?.branches ?? [];

  // A disabled query keeps its last error, so only trust it while a project
  // is still linked (it is stale after the project is unlinked).
  // The request can reject before the settings invalidation reaches us; show
  // recovery immediately instead of briefly rendering a generic error.
  // After sign-in, ignore that cached failure while checking the new session.
  const requiresReconnection =
    settingsRequireReconnection ||
    (!!app?.neonProjectId &&
      !isFetchingBranches &&
      isProjectAccessError(
        branchesError,
        DyadErrorKind.Auth,
        NEON_RECONNECT_REQUIRED_MESSAGE,
      ));
  const projectNotFound =
    !!app?.neonProjectId &&
    isProjectAccessError(
      branchesError,
      DyadErrorKind.NotFound,
      NEON_PROJECT_NOT_FOUND_MESSAGE,
    );
  // True whenever this account cannot use the linked project; projectNotFound
  // narrows it to the case where the project may also have been deleted.
  const projectAccessDenied =
    projectNotFound ||
    (!!app?.neonProjectId &&
      isProjectAccessError(
        branchesError,
        DyadErrorKind.Auth,
        NEON_PROJECT_ACCESS_DENIED_MESSAGE,
      ));
  // Settings, the app and (for a linked project) the access check have all
  // loaded, so requiresReconnection and projectAccessDenied are settled.
  // A retry of a failed access check is unsettled even when it has old data.
  const isAccessResolved =
    !!settings &&
    !isLoadingApp &&
    !(
      isProjectQueryEnabled &&
      (isLoadingBranches || (isFetchingBranches && !!branchesError))
    );

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
        !projectOnly &&
        !!appId &&
        !!app?.neonProjectId &&
        !!(app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId),
    });

  return {
    isConnected,
    requiresReconnection,
    projectAccessDenied,
    projectNotFound,
    isAccessResolved,
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
