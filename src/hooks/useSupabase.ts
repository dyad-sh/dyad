import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { lastLogTimestampAtom } from "@/atoms/supabaseAtoms";
import { appConsoleEntriesAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import {
  SetSupabaseAppProjectParams,
  DeleteSupabaseOrganizationParams,
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
} from "@/ipc/ipc_types";
import { useSettings } from "./useSettings";
import { isSupabaseConnected } from "@/lib/schemas";

const SUPABASE_QUERY_KEYS = {
  organizations: ["supabase", "organizations"] as const,
  projects: ["supabase", "projects"] as const,
  branches: (projectId: string) => ["supabase", "branches", projectId] as const,
};

export interface UseSupabaseOptions {
  branchesProjectId?: string | null;
  branchesOrganizationSlug?: string | null;
}

export function useSupabase(options: UseSupabaseOptions = {}) {
  const { branchesProjectId, branchesOrganizationSlug } = options;
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const isConnected = isSupabaseConnected(settings);

  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [lastLogTimestamp, setLastLogTimestamp] = useAtom(lastLogTimestampAtom);

  // Query: Load all connected Supabase organizations
  // Only runs when Supabase is connected to avoid unnecessary API calls
  const organizationsQuery = useQuery<SupabaseOrganizationInfo[], Error>({
    queryKey: SUPABASE_QUERY_KEYS.organizations,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listSupabaseOrganizations();
    },
    enabled: isConnected,
    meta: { showErrorToast: true },
  });

  // Query: Load Supabase projects from all connected organizations
  // Only runs when there are connected organizations to avoid unauthorized errors
  const projectsQuery = useQuery<SupabaseProject[], Error>({
    queryKey: SUPABASE_QUERY_KEYS.projects,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listAllSupabaseProjects();
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
      const ipcClient = IpcClient.getInstance();
      await ipcClient.deleteSupabaseOrganization(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: SUPABASE_QUERY_KEYS.organizations,
      });
      queryClient.invalidateQueries({ queryKey: SUPABASE_QUERY_KEYS.projects });
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
      const ipcClient = IpcClient.getInstance();
      await ipcClient.setSupabaseAppProject(params);
    },
    meta: { showErrorToast: true },
  });

  // Mutation: Remove a Supabase project association from an app
  const unsetAppProjectMutation = useMutation<void, Error, number>({
    mutationFn: async (appId) => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.unsetSupabaseAppProject(appId);
    },
    meta: { showErrorToast: true },
  });

  // Query: Load branches for a Supabase project
  const branchesQuery = useQuery<SupabaseBranch[], Error>({
    queryKey: [
      ...SUPABASE_QUERY_KEYS.branches(branchesProjectId ?? ""),
      branchesOrganizationSlug ?? null,
    ],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      const list = await ipcClient.listSupabaseBranches({
        projectId: branchesProjectId!,
        organizationSlug: branchesOrganizationSlug ?? null,
      });
      return Array.isArray(list) ? list : [];
    },
    enabled: !!branchesProjectId,
    meta: { showErrorToast: true },
  });

  // Mutation: Load edge function logs for a Supabase project
  // Using mutation because it has side effects (updating console entries)
  const loadEdgeLogsMutation = useMutation<
    void,
    Error,
    { projectId: string; organizationSlug?: string }
  >({
    mutationFn: async ({ projectId, organizationSlug }) => {
      if (!selectedAppId) return;

      const ipcClient = IpcClient.getInstance();

      // Use last timestamp if available, otherwise fetch logs from the past 10 minutes
      const lastTimestamp = lastLogTimestamp[projectId];
      const timestampStart = lastTimestamp ?? Date.now() - 10 * 60 * 1000;

      const logs = await ipcClient.getSupabaseEdgeLogs({
        projectId,
        timestampStart,
        appId: selectedAppId,
        organizationSlug: organizationSlug ?? null,
      });

      if (logs.length === 0) {
        // Even if no logs, set the timestamp so we don't keep looking back 10 minutes
        if (!lastTimestamp) {
          setLastLogTimestamp((prev) => ({
            ...prev,
            [projectId]: Date.now(),
          }));
        }
        return;
      }

      // Logs are already in ConsoleEntry format, just append them
      setConsoleEntries((prev) => [...prev, ...logs]);

      // Update the last timestamp for this project
      const latestLog = logs.reduce((latest, log) =>
        log.timestamp > latest.timestamp ? log : latest,
      );
      setLastLogTimestamp((prev) => ({
        ...prev,
        [projectId]: latestLog.timestamp,
      }));
    },
  });

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
    isLoadingEdgeLogs: loadEdgeLogsMutation.isPending,

    // Actions
    refetchOrganizations: organizationsQuery.refetch,
    refetchProjects: projectsQuery.refetch,
    refetchBranches: branchesQuery.refetch,
    deleteOrganization: deleteOrganizationMutation.mutateAsync,
    loadEdgeLogs: loadEdgeLogsMutation.mutateAsync,
    setAppProject: setAppProjectMutation.mutateAsync,
    unsetAppProject: unsetAppProjectMutation.mutateAsync,
  };
}
