/**
 * Project Handlers
 * IPC handlers for project CRUD operations
 */

import { ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { getDb } from "../../db/index";
import { projects, apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import type {
  CreateProjectParams,
  CreateProjectResult,
  UpdateProjectParams,
  UpdateProjectResult,
  DeleteProjectParams,
  DeleteProjectResult,
  ListProjectsResult,
  GetProjectResult,
  ProjectWithApps,
} from "../../types/project_types";

const PROJECTS_BASE_DIR = path.join(process.cwd(), "userData", "projects");

/**
 * Ensure projects directory exists
 */
async function ensureProjectsDir(): Promise<void> {
  try {
    await fs.access(PROJECTS_BASE_DIR);
  } catch {
    await fs.mkdir(PROJECTS_BASE_DIR, { recursive: true });
  }
}

/**
 * Create a new project
 */
export async function createProject(
  params: CreateProjectParams
): Promise<CreateProjectResult> {
  try {
    await ensureProjectsDir();

    // Create project directory
    const projectPath = path.join(PROJECTS_BASE_DIR, params.name);
    
    try {
      await fs.access(projectPath);
      return {
        success: false,
        error: `Project "${params.name}" already exists`,
      };
    } catch {
      // Directory doesn't exist, which is what we want
    }

    await fs.mkdir(projectPath, { recursive: true });

    // Insert into database
    const db = getDb();
    const result = await db
      .insert(projects)
      .values({
        name: params.name,
        description: params.description,
        path: projectPath,
        color: params.color,
        icon: params.icon,
        tags: params.tags || [],
      })
      .returning();

    const project = result[0];

    return {
      success: true,
      project: {
        ...project,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
        isFavorite: Boolean(project.isFavorite),
        tags: project.tags || [],
      },
    };
  } catch (error) {
    console.error("Failed to create project:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * List all projects
 */
export async function listProjects(): Promise<ListProjectsResult> {
  try {
    const db = getDb();
    const allProjects = await db.select().from(projects).all();

    return {
      projects: allProjects.map((p) => ({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        isFavorite: Boolean(p.isFavorite),
        tags: p.tags || [],
      })),
    };
  } catch (error) {
    console.error("Failed to list projects:", error);
    return { projects: [] };
  }
}

/**
 * Get a single project with its apps
 */
export async function getProject(
  projectId: number
): Promise<GetProjectResult> {
  try {
    const db = getDb();
    
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    if (!project) {
      return { error: "Project not found" };
    }

    const projectApps = await db
      .select({
        id: apps.id,
        name: apps.name,
        path: apps.path,
        createdAt: apps.createdAt,
        updatedAt: apps.updatedAt,
        isFavorite: apps.isFavorite,
      })
      .from(apps)
      .where(eq(apps.projectId, projectId))
      .all();

    const projectWithApps: ProjectWithApps = {
      ...project,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      isFavorite: Boolean(project.isFavorite),
      tags: project.tags || [],
      apps: projectApps.map((a) => ({
        ...a,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
        isFavorite: Boolean(a.isFavorite),
      })),
    };

    return { project: projectWithApps };
  } catch (error) {
    console.error("Failed to get project:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update a project
 */
export async function updateProject(
  params: UpdateProjectParams
): Promise<UpdateProjectResult> {
  try {
    const db = getDb();

    const updateData: any = {};
    if (params.name !== undefined) updateData.name = params.name;
    if (params.description !== undefined) updateData.description = params.description;
    if (params.color !== undefined) updateData.color = params.color;
    if (params.icon !== undefined) updateData.icon = params.icon;
    if (params.tags !== undefined) updateData.tags = params.tags;
    if (params.isFavorite !== undefined) updateData.isFavorite = params.isFavorite;

    const result = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, params.id))
      .returning();

    if (result.length === 0) {
      return {
        success: false,
        error: "Project not found",
      };
    }

    const project = result[0];

    return {
      success: true,
      project: {
        ...project,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
        isFavorite: Boolean(project.isFavorite),
        tags: project.tags || [],
      },
    };
  } catch (error) {
    console.error("Failed to update project:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a project
 */
export async function deleteProject(
  params: DeleteProjectParams
): Promise<DeleteProjectResult> {
  try {
    const db = getDb();

    // If deleteApps is true, delete all apps in the project
    if (params.deleteApps) {
      // Get all apps in the project
      const projectApps = await db
        .select()
        .from(apps)
        .where(eq(apps.projectId, params.id))
        .all();

      // Delete app directories
      for (const app of projectApps) {
        try {
          await fs.rm(app.path, { recursive: true, force: true });
        } catch (error) {
          console.warn(`Failed to delete app directory ${app.path}:`, error);
        }
      }

      // Delete apps from database (cascade will handle chats, messages, versions)
      await db.delete(apps).where(eq(apps.projectId, params.id));
    } else {
      // Just unlink apps from the project
      await db
        .update(apps)
        .set({ projectId: null })
        .where(eq(apps.projectId, params.id));
    }

    // Get project path before deletion
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, params.id))
      .get();

    if (!project) {
      return {
        success: false,
        error: "Project not found",
      };
    }

    // Delete project from database
    await db.delete(projects).where(eq(projects.id, params.id));

    // Delete project directory
    try {
      await fs.rm(project.path, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to delete project directory ${project.path}:`, error);
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to delete project:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Register project IPC handlers
 */
export function registerProjectHandlers(): void {
  ipcMain.handle("project:create", async (_, params: CreateProjectParams) => {
    return await createProject(params);
  });

  ipcMain.handle("project:list", async () => {
    return await listProjects();
  });

  ipcMain.handle("project:get", async (_, projectId: number) => {
    return await getProject(projectId);
  });

  ipcMain.handle("project:update", async (_, params: UpdateProjectParams) => {
    return await updateProject(params);
  });

  ipcMain.handle("project:delete", async (_, params: DeleteProjectParams) => {
    return await deleteProject(params);
  });
}
