import {
  useQuery,
  useMutation,
  useQueryClient,
  useMutationState,
} from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { lastLogTimestampAtom } from "@/atoms/supabaseAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  ipc,
  ConsoleEntry,
  SetSupabaseAppProjectParams,
  DeleteSupabaseOrganizationParams,
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
  SupabaseRedeployProgress,
  CreateSupabaseProjectParams,
  SupabaseProjectStatus,
  SUPABASE_PROJECT_STATUS_PROVISIONING,
} from "@/ipc/types";
import { useSettings } from "./useSettings";
import { isSupabaseConnected } from "@/lib/schemas";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { queryKeys } from "@/lib/queryKeys";
import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";

const EDGE_LOGS_POLL_INTERVAL_MS = 5_000;

/**
 * Did a create fail *after* the project was created? The handler reports only
 * that case as `Internal`, and `kind` survives IPC, so this needs no message
 * matching.
 */
export function isCreatedButUnlinkedError(error: unknown): boolean {
  return isDyadError(error) && error.kind === DyadErrorKind.Internal;
}

export interface UseSupabaseOptions {
  branchesProjectId?: string | null;
  branchesOrganizationSlug?: string | null;
  edgeLogsProjectId?: string | null;
  edgeLogsOrganizationSlug?: string | null;
  edgeLogsAppId?: number | null; // The app id that `edgeLogsProjectId` belongs to
}

