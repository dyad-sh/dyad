import { ipcMain, IpcMainInvokeEvent } from "electron";
import { Vercel } from "@vercel/sdk";
import { writeSettings, readSettings } from "../../main/settings";
import * as schema from "../../db/schema";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { IS_TEST_BUILD } from "../utils/test_utils";
import * as fs from "fs";
import * as path from "path";
import { CreateProjectFramework } from "@vercel/sdk/models/createprojectop.js";
import { getAbbaAppPath } from "@/paths/paths";
import {
  CreateVercelProjectParams,
  IsVercelProjectAvailableParams,
  SaveVercelAccessTokenParams,
  VercelDeployment,
  VercelProject,
  VercelTestConnectionResult,
  VercelDeployParams,
  VercelDeployResult,
} from "../ipc_types";
import { ConnectToExistingVercelProjectParams } from "../ipc_types";
import { GetVercelDeploymentsParams } from "../ipc_types";
import { DisconnectVercelProjectParams } from "../ipc_types";
import { createLoggedHandler } from "./safe_handle";
import { simpleSpawn } from "../utils/simpleSpawn";
import * as crypto from "crypto";

const logger = log.scope("vercel_handlers");
const handle = createLoggedHandler(logger);

// Use test server URLs when in test mode
const TEST_SERVER_BASE = "http://localhost:3500";

const VERCEL_API_BASE = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/vercel/api`
  : "https://api.vercel.com";

// --- Helper Functions ---

function createVercelClient(token: string): Vercel {
  return new Vercel({
    bearerToken: token,
    ...(IS_TEST_BUILD && { serverURL: VERCEL_API_BASE }),
  });
}

interface VercelProjectResponse {
  id: string;
  name: string;
  framework?: string | null;
  targets?: {
    production?: {
      url?: string;
    };
  };
}

interface GetVercelProjectsResponse {
  projects: VercelProjectResponse[];
}

/**
 * Fetch Vercel projects via HTTP request (bypasses the broken SDK).
 * Mimics the SDK's `vercel.projects.getProjects` API.
 */
async function getVercelProjects(
  token: string,
  options?: { search?: string },
): Promise<GetVercelProjectsResponse> {
  const url = new URL(`${VERCEL_API_BASE}/v9/projects`);
  if (options?.search) {
    url.searchParams.set("search", options.search);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Vercel projects: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  return {
    projects: data.projects || [],
  };
}

async function validateVercelToken(token: string): Promise<boolean> {
  try {
    const vercel = createVercelClient(token);
    await vercel.user.getAuthUser();
    return true;
  } catch (error) {
    logger.error("Error validating Vercel token:", error);
    return false;
  }
}

/**
 * Get authenticated user info from Vercel.
 */
async function getVercelUser(
  token: string,
): Promise<{ username: string; id: string }> {
  const response = await fetch(`${VERCEL_API_BASE}/v2/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Vercel user: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  return {
    username: data.user?.username || data.user?.name || "unknown",
    id: data.user?.id || "unknown",
  };
}

/**
 * Recursively enumerate files in a directory.
 */
function enumerateFiles(dir: string, basePath: string = ""): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...enumerateFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Upload a single file to Vercel.
 */
async function uploadFileToVercel(
  token: string,
  filePath: string,
  teamId?: string,
): Promise<string> {
  const content = fs.readFileSync(filePath);
  const sha = crypto.createHash("sha1").update(content).digest("hex");

  const url = new URL(`${VERCEL_API_BASE}/v2/files`);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha,
      "Content-Length": content.length.toString(),
    },
    body: content,
  });

  if (!response.ok && response.status !== 409) {
    // 409 means file already exists, which is fine
    const errorText = await response.text();
    throw new Error(
      `Failed to upload file: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return sha;
}

/**
 * Create a deployment on Vercel.
 */
async function createVercelDeployment(
  token: string,
  projectName: string,
  files: Array<{ file: string; sha: string; size: number }>,
  target: "production" | "preview",
  teamId?: string,
): Promise<{ id: string; url: string; readyState: string }> {
  const url = new URL(`${VERCEL_API_BASE}/v13/deployments`);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      target,
      files,
      projectSettings: {
        framework: null, // Auto-detect
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create deployment: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  return {
    id: data.id,
    url: data.url,
    readyState: data.readyState || "QUEUED",
  };
}

/**
 * Poll deployment status until ready or error.
 */
async function pollDeploymentStatus(
  token: string,
  deploymentId: string,
  teamId?: string,
  maxAttempts: number = 60,
  intervalMs: number = 3000,
): Promise<{ url: string; readyState: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const url = new URL(`${VERCEL_API_BASE}/v13/deployments/${deploymentId}`);
    if (teamId) {
      url.searchParams.set("teamId", teamId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get deployment status: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const readyState = data.readyState;

    logger.info(`Deployment ${deploymentId} status: ${readyState}`);

    if (readyState === "READY") {
      return {
        url: `https://${data.url}`,
        readyState,
      };
    }

    if (readyState === "ERROR" || readyState === "CANCELED") {
      throw new Error(`Deployment failed with status: ${readyState}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Deployment timed out");
}

async function getDefaultTeamId(token: string): Promise<string> {
  try {
    const response = await fetch(`${VERCEL_API_BASE}/v2/teams?limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch teams: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Use the first team (typically the personal account or default team)
    if (data.teams && data.teams.length > 0) {
      return data.teams[0].id;
    }

    throw new Error("No teams found for this user");
  } catch (error) {
    logger.error("Error getting default team ID:", error);
    throw new Error("Failed to get team information");
  }
}

