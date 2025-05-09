import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  supabaseProjectsAtom,
  supabaseLoadingAtom,
  supabaseErrorAtom,
  selectedSupabaseProjectAtom,
} from "@/atoms/supabaseAtoms";
import { IpcClient } from "@/ipc/ipc_client";

export function useSupabase() {
  const [projects, setProjects] = useAtom(supabaseProjectsAtom);
  const [loading, setLoading] = useAtom(supabaseLoadingAtom);
  const [error, setError] = useAtom(supabaseErrorAtom);
  const [selectedProject, setSelectedProject] = useAtom(
    selectedSupabaseProjectAtom,
  );

  const ipcClient = IpcClient.getInstance();

  /**
   * Load Supabase projects from the API
   */
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

  /**
   * Associate a Supabase project with an app
   */
  const setAppProject = useCallback(
    async (projectId: string, appId: number) => {
      setLoading(true);
      try {
        await ipcClient.setSupabaseAppProject(projectId, appId);
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
   * Select a project for current use
   */
  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
    },
    [setSelectedProject],
  );

  return {
    projects,
    loading,
    error,
    selectedProject,
    loadProjects,
    setAppProject,
    unsetAppProject,
    selectProject,
  };
}