export function useSupabase(options: UseSupabaseOptions = {}) {
  const {
    branchesProjectId,
    branchesOrganizationSlug,
    edgeLogsProjectId,
    edgeLogsOrganizationSlug,
    edgeLogsAppId,
  } = options;
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const isConnected = isSupabaseConnected(settings);

  const appRunManager = useAppRunRemoteManager();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [lastLogTimestamp, setLastLogTimestamp] = useAtom(lastLogTimestampAtom);

  // Query: Load all connected Supabase organizations
  // Only runs when Supabase is connected to avoid unnecessary API calls
  const organizationsQuery = useQuery<SupabaseOrganizationInfo[], Error>({
    queryKey: queryKeys.supabase.organizations,
    queryFn: async () => {
      return ipc.supabase.listOrganizations();
    },
    enabled: isConnected,
    meta: { showErrorToast: true },
  });

  // Query: Load Supabase projects from all connected organizations
  // Only runs when there are connected organizations to avoid unauthorized errors
  const projectsQuery = useQuery<SupabaseProject[], Error>({
    queryKey: queryKeys.supabase.projects,
    queryFn: async () => {
      return ipc.supabase.listAllProjects();
    },
    enabled: (organizationsQuery.data?.length ?? 0) > 0,
    meta: { showErrorToast: true },
  });

  // Mutation: Delete a Supabase organization connection
  const deleteOrganizationMutation = useMutation<
    void,
    Error,
    DeleteSupabaseOrganizationParams
  >({
    mutationFn: async (params) => {
      await ipc.supabase.deleteOrganization(params);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.user }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.supabase.organizations,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.supabase.projects,
        }),
      ]);
    },
    meta: { showErrorToast: true },
  });

  // Mutation: Create a Supabase project and link it to an app.
  // The handler does both, so a success here means the app is already
  // connected; callers only need to refresh.
  const createProjectMutation = useMutation<
    SupabaseProject,
    Error,
    CreateSupabaseProjectParams
  >({
    mutationFn: async (params) => {
      return ipc.supabase.createProject(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.supabase.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
    },
    // Only for the created-but-unlinked case, whose error tells the user to
    // pick the project from a list that is still the pre-create snapshot.
    // Refetching after an ordinary failure would be worse than nothing:
    // `listAllProjects` returns a partial list as a success, so an offline
    // create would also replace a good cached list with an empty one.
    onError: (error) => {
      if (!isCreatedButUnlinkedError(error)) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.supabase.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
    },
    // The connector renders the failure inline next to the form, and a toast on
    // top of that would say the same thing twice.
    meta: { showErrorToast: false },
  });

  // Mutation: Associate a Supabase project with an app
  const setAppProjectMutation = useMutation<
    void,
    Error,
    SetSupabaseAppProjectParams
  >({
    mutationFn: async (params) => {
      await ipc.supabase.setAppProject(params);
    },
    meta: { showErrorToast: true },
  });

  // Background link recovery needs mutation pending-state tracking without a
  // generic global error toast; the connector provides contextual feedback.
  const recoverAppProjectMutation = useMutation<
    void,
    Error,
    SetSupabaseAppProjectParams
  >({
    mutationFn: async (params) => {
      await ipc.supabase.setAppProject(params);
    },
  });

  // Mutation: Remove a Supabase project association from an app
  const unsetAppProjectMutation = useMutation<void, Error, number>({
    mutationFn: async (appId) => {
      await ipc.supabase.unsetAppProject({ app: appId });
    },
    meta: { showErrorToast: true },
  });

  // Query: Load branches for a Supabase project
  const branchesQuery = useQuery<SupabaseBranch[], Error>({
    queryKey: queryKeys.supabase.branches({
      projectId: branchesProjectId ?? "",
      organizationSlug: branchesOrganizationSlug ?? null,
    }),
    queryFn: async () => {
      const list = await ipc.supabase.listBranches({
        projectId: branchesProjectId!,
        organizationSlug: branchesOrganizationSlug ?? null,
      });
      return Array.isArray(list) ? list : [];
    },
    enabled: !!branchesProjectId,
  });

  // Query: Poll edge function logs for a Supabase project.
  // Polling + in-flight serialization + background-tab pause are all handled
  // by React Query. Side effects live in the useEffect below, not in queryFn.
  const lastLogTimestampRef = useRef(lastLogTimestamp);
  lastLogTimestampRef.current = lastLogTimestamp;

  const edgeLogsActiveAppId =
    edgeLogsAppId !== null && edgeLogsAppId !== undefined
      ? edgeLogsAppId
      : null;
  const edgeLogsEnabled =
    !!edgeLogsProjectId &&
    edgeLogsActiveAppId !== null &&
    edgeLogsActiveAppId === selectedAppId;
  const edgeLogsQuery = useQuery<
    { appId: number; logs: ConsoleEntry[] },
    Error
  >({
    queryKey: edgeLogsEnabled
      ? queryKeys.supabase.edgeLogs({
          projectId: edgeLogsProjectId!,
          appId: edgeLogsActiveAppId,
          organizationSlug: edgeLogsOrganizationSlug ?? null,
        })
      : ["supabase", "edgeLogs", "disabled"],
    queryFn: async () => {
      const projectId = edgeLogsProjectId!;
      const appId = edgeLogsActiveAppId;
      if (appId === null) {
        throw new Error("Cannot fetch Supabase edge logs without an app id");
      }
      const lastTimestamp = lastLogTimestampRef.current[projectId];
      const timestampStart = lastTimestamp ?? Date.now() - 10 * 60 * 1000;
      const logs = await ipc.supabase.getEdgeLogs({
        projectId,
        timestampStart,
        appId,
        organizationSlug: edgeLogsOrganizationSlug ?? null,
      });
      return { appId, logs };
    },
    enabled: edgeLogsEnabled,
    refetchInterval: EDGE_LOGS_POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Apply side effects once per successful fetch. dataUpdatedAt changes on
  // every successful response (even when the returned array is empty), so
  // this fires exactly once per poll tick.
  const edgeLogsDataUpdatedAt = edgeLogsQuery.dataUpdatedAt;
  useEffect(() => {
    if (!edgeLogsEnabled || !edgeLogsDataUpdatedAt) return;
    const projectId = edgeLogsProjectId!;
    const edgeLogsResult = edgeLogsQuery.data;
    if (!edgeLogsResult) return;
    const { appId, logs } = edgeLogsResult;

    const lastTimestamp = lastLogTimestampRef.current[projectId];

    if (logs.length === 0) {
      if (!lastTimestamp) {
        setLastLogTimestamp((prev) => ({
          ...prev,
          [projectId]: Date.now(),
        }));
      }
      return;
    }

    // Filter out logs we've already processed. React Query serves cached
    // data on remount with a non-zero dataUpdatedAt, which would otherwise
    // re-fire this effect and duplicate entries that were appended during
    // the original fetch. Also defends against StrictMode double-invoke.
    const newLogs = lastTimestamp
      ? logs.filter((log) => log.timestamp > lastTimestamp)
      : logs;
    if (newLogs.length === 0) return;

    newLogs.forEach((log) => {
      ipc.misc.addLog(log);
    });
    appRunManager.previewConsole.append(appId, newLogs);

    const latestLog = newLogs.reduce((latest, log) =>
      log.timestamp > latest.timestamp ? log : latest,
    );
    setLastLogTimestamp((prev) => ({
      ...prev,
      [projectId]: latestLog.timestamp,
    }));
    // edgeLogsDataUpdatedAt is the stable per-fetch trigger; other deps are
    // read via ref or are stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeLogsDataUpdatedAt]);

  return {
    // Data
    organizations: organizationsQuery.data ?? [],
    projects: projectsQuery.data ?? [],
    branches: branchesQuery.data ?? [],

    // Organizations query state
    isLoadingOrganizations: organizationsQuery.isLoading,
    isFetchingOrganizations: organizationsQuery.isFetching,
    organizationsError: organizationsQuery.error,

    // Projects query state
    isLoadingProjects: projectsQuery.isLoading,
    isFetchingProjects: projectsQuery.isFetching,
    projectsError: projectsQuery.error,

    // Branches query state
    isLoadingBranches: branchesQuery.isLoading,
    isFetchingBranches: branchesQuery.isFetching,
    branchesError: branchesQuery.error,

    // Mutation states
    isCreatingProject: createProjectMutation.isPending,
    // Which app the in-flight create belongs to. Some navigations swap the
    // connector's `appId` without remounting it, so callers must not read the
    // pending flag as "this app is being created".
    creatingProjectAppId: createProjectMutation.variables?.appId ?? null,
    isDeletingOrganization: deleteOrganizationMutation.isPending,
    isSettingAppProject:
      setAppProjectMutation.isPending || recoverAppProjectMutation.isPending,
    isUnsettingAppProject: unsetAppProjectMutation.isPending,
    isLoadingEdgeLogs: edgeLogsQuery.isFetching,

    // Actions
    refetchOrganizations: organizationsQuery.refetch,
    refetchProjects: projectsQuery.refetch,
    refetchBranches: branchesQuery.refetch,
    deleteOrganization: deleteOrganizationMutation.mutateAsync,
    createProject: createProjectMutation.mutateAsync,
    setAppProject: setAppProjectMutation.mutateAsync,
    recoverAppProject: recoverAppProjectMutation.mutateAsync,
    unsetAppProject: unsetAppProjectMutation.mutateAsync,
  };
}

const PROJECT_STATUS_POLL_INTERVAL_MS = 5_000;

/**
 * Whether a project is still being provisioned, asked of Supabase on each mount
 * rather than remembered from the create — so it survives navigating away, and
 * covers projects provisioned outside Dyad. Costs one request per mount, and
 * polls only while the answer is `COMING_UP`.
 */
export function useSupabaseProjectStatus({
  projectId,
  organizationSlug,
  enabled = true,
}: {
  projectId: string | null | undefined;
  organizationSlug: string | null | undefined;
  enabled?: boolean;
}) {
  const query = useQuery<SupabaseProjectStatus, Error>({
    queryKey: queryKeys.supabase.projectStatus({
      projectId: projectId ?? null,
      organizationSlug: organizationSlug ?? null,
    }),
    queryFn: async () => {
      return ipc.supabase.getProjectStatus({
        projectId: projectId!,
        organizationSlug: organizationSlug ?? null,
      });
    },
    enabled: enabled && !!projectId,
    // Opting out of the app-wide 60s staleTime is what makes a failed tick
    // recoverable: a cached COMING_UP would otherwise be served to the next
    // mount with no request, leaving the banner down for the rest of the
    // provision. No renderer retry either — the main process already retries,
    // and a cancelled one lands in terminal `error` after a single failure.
    staleTime: 0,
    // `staleTime: 0` would otherwise let React Query's focus and reconnect
    // refetches through unthrottled, one request per event against a
    // rate-limited API. Mount is the recovery path that matters.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    refetchInterval: (query) => {
      // A terminal error is the bound. React Query retains the last successful
      // data, so reading `data.status` alone would see COMING_UP forever once
      // the endpoint goes dark, and poll for as long as the panel is mounted.
      if (query.state.status === "error") {
        return false;
      }
      return query.state.data?.status === SUPABASE_PROJECT_STATUS_PROVISIONING
        ? PROJECT_STATUS_POLL_INTERVAL_MS
        : false;
    },
    // A failed poll says nothing the user can act on, and this runs on every
    // mount for every connected app — a toast per tick would be noise.
    meta: { showErrorToast: false },
  });

  return {
    status: query.data?.status ?? null,
    // A retained COMING_UP is no evidence once the endpoint is failing, so the
    // banner drops on the same signal that stops the poll. Only COMING_UP: a
    // paused or restoring project reading "still setting up" would be wrong.
    isProvisioning:
      !query.isError &&
      query.data?.status === SUPABASE_PROJECT_STATUS_PROVISIONING,
  };
}

export function useRedeploySupabaseFunctions(appId: number) {
  const [progress, setProgress] = useState<SupabaseRedeployProgress | null>(
    null,
  );
  const mutationKey = queryKeys.supabase.redeploy({ appId });
  const activeOperationIds = useMutationState<string | null>({
    filters: { mutationKey, status: "pending" },
    select: (pendingMutation) => {
      const variables = pendingMutation.state.variables as
        | { appId: number; operationId: string }
        | undefined;
      return variables?.operationId ?? null;
    },
  });
  const cachedOperationId = activeOperationIds.at(-1) ?? null;
  const activeOperationIdRef = useRef<string | null>(cachedOperationId);

  useEffect(() => {
    activeOperationIdRef.current = cachedOperationId;
  }, [cachedOperationId]);

  useEffect(() => {
    return ipc.events.supabase.onRedeployProgress((nextProgress) => {
      if (nextProgress.operationId === activeOperationIdRef.current) {
        setProgress(nextProgress);
      }
    });
  }, []);

  const mutation = useMutation({
    mutationKey,
    mutationFn: (params: { appId: number; operationId: string }) =>
      ipc.supabase.redeployAllFunctions(params),
  });

  const redeployAllFunctions = useCallback(async () => {
    const operationId = `supabase-redeploy:${globalThis.crypto.randomUUID()}`;
    activeOperationIdRef.current = operationId;
    setProgress(null);
    try {
      return await mutation.mutateAsync({ appId, operationId });
    } finally {
      activeOperationIdRef.current = null;
    }
  }, [appId, mutation]);

  return {
    redeployAllFunctions,
    redeployProgress: progress,
    isRedeployingFunctions: activeOperationIds.length > 0,
  };
}