async function detectFramework(
  appPath: string,
): Promise<CreateProjectFramework | undefined> {
  try {
    // Check for specific config files first
    const configFiles: Array<{
      file: string;
      framework: CreateProjectFramework;
    }> = [
      { file: "next.config.js", framework: "nextjs" },
      { file: "next.config.mjs", framework: "nextjs" },
      { file: "next.config.ts", framework: "nextjs" },
      { file: "vite.config.js", framework: "vite" },
      { file: "vite.config.ts", framework: "vite" },
      { file: "vite.config.mjs", framework: "vite" },
      { file: "nuxt.config.js", framework: "nuxtjs" },
      { file: "nuxt.config.ts", framework: "nuxtjs" },
      { file: "astro.config.js", framework: "astro" },
      { file: "astro.config.mjs", framework: "astro" },
      { file: "astro.config.ts", framework: "astro" },
      { file: "svelte.config.js", framework: "svelte" },
    ];

    for (const { file, framework } of configFiles) {
      if (fs.existsSync(path.join(appPath, file))) {
        return framework;
      }
    }

    // Check package.json for dependencies
    const packageJsonPath = path.join(appPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for framework dependencies in order of preference
      if (dependencies.next) return "nextjs";
      if (dependencies.vite) return "vite";
      if (dependencies.nuxt) return "nuxtjs";
      if (dependencies.astro) return "astro";
      if (dependencies.svelte) return "svelte";
      if (dependencies["@angular/core"]) return "angular";
      if (dependencies.vue) return "vue";
      if (dependencies["react-scripts"]) return "create-react-app";
      if (dependencies.gatsby) return "gatsby";
      if (dependencies.remix) return "remix";
    }

    // Default fallback
    return undefined;
  } catch (error) {
    logger.error("Error detecting framework:", error);
    return undefined;
  }
}

// --- IPC Handlers ---

async function handleSaveVercelToken(
  event: IpcMainInvokeEvent,
  { token }: SaveVercelAccessTokenParams,
): Promise<void> {
  logger.debug("Saving Vercel access token");

  if (!token || token.trim() === "") {
    throw new Error("Access token is required.");
  }

  try {
    // Validate the token by making a test API call
    const isValid = await validateVercelToken(token.trim());
    if (!isValid) {
      throw new Error(
        "Invalid access token. Please check your token and try again.",
      );
    }

    writeSettings({
      vercelAccessToken: {
        value: token.trim(),
      },
    });

    logger.log("Successfully saved Vercel access token.");
  } catch (error: any) {
    logger.error("Error saving Vercel token:", error);
    throw new Error(`Failed to save access token: ${error.message}`);
  }
}

// --- Vercel List Projects Handler ---
async function handleListVercelProjects(): Promise<VercelProject[]> {
  try {
    const settings = readSettings();
    const accessToken = settings.vercelAccessToken?.value;
    if (!accessToken) {
      throw new Error("Not authenticated with Vercel.");
    }

    const response = await getVercelProjects(accessToken);

    if (!response.projects) {
      throw new Error("Failed to retrieve projects from Vercel.");
    }

    return response.projects.map((project) => ({
      id: project.id,
      name: project.name,
      framework: project.framework || null,
    }));
  } catch (err: any) {
    logger.error("[Vercel Handler] Failed to list projects:", err);
    throw new Error(err.message || "Failed to list Vercel projects.");
  }
}

