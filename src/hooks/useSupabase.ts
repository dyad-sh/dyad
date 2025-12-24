import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  supabaseBranchesAtom,
  selectedSupabaseProjectAtom,
  lastLogTimestampAtom,
} from "@/atoms/supabaseAtoms";
import { appConsoleEntriesAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import {
  SetSupabaseAppProjectParams,
  DeleteSupabaseOrganizationParams,
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
} from "@/ipc/ipc_types";

const SUPABASE_QUERY_KEYS = {
  organizations: ["supabase", "organizations"] as const,
  projects: ["supabase", "projects"] as const,
  branches: (projectId: string) => ["supabase", "branches", projectId] as const,
};

export function useSupabase() {
  const queryClient = useQueryClient();
  const [branches, setBranches] = useAtom(supabaseBranchesAtom);
  const [selectedProject, setSelectedProject] = useAtom(
    selectedSupabaseProjectAtom,
  );
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [lastLogTimestamp, setLastLogTimestamp] = useAtom(lastLogTimestampAtom);

  // Query: Load all connected Supabase organizations
  const organizationsQuery = useQuery<SupabaseOrganizationInfo[], Error>({
    queryKey: SUPABASE_QUERY_KEYS.organizations,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listSupabaseOrganizations();
    },
    meta: { showErrorToast: true },
  });

  // Query: Load Supabase projects from all connected organizations
  const projectsQuery = useQuery<SupabaseProject[], Error>({
    queryKey: SUPABASE_QUERY_KEYS.projects,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.listAllSupabaseProjects();
    },
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

  // Mutation: Load branches for a Supabase project
  // Using mutation because branches are stored in atom and depend on dynamic projectId
  const loadBranchesMutation = useMutation<
    SupabaseBranch[],
    Error,
    { projectId: string; organizationSlug?: string }
  >({
    mutationFn: async ({ projectId, organizationSlug }) => {
      const ipcClient = IpcClient.getInstance();
      const list = await ipcClient.listSupabaseBranches({
        projectId,
        organizationSlug: organizationSlug ?? null,
      });
      return Array.isArray(list) ? list : [];
    },
    onSuccess: (data) => {
      setBranches(data);
    },
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

  // Wrapper functions to preserve the existing API signatures
  const loadOrganizations = useCallback(async () => {
    await organizationsQuery.refetch();
  }, [organizationsQuery]);

  const loadProjects = useCallback(async () => {
    await projectsQuery.refetch();
  }, [projectsQuery]);

  const deleteOrganization = useCallback(
    async (params: DeleteSupabaseOrganizationParams) => {
      await deleteOrganizationMutation.mutateAsync(params);
    },
    [deleteOrganizationMutation],
  );

  const loadBranches = useCallback(
    async (projectId: string, organizationSlug?: string) => {
      await loadBranchesMutation.mutateAsync({ projectId, organizationSlug });
    },
    [loadBranchesMutation],
  );

  const setAppProject = useCallback(
    async (params: SetSupabaseAppProjectParams) => {
      await setAppProjectMutation.mutateAsync(params);
    },
    [setAppProjectMutation],
  );

  const unsetAppProject = useCallback(
    async (appId: number) => {
      await unsetAppProjectMutation.mutateAsync(appId);
    },
    [unsetAppProjectMutation],
  );

  const loadEdgeLogs = useCallback(
    async (projectId: string, organizationSlug?: string) => {
      await loadEdgeLogsMutation.mutateAsync({ projectId, organizationSlug });
    },
    [loadEdgeLogsMutation],
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
    },
    [setSelectedProject],
  );

  return {
    // Data
    organizations: organizationsQuery.data ?? [],
    projects: projectsQuery.data ?? [],
    branches,
    selectedProject,

    // Organizations query state
    isLoadingOrganizations: organizationsQuery.isLoading,
    isFetchingOrganizations: organizationsQuery.isFetching,
    organizationsError: organizationsQuery.error,

    // Projects query state
    isLoadingProjects: projectsQuery.isLoading,
    isFetchingProjects: projectsQuery.isFetching,
    projectsError: projectsQuery.error,

    // Mutation states
    isDeletingOrganization: deleteOrganizationMutation.isPending,
    isSettingAppProject: setAppProjectMutation.isPending,
    isUnsettingAppProject: unsetAppProjectMutation.isPending,
    isLoadingBranches: loadBranchesMutation.isPending,
    isLoadingEdgeLogs: loadEdgeLogsMutation.isPending,

    // Actions
    loadOrganizations,
    deleteOrganization,
    loadProjects,
    loadBranches,
    loadEdgeLogs,
    setAppProject,
    unsetAppProject,
    selectProject,
  };
}
