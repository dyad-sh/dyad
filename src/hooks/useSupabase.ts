import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  supabaseOrganizationsAtom,
  supabaseProjectsAtom,
  supabaseBranchesAtom,
  supabaseLoadingAtom,
  supabaseErrorAtom,
  selectedSupabaseProjectAtom,
  lastLogTimestampAtom,
} from "@/atoms/supabaseAtoms";
import { appConsoleEntriesAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import {
  SetSupabaseAppProjectParams,
  DeleteSupabaseOrganizationParams,
} from "@/ipc/ipc_types";

export function useSupabase() {
  const [organizations, setOrganizations] = useAtom(supabaseOrganizationsAtom);
  const [projects, setProjects] = useAtom(supabaseProjectsAtom);
  const [branches, setBranches] = useAtom(supabaseBranchesAtom);
  const [loading, setLoading] = useAtom(supabaseLoadingAtom);
  const [error, setError] = useAtom(supabaseErrorAtom);
  const [selectedProject, setSelectedProject] = useAtom(
    selectedSupabaseProjectAtom,
  );
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [lastLogTimestamp, setLastLogTimestamp] = useAtom(lastLogTimestampAtom);

  const ipcClient = IpcClient.getInstance();

  /**
   * Load all connected Supabase organizations
   */
  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const orgList = await ipcClient.listSupabaseOrganizations();
      setOrganizations(orgList);
      setError(null);
    } catch (error) {
      console.error("Error loading Supabase organizations:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [ipcClient, setOrganizations, setError, setLoading]);

  /**
   * Delete a Supabase organization connection
   */
  const deleteOrganization = useCallback(
    async (params: DeleteSupabaseOrganizationParams) => {
      setLoading(true);
      try {
        await ipcClient.deleteSupabaseOrganization(params);
        // Refresh organizations list after deletion
        const orgList = await ipcClient.listSupabaseOrganizations();
        setOrganizations(orgList);
        setError(null);
      } catch (error) {
        console.error("Error deleting Supabase organization:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [ipcClient, setOrganizations, setError, setLoading],
  );

  /**
   * Load Supabase projects from all connected organizations
   */
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projectList = await ipcClient.listAllSupabaseProjects();
      setProjects(projectList);
      setError(null);
    } catch (error) {
      console.error("Error loading Supabase projects:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [ipcClient, setProjects, setError, setLoading]);

  /**
   * Load branches for a Supabase project
   */
  const loadBranches = useCallback(
    async (projectId: string, organizationId?: string) => {
      setLoading(true);
      try {
        const list = await ipcClient.listSupabaseBranches({
          projectId,
          organizationId: organizationId ?? null,
        });
        setBranches(Array.isArray(list) ? list : []);
        setError(null);
      } catch (error) {
        console.error("Error loading Supabase branches:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setLoading(false);
      }
    },
    [ipcClient, setBranches, setError, setLoading],
  );

  /**
   * Associate a Supabase project with an app
   */
  const setAppProject = useCallback(
    async (params: SetSupabaseAppProjectParams) => {
      setLoading(true);
      try {
        await ipcClient.setSupabaseAppProject(params);
        setError(null);
      } catch (error) {
        console.error("Error setting Supabase project for app:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [ipcClient, setError, setLoading],
  );

  /**
   * Remove a Supabase project association from an app
   */
  const unsetAppProject = useCallback(
    async (appId: number) => {
      setLoading(true);
      try {
        await ipcClient.unsetSupabaseAppProject(appId);
        setError(null);
      } catch (error) {
        console.error("Error unsetting Supabase project for app:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [ipcClient, setError, setLoading],
  );

  /**
   * Load edge function logs for a Supabase project
   * Uses timestamp tracking to only fetch new logs on subsequent calls
   */
  const loadEdgeLogs = useCallback(
    async (projectId: string, organizationId?: string) => {
      if (!selectedAppId) return;

      // Use last timestamp if available, otherwise fetch logs from the past 10 minutes
      const lastTimestamp = lastLogTimestamp[projectId];
      const timestampStart = lastTimestamp ?? Date.now() - 10 * 60 * 1000; // 10 minutes ago

      setLoading(true);
      try {
        // Fetch logs - handler returns ConsoleEntry[] already formatted
        const logs = await ipcClient.getSupabaseEdgeLogs({
          projectId,
          timestampStart,
          appId: selectedAppId,
          organizationId: organizationId ?? null,
        });

        if (logs.length === 0) {
          // Even if no logs, set the timestamp so we don't keep looking back 10 minutes
          if (!lastTimestamp) {
            setLastLogTimestamp((prev) => ({
              ...prev,
              [projectId]: Date.now(),
            }));
          }
          setError(null);
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

        setError(null);
      } catch (error) {
        console.error("Error loading Supabase edge logs:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setLoading(false);
      }
    },
    [
      ipcClient,
      setConsoleEntries,
      setError,
      setLoading,
      selectedAppId,
      lastLogTimestamp,
      setLastLogTimestamp,
    ],
  );

  /**
   * Select a project for current use
   */
  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
    },
    [setSelectedProject],
  );

  return {
    organizations,
    projects,
    branches,
    loading,
    error,
    selectedProject,
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
