import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { lastLogTimestampAtom } from "@/atoms/supabaseAtoms";
import { appConsoleEntriesAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  ipc,
  ConsoleEntry,
  SetSupabaseAppProjectParams,
  DeleteSupabaseOrganizationParams,
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
} from "@/ipc/types";
import { useSettings } from "./useSettings";
import { isSupabaseConnected } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

const EDGE_LOGS_POLL_INTERVAL_MS = 5_000;

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

  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.organizations,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.supabase.projects });
    },
    meta: { showErrorToast: true },
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

  const edgeLogsEnabled =
    !!edgeLogsProjectId && !!selectedAppId && edgeLogsAppId === selectedAppId;
  const edgeLogsQuery = useQuery<ConsoleEntry[], Error>({
    queryKey: edgeLogsEnabled
      ? queryKeys.supabase.edgeLogs({
          projectId: edgeLogsProjectId!,
          appId: selectedAppId,
          organizationSlug: edgeLogsOrganizationSlug ?? null,
        })
      : ["supabase", "edgeLogs", "disabled"],
    queryFn: async () => {
      const projectId = edgeLogsProjectId!;
      const lastTimestamp = lastLogTimestampRef.current[projectId];
      const timestampStart = lastTimestamp ?? Date.now() - 10 * 60 * 1000;
      return ipc.supabase.getEdgeLogs({
        projectId,
        timestampStart,
        appId: selectedAppId!,
        organizationSlug: edgeLogsOrganizationSlug ?? null,
      });
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
    const logs = edgeLogsQuery.data;
    if (!logs) return;

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
    setConsoleEntries((prev) => [...prev, ...newLogs]);

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
    isDeletingOrganization: deleteOrganizationMutation.isPending,
    isSettingAppProject: setAppProjectMutation.isPending,
    isUnsettingAppProject: unsetAppProjectMutation.isPending,
    isLoadingEdgeLogs: edgeLogsQuery.isFetching,

    // Actions
    refetchOrganizations: organizationsQuery.refetch,
    refetchProjects: projectsQuery.refetch,
    refetchBranches: branchesQuery.refetch,
    deleteOrganization: deleteOrganizationMutation.mutateAsync,
    setAppProject: setAppProjectMutation.mutateAsync,
    unsetAppProject: unsetAppProjectMutation.mutateAsync,
  };
}
