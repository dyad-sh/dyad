import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  supabaseProjectsAtom,
  supabaseBranchesAtom,
  supabaseLoadingAtom,
  supabaseErrorAtom,
  selectedSupabaseProjectAtom,
  supabaseOrganizationsAtom,
  selectedSupabaseOrganizationAtom,
} from "@/atoms/supabaseAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { SetSupabaseAppProjectParams } from "@/ipc/ipc_types";

export function useSupabase() {
  const [organizations, setOrganizations] = useAtom(supabaseOrganizationsAtom);
  const [selectedOrganization, setSelectedOrganization] = useAtom(
    selectedSupabaseOrganizationAtom,
  );
  const [projects, setProjects] = useAtom(supabaseProjectsAtom);
  const [branches, setBranches] = useAtom(supabaseBranchesAtom);
  const [loading, setLoading] = useAtom(supabaseLoadingAtom);
  const [error, setError] = useAtom(supabaseErrorAtom);
  const [selectedProject, setSelectedProject] = useAtom(
    selectedSupabaseProjectAtom,
  );

  const ipcClient = IpcClient.getInstance();

  /**
   * Load Supabase organizations from the API
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
   * Load Supabase projects from the API, optionally filtered by organization
   */
  const loadProjects = useCallback(
    async (orgId?: string) => {
      setLoading(true);
      try {
        const projectList = await ipcClient.listSupabaseProjects(
          orgId ? { orgId } : undefined,
        );
        setProjects(projectList);
        setError(null);
      } catch (error) {
        console.error("Error loading Supabase projects:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setLoading(false);
      }
    },
    [ipcClient, setProjects, setError, setLoading],
  );

  /**
   * Load branches for a Supabase project
   */
  const loadBranches = useCallback(
    async (projectId: string) => {
      setLoading(true);
      try {
        const list = await ipcClient.listSupabaseBranches({ projectId });
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
   * Select an organization for filtering projects
   */
  const selectOrganization = useCallback(
    (orgId: string | null) => {
      setSelectedOrganization(orgId);
    },
    [setSelectedOrganization],
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
    selectedOrganization,
    projects,
    branches,
    loading,
    error,
    selectedProject,
    loadOrganizations,
    loadProjects,
    loadBranches,
    setAppProject,
    unsetAppProject,
    selectOrganization,
    selectProject,
  };
}
