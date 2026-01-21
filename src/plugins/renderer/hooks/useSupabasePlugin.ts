/**
 * Supabase Plugin Hook
 *
 * Provides a React hook for interacting with the Supabase plugin.
 * This is a refactored version of the original useSupabase hook that uses
 * the plugin system architecture.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { IpcClient } from "../../../ipc/ipc_client";
import { useSettings } from "../../../hooks/useSettings";
import { isSupabaseConnected } from "../../../lib/schemas";
import { lastLogTimestampAtom } from "../../../atoms/supabaseAtoms";
import { appConsoleEntriesAtom, selectedAppIdAtom } from "../../../atoms/appAtoms";
import { SUPABASE_PLUGIN_ID } from "../../supabase";
import { pluginQueryKey } from "./usePlugin";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SupabaseOrganization {
  organizationSlug: string;
  name?: string;
  ownerEmail?: string;
}

export interface SupabaseProject {
  id: string;
  name: string;
  region?: string;
  organizationSlug: string;
}

export interface SupabaseBranch {
  id: string;
  name: string;
  isDefault: boolean;
  projectRef: string;
  parentProjectRef?: string;
}

export interface ConsoleEntry {
  level: "info" | "warn" | "error";
  type: "edge-function";
  message: string;
  timestamp: number;
  sourceName?: string;
  appId: number;
}

// ─────────────────────────────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────────────────────────────

const QUERY_KEYS = {
  organizations: pluginQueryKey(SUPABASE_PLUGIN_ID, "list-organizations"),
  projects: pluginQueryKey(SUPABASE_PLUGIN_ID, "list-all-projects"),
  branches: (projectId: string, organizationSlug: string | null) =>
    pluginQueryKey(SUPABASE_PLUGIN_ID, "list-branches", projectId, organizationSlug),
};

// ─────────────────────────────────────────────────────────────────────
// Hook Options
// ─────────────────────────────────────────────────────────────────────

export interface UseSupabasePluginOptions {
  branchesProjectId?: string | null;
  branchesOrganizationSlug?: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────

/**
 * Hook for interacting with the Supabase plugin.
 *
 * This provides all the same functionality as the original useSupabase hook
 * but is built on top of the plugin system architecture.
 */
export function useSupabasePlugin(options: UseSupabasePluginOptions = {}) {
  const { branchesProjectId, branchesOrganizationSlug } = options;
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const isConnected = isSupabaseConnected(settings);

  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [lastLogTimestamp, setLastLogTimestamp] = useAtom(lastLogTimestampAtom);

  // ─────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────

  // Query: Load all connected Supabase organizations
  const organizationsQuery = useQuery<SupabaseOrganization[], Error>({
    queryKey: QUERY_KEYS.organizations,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:list-organizations`, undefined);
    },
    enabled: isConnected,
    meta: { showErrorToast: true },
  });

  // Query: Load Supabase projects from all connected organizations
  const projectsQuery = useQuery<SupabaseProject[], Error>({
    queryKey: QUERY_KEYS.projects,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:list-all-projects`, undefined);
    },
    enabled: (organizationsQuery.data?.length ?? 0) > 0,
    meta: { showErrorToast: true },
  });

  // Query: Load branches for a Supabase project
  const branchesQuery = useQuery<SupabaseBranch[], Error>({
    queryKey: QUERY_KEYS.branches(branchesProjectId ?? "", branchesOrganizationSlug ?? null),
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      const list = await ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:list-branches`, {
        projectId: branchesProjectId!,
        organizationSlug: branchesOrganizationSlug ?? null,
      });
      return Array.isArray(list) ? list : [];
    },
    enabled: !!branchesProjectId,
    meta: { showErrorToast: true },
  });

  // ─────────────────────────────────────────────────────────────────
  // Mutations
  // ─────────────────────────────────────────────────────────────────

  // Mutation: Delete a Supabase organization connection
  const deleteOrganizationMutation = useMutation<void, Error, { organizationSlug: string }>({
    mutationFn: async (params) => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:delete-organization`, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.organizations });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects });
    },
    meta: { showErrorToast: true },
  });

  // Mutation: Associate a Supabase project with an app
  const setAppProjectMutation = useMutation<
    void,
    Error,
    {
      projectId: string;
      appId: number;
      parentProjectId?: string;
      organizationSlug: string;
    }
  >({
    mutationFn: async (params) => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:set-app-project`, params);
    },
    meta: { showErrorToast: true },
  });

  // Mutation: Remove a Supabase project association from an app
  const unsetAppProjectMutation = useMutation<void, Error, number>({
    mutationFn: async (appId) => {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke(`${SUPABASE_PLUGIN_ID}:unset-app-project`, { app: appId });
    },
    meta: { showErrorToast: true },
  });

  // Mutation: Load edge function logs
  const loadEdgeLogsMutation = useMutation<
    void,
    Error,
    { projectId: string; organizationSlug?: string }
  >({
    mutationFn: async ({ projectId, organizationSlug }) => {
      if (!selectedAppId) return;

      const ipcClient = IpcClient.getInstance();

      const lastTimestamp = lastLogTimestamp[projectId];
      const timestampStart = lastTimestamp ?? Date.now() - 10 * 60 * 1000;

      const logs: ConsoleEntry[] = await ipcClient.invoke(
        `${SUPABASE_PLUGIN_ID}:get-edge-logs`,
        {
          projectId,
          timestampStart,
          appId: selectedAppId,
          organizationSlug: organizationSlug ?? null,
        },
      );

      if (logs.length === 0) {
        if (!lastTimestamp) {
          setLastLogTimestamp((prev) => ({
            ...prev,
            [projectId]: Date.now(),
          }));
        }
        return;
      }

      logs.forEach((log) => {
        IpcClient.getInstance().addLog(log);
      });
      setConsoleEntries((prev) => [...prev, ...logs]);

      const latestLog = logs.reduce((latest, log) =>
        log.timestamp > latest.timestamp ? log : latest,
      );
      setLastLogTimestamp((prev) => ({
        ...prev,
        [projectId]: latestLog.timestamp,
      }));
    },
  });

  // ─────────────────────────────────────────────────────────────────
  // Return Value
  // ─────────────────────────────────────────────────────────────────

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
