/**
 * Project Types
 * Projects are top-tier containers that can hold multiple apps
 */

export interface Project {
  id: number;
  name: string;
  description?: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
  color?: string; // For visual identification
  icon?: string; // Emoji or icon name
  tags?: string[];
  isFavorite: boolean;
}

export interface CreateProjectParams {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  tags?: string[];
}

export interface CreateProjectResult {
  success: boolean;
  project?: Project;
  error?: string;
}

export interface UpdateProjectParams {
  id: number;
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  tags?: string[];
  isFavorite?: boolean;
}

export interface UpdateProjectResult {
  success: boolean;
  project?: Project;
  error?: string;
}

export interface DeleteProjectParams {
  id: number;
  deleteApps?: boolean; // Whether to also delete all apps in the project
}

export interface DeleteProjectResult {
  success: boolean;
  error?: string;
}

export interface ListProjectsResult {
  projects: Project[];
}

export interface GetProjectResult {
  project?: Project;
  error?: string;
}

export interface ProjectWithApps extends Project {
  apps: Array<{
    id: number;
    name: string;
    path: string;
    createdAt: Date;
    updatedAt: Date;
    isFavorite: boolean;
  }>;
}