// --- Vercel Project Availability Handler ---
async function handleIsProjectAvailable(
  event: IpcMainInvokeEvent,
  { name }: IsVercelProjectAvailableParams,
): Promise<{ available: boolean; error?: string }> {
  try {
    const settings = readSettings();
    const accessToken = settings.vercelAccessToken?.value;
    if (!accessToken) {
      return { available: false, error: "Not authenticated with Vercel." };
    }

    // Check if project name is available by searching for projects with that name
    const response = await getVercelProjects(accessToken, { search: name });

    if (!response.projects) {
      return {
        available: false,
        error: "Failed to check project availability.",
      };
    }

    const projectExists = response.projects.some(
      (project) => project.name === name,
    );

    return {
      available: !projectExists,
      error: projectExists ? "Project name is not available." : undefined,
    };
  } catch (err: any) {
    return { available: false, error: err.message || "Unknown error" };
  }
}

// --- Vercel Create Project Handler ---
async function handleCreateProject(
  event: IpcMainInvokeEvent,
  { name, appId }: CreateVercelProjectParams,
): Promise<void> {
  const settings = readSettings();
  const accessToken = settings.vercelAccessToken?.value;
  if (!accessToken) {
    throw new Error("Not authenticated with Vercel.");
  }

  try {
    logger.info(`Creating Vercel project: ${name} for app ${appId}`);

    // Get app details to determine the framework
    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app) {
      throw new Error("App not found.");
    }

    // Check if app has GitHub repository configured
    if (!app.githubOrg || !app.githubRepo) {
      throw new Error(
        "App must be connected to a GitHub repository before creating a Vercel project.",
      );
    }

    // Detect the framework from the app's directory
    const detectedFramework = await detectFramework(getAbbaAppPath(app.path));

    logger.info(
      `Detected framework: ${detectedFramework || "none detected"} for app at ${app.path}`,
    );

    const vercel = createVercelClient(accessToken);

    const projectData = await vercel.projects.createProject({
      requestBody: {
        name: name,
        gitRepository: {
          type: "github",
          repo: `${app.githubOrg}/${app.githubRepo}`,
        },
        framework: detectedFramework,
      },
    });
    if (!projectData.id) {
      throw new Error("Failed to create project: No project ID returned.");
    }

    // Get the default team ID
    const teamId = await getDefaultTeamId(accessToken);

    const projectDomains = await vercel.projects.getProjectDomains({
      idOrName: projectData.id,
    });
    const projectUrl = "https://" + projectDomains.domains[0].name;

    // Store project info in the app's DB row
    await updateAppVercelProject({
      appId,
      projectId: projectData.id,
      projectName: projectData.name,
      teamId: teamId,
      deploymentUrl: projectUrl,
    });

    logger.info(
      `Successfully created Vercel project: ${projectData.id} with GitHub repo: ${app.githubOrg}/${app.githubRepo}`,
    );

    // Trigger the first deployment
    logger.info(`Triggering first deployment for project: ${projectData.id}`);
    try {
      // Create deployment via Vercel SDK using the project settings we just created
      const deploymentData = await vercel.deployments.createDeployment({
        requestBody: {
          name: projectData.name,
          project: projectData.id,
          target: "production",
          gitSource: {
            type: "github",
            org: app.githubOrg,
            repo: app.githubRepo,
            ref: app.githubBranch || "main",
          },
        },
      });

      if (deploymentData.url) {
        logger.info(`First deployment successful: ${deploymentData.url}`);
      } else {
        logger.warn("First deployment failed: No deployment URL returned");
      }
    } catch (deployError: any) {
      logger.warn(`First deployment failed with error: ${deployError.message}`);
      // Don't throw here - project creation was successful, deployment failure is non-critical
    }
  } catch (err: any) {
    logger.error("[Vercel Handler] Failed to create project:", err);
    throw new Error(err.message || "Failed to create Vercel project.");
  }
}

