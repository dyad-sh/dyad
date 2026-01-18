/**
 * React hooks for project management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";
import type {
  CreateProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  Project,
  ProjectWithApps,
} from "@/types/project_types";

/**
 * Hook to list all projects
 */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const result = await IpcClient.getInstance().listProjects();
      return result.projects;
    },
  });
}

/**
 * Hook to get a single project with its apps
 */
export function useProject(projectId: number | null) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const result = await IpcClient.getInstance().getProject(projectId);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.project as ProjectWithApps;
    },
    enabled: projectId !== null,
  });
}

/**
 * Hook to create a new project
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateProjectParams) => {
      const result = await IpcClient.getInstance().createProject(params);
      if (!result.success || !result.project) {
        throw new Error(result.error || "Failed to create project");
      }
      return result.project;
    },
    onSuccess: (project: Project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Project "${project.name}" created successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create project: ${error.message}`);
    },
  });
}

/**
 * Hook to update a project
 */
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateProjectParams) => {
      const result = await IpcClient.getInstance().updateProject(params);
      if (!result.success || !result.project) {
        throw new Error(result.error || "Failed to update project");
      }
      return result.project;
    },
    onSuccess: (project: Project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`Project "${project.name}" updated successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update project: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: DeleteProjectParams) => {
      const result = await IpcClient.getInstance().deleteProject(params);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete project");
      }
      return params.id;
    },
    onSuccess: (projectId: number) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.removeQueries({ queryKey: ["project", projectId] });
      toast.success("Project deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete project: ${error.message}`);
    },
  });
}

/**
 * Hook to toggle project favorite status
 */
export function useToggleProjectFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      isFavorite,
    }: {
      projectId: number;
      isFavorite: boolean;
    }) => {
      const result = await IpcClient.getInstance().updateProject({
        id: projectId,
        isFavorite,
      });
      if (!result.success || !result.project) {
        throw new Error(result.error || "Failed to update project");
      }
      return result.project;
    },
    onSuccess: (project: Project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update favorite: ${error.message}`);
    },
  });
}
