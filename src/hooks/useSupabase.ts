import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  supabaseProjectsAtom,
  supabaseBranchesAtom,
  supabaseLoadingAtom,
  supabaseErrorAtom,
  selectedSupabaseProjectAtom,
} from "@/atoms/supabaseAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { SetSupabaseAppProjectParams } from "@/ipc/ipc_types";

/**
 * A hook for managing Supabase projects and branches.
 * @returns {object} An object with the Supabase data, loading state, error, and functions to manage Supabase.
 * @property {any[]} projects - The list of Supabase projects.
 * @property {any[]} branches - The list of branches for the selected project.
 * @property {boolean} loading - Whether the Supabase data is being loaded.
 * @property {Error | null} error - The error object if any of the queries fail.
 * @property {string | null} selectedProject - The ID of the selected project.
 * @property {() => Promise<void>} loadProjects - A function to load the Supabase projects.
 * @property {(projectId: string) => Promise<void>} loadBranches - A function to load the branches for a project.
 * @property {(params: SetSupabaseAppProjectParams) => Promise<void>} setAppProject - A function to set the Supabase project for an app.
 * @property {(appId: number) => Promise<void>} unsetAppProject - A function to unset the Supabase project for an app.
 * @property {(projectId: string | null) => void} selectProject - A function to select a project.
 */
export function useSupabase() {
  const [projects, setProjects] = useAtom(supabaseProjectsAtom);
  const [branches, setBranches] = useAtom(supabaseBranchesAtom);
  const [loading, setLoading] = useAtom(supabaseLoadingAtom);
  const [error, setError] = useAtom(supabaseErrorAtom);
  const [selectedProject, setSelectedProject] = useAtom(
    selectedSupabaseProjectAtom,
  );

  const ipcClient = IpcClient.getInstance();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projectList = await ipcClient.listSupabaseProjects();
      setProjects(projectList);
      setError(null);
    } catch (error) {
      console.error("Error loading Supabase projects:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [ipcClient, setProjects, setError, setLoading]);

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

  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
    },
    [setSelectedProject],
  );

  return {
    projects,
    branches,
    loading,
    error,
    selectedProject,
    loadProjects,
    loadBranches,
    setAppProject,
    unsetAppProject,
    selectProject,
  };
}