// --- Vercel Connect to Existing Project Handler ---
async function handleConnectToExistingProject(
  event: IpcMainInvokeEvent,
  { projectId, appId }: ConnectToExistingVercelProjectParams,
): Promise<void> {
  try {
    const settings = readSettings();
    const accessToken = settings.vercelAccessToken?.value;
    if (!accessToken) {
      throw new Error("Not authenticated with Vercel.");
    }

    logger.info(
      `Connecting to existing Vercel project: ${projectId} for app ${appId}`,
    );

    // Verify the project exists and get its details
    const response = await getVercelProjects(accessToken);
    const projectData = response.projects?.find(
      (p) => p.id === projectId || p.name === projectId,
    );

    if (!projectData) {
      throw new Error("Project not found. Please check the project ID.");
    }

    // Get the default team ID
    const teamId = await getDefaultTeamId(accessToken);

    // Store project info in the app's DB row
    await updateAppVercelProject({
      appId,
      projectId: projectData.id,
      projectName: projectData.name,
      teamId: teamId,
      deploymentUrl: projectData.targets?.production?.url
        ? `https://${projectData.targets.production.url}`
        : null,
    });

    logger.info(`Successfully connected to Vercel project: ${projectData.id}`);
  } catch (err: any) {
    logger.error(
      "[Vercel Handler] Failed to connect to existing project:",
      err,
    );
    throw new Error(err.message || "Failed to connect to existing project.");
  }
}

// --- Vercel Get Deployments Handler ---
async function handleGetVercelDeployments(
  event: IpcMainInvokeEvent,
  { appId }: GetVercelDeploymentsParams,
): Promise<VercelDeployment[]> {
  try {
    const settings = readSettings();
    const accessToken = settings.vercelAccessToken?.value;
    if (!accessToken) {
      throw new Error("Not authenticated with Vercel.");
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || !app.vercelProjectId) {
      throw new Error("App is not linked to a Vercel project.");
    }

    logger.info(
      `Getting deployments for Vercel project: ${app.vercelProjectId} for app ${appId}`,
    );

    const vercel = createVercelClient(accessToken);

    // Get deployments for the project
    const deploymentsResponse = await vercel.deployments.getDeployments({
      projectId: app.vercelProjectId,
      limit: 3, // Get last 3 deployments
    });

    if (!deploymentsResponse.deployments) {
      throw new Error("Failed to retrieve deployments from Vercel.");
    }

    // Map deployments to our interface format
    return deploymentsResponse.deployments.map((deployment) => ({
      uid: deployment.uid,
      url: deployment.url,
      state: deployment.state || "unknown",
      createdAt: deployment.createdAt || 0,
      target: deployment.target || "production",
      readyState: deployment.readyState || "unknown",
    }));
  } catch (err: any) {
    logger.error("[Vercel Handler] Failed to get deployments:", err);
    throw new Error(err.message || "Failed to get Vercel deployments.");
  }
}

async function handleDisconnectVercelProject(
  event: IpcMainInvokeEvent,
  { appId }: DisconnectVercelProjectParams,
): Promise<void> {
  logger.log(`Disconnecting Vercel project for appId: ${appId}`);

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  // Update app in database to remove Vercel project info
  await db
    .update(apps)
    .set({
      vercelProjectId: null,
      vercelProjectName: null,
      vercelTeamId: null,
      vercelDeploymentUrl: null,
    })
    .where(eq(apps.id, appId));
}

// --- Vercel Test Connection Handler ---
async function handleTestConnection(): Promise<VercelTestConnectionResult> {
  const settings = readSettings();
  const accessToken = settings.vercelAccessToken?.value;

  if (!accessToken) {
    throw new Error(
      "Not authenticated with Vercel. Please add your access token in Settings → Integrations.",
    );
  }

  try {
    const user = await getVercelUser(accessToken);
    return {
      username: user.username,
      userId: user.id,
    };
  } catch (error: any) {
    logger.error("Failed to test Vercel connection:", error);
    throw new Error(`Connection test failed: ${error.message}`);
  }
}

// --- Vercel Deploy Handler ---
async function handleDeploy(
  event: IpcMainInvokeEvent,
  { appId, target = "production", teamId }: VercelDeployParams,
): Promise<VercelDeployResult> {
  const settings = readSettings();
  const accessToken = settings.vercelAccessToken?.value;

  if (!accessToken) {
    throw new Error(
      "Not authenticated with Vercel. Please add your access token in Settings → Integrations.",
    );
  }

  // Get app details
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new Error("App not found.");
  }

  const appPath = getAbbaAppPath(app.path);
  logger.info(`Starting Vercel deploy for app: ${app.name} at ${appPath}`);

  // Determine build output directory (check for common conventions)
  const possibleDistDirs = ["dist", "build", "out", ".next"];
  let distDir: string | null = null;

  for (const dir of possibleDistDirs) {
    const fullPath = path.join(appPath, dir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      distDir = fullPath;
      break;
    }
  }

  // If no dist dir exists, run build
  if (!distDir) {
    logger.info("No build output found, running build...");
    try {
      await simpleSpawn({
        command: "npm run build",
        cwd: appPath,
        successMessage: "Build completed successfully",
        errorPrefix: "Build failed",
      });
    } catch (buildError: any) {
      throw new Error(`Failed to build app: ${buildError.message}`);
    }

    // Check again for dist dir after build
    for (const dir of possibleDistDirs) {
      const fullPath = path.join(appPath, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        distDir = fullPath;
        break;
      }
    }

    if (!distDir) {
      throw new Error(
        "Build completed but no output directory found. Expected one of: dist, build, out, .next",
      );
    }
  }

  logger.info(`Using build output directory: ${distDir}`);

  // Enumerate files in dist directory
  const fileList = enumerateFiles(distDir);
  logger.info(`Found ${fileList.length} files to upload`);

  if (fileList.length === 0) {
    throw new Error("No files found in build output directory.");
  }

  // Use teamId from params or try to get default
  let resolvedTeamId = teamId;
  if (!resolvedTeamId) {
    try {
      resolvedTeamId = await getDefaultTeamId(accessToken);
    } catch {
      // Personal accounts may not have a team, continue without it
      logger.info("No team found, deploying to personal account");
    }
  }

  // Upload files and collect metadata
  logger.info("Uploading files to Vercel...");
  const uploadedFiles: Array<{ file: string; sha: string; size: number }> = [];

  for (const relativePath of fileList) {
    const fullPath = path.join(distDir, relativePath);
    const stat = fs.statSync(fullPath);

    try {
      const sha = await uploadFileToVercel(
        accessToken,
        fullPath,
        resolvedTeamId,
      );
      uploadedFiles.push({
        file: relativePath,
        sha,
        size: stat.size,
      });
    } catch (uploadError: any) {
      logger.error(`Failed to upload ${relativePath}:`, uploadError);
      throw new Error(
        `Failed to upload ${relativePath}: ${uploadError.message}`,
      );
    }
  }

  logger.info(`Uploaded ${uploadedFiles.length} files`);

  // Create deployment
  const projectName =
    app.vercelProjectName || app.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  logger.info(`Creating deployment for project: ${projectName}`);

  const deployment = await createVercelDeployment(
    accessToken,
    projectName,
    uploadedFiles,
    target,
    resolvedTeamId,
  );

  logger.info(`Deployment created: ${deployment.id}, polling for status...`);

  // Poll for deployment completion
  const result = await pollDeploymentStatus(
    accessToken,
    deployment.id,
    resolvedTeamId,
  );

  // Update app with deployment URL
  await db
    .update(schema.apps)
    .set({
      vercelDeploymentUrl: result.url,
    })
    .where(eq(schema.apps.id, appId));

  logger.info(`Deployment complete: ${result.url}`);

  return {
    url: result.url,
    status: result.readyState,
    deploymentId: deployment.id,
  };
}

// --- Registration ---
export function registerVercelHandlers() {
  // DO NOT LOG this handler because tokens are sensitive
  ipcMain.handle("vercel:save-token", handleSaveVercelToken);

  // Logged handlers
  handle("vercel:list-projects", handleListVercelProjects);
  handle("vercel:is-project-available", handleIsProjectAvailable);
  handle("vercel:create-project", handleCreateProject);
  handle("vercel:connect-existing-project", handleConnectToExistingProject);
  handle("vercel:get-deployments", handleGetVercelDeployments);
  handle("vercel:disconnect", handleDisconnectVercelProject);
  handle("vercel:test-connection", handleTestConnection);
  handle("vercel:deploy", handleDeploy);
}

export async function updateAppVercelProject({
  appId,
  projectId,
  projectName,
  teamId,
  deploymentUrl,
}: {
  appId: number;
  projectId: string;
  projectName: string;
  teamId: string;
  deploymentUrl?: string | null;
}): Promise<void> {
  await db
    .update(schema.apps)
    .set({
      vercelProjectId: projectId,
      vercelProjectName: projectName,
      vercelTeamId: teamId,
      vercelDeploymentUrl: deploymentUrl,
    })
    .where(eq(schema.apps.id, appId));
}
