import type { IpcMainInvokeEvent } from "electron";
import type { ExtensionContext } from "../../core/extension_types";
import type {
  CloudflareProject,
  CloudflareDeployment,
  CreateCloudflareProjectParamsWithAppId,
  ConnectToExistingCloudflareProjectParams,
  SaveCloudflareTokenParams,
  GetCloudflareDeploymentsParams,
  DisconnectCloudflareProjectParams,
} from "./types";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { getDyadAppPath } from "@/paths/paths";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Get Cloudflare API token from settings
 */
function getCloudflareToken(context: ExtensionContext): string {
  const settings = context.readSettings();
  const token =
    settings.extensionSettings?.cloudflare?.accessToken?.value ||
    settings.extensionSettings?.cloudflare?.accessToken;

  if (!token || typeof token !== "string") {
    throw new Error(
      "Not authenticated with Cloudflare. Please add your API token in settings.",
    );
  }

  return token;
}

/**
 * Make authenticated request to Cloudflare API
 */
async function cloudflareApiRequest<T>(
  token: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${CLOUDFLARE_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Cloudflare API error: ${response.status} ${response.statusText}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.errors && errorJson.errors.length > 0) {
        errorMessage = errorJson.errors[0].message || errorMessage;
      }
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.result as T;
}

/**
 * Validate Cloudflare API token
 */
async function validateCloudflareToken(token: string): Promise<boolean> {
  try {
    await cloudflareApiRequest<{ id: string; email: string }>(
      token,
      "/user/tokens/verify",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Cloudflare account ID (first account)
 */
async function getCloudflareAccountId(token: string): Promise<string> {
  try {
    const accounts = await cloudflareApiRequest<
      Array<{ id: string; name: string }>
    >(token, "/accounts");

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("No Cloudflare accounts found");
    }

    return accounts[0].id;
  } catch (error: any) {
    throw new Error(`Failed to get Cloudflare account: ${error.message}`);
  }
}

/**
 * Detect build output directory from common frameworks
 */
async function detectBuildOutputDir(
  appPath: string,
): Promise<string | undefined> {
  const commonDirs = [
    { dir: "dist", checkFiles: ["index.html"] },
    { dir: "build", checkFiles: ["index.html"] },
    { dir: ".next", checkFiles: [] },
    { dir: "out", checkFiles: ["index.html"] },
    { dir: "public", checkFiles: ["index.html"] },
  ];

  for (const { dir, checkFiles } of commonDirs) {
    const dirPath = path.join(appPath, dir);
    try {
      const stats = await fs.stat(dirPath);
      if (stats.isDirectory()) {
        if (checkFiles.length === 0) {
          return dir;
        }
        // Check if required files exist
        const hasAllFiles = await Promise.all(
          checkFiles.map((file) =>
            fs
              .access(path.join(dirPath, file))
              .then(() => true)
              .catch(() => false),
          ),
        ).then((results) => results.every((r) => r));

        if (hasAllFiles) {
          return dir;
        }
      }
    } catch {
      // Directory doesn't exist, continue
    }
  }

  return undefined;
}

/**
 * Register Cloudflare Pages IPC handlers
 */
export function registerCloudflareHandlers(context: ExtensionContext): void {
  const { logger, registerIpcHandler } = context;

  // Save Cloudflare API token
  registerIpcHandler(
    "extension:cloudflare:save-token",
    async (_event: IpcMainInvokeEvent, params: SaveCloudflareTokenParams) => {
      logger.log("Saving Cloudflare access token");

      if (!params.token || params.token.trim() === "") {
        throw new Error("Access token is required.");
      }

      try {
        const isValid = await validateCloudflareToken(params.token.trim());
        if (!isValid) {
          throw new Error(
            "Invalid access token. Please check your token and try again.",
          );
        }

        const settings = context.readSettings();
        context.writeSettings({
          extensionSettings: {
            ...settings.extensionSettings,
            cloudflare: {
              ...settings.extensionSettings?.cloudflare,
              accessToken: params.token.trim(),
            },
          },
        });

        logger.log("Successfully saved Cloudflare access token.");
      } catch (error: any) {
        logger.error("Error saving Cloudflare token:", error);
        throw new Error(`Failed to save access token: ${error.message}`);
      }
    },
  );

  // List Cloudflare Pages projects
  registerIpcHandler(
    "extension:cloudflare:list-projects",
    async (_event: IpcMainInvokeEvent): Promise<CloudflareProject[]> => {
      const token = getCloudflareToken(context);
      const accountId = await getCloudflareAccountId(token);

      try {
        const projects = await cloudflareApiRequest<CloudflareProject[]>(
          token,
          `/accounts/${accountId}/pages/projects`,
        );

        return Array.isArray(projects) ? projects : [];
      } catch (error: any) {
        logger.error("Error listing Cloudflare projects:", error);
        throw new Error(`Failed to list projects: ${error.message}`);
      }
    },
  );

  // Create Cloudflare Pages project
  registerIpcHandler(
    "extension:cloudflare:create-project",
    async (
      _event: IpcMainInvokeEvent,
      params: CreateCloudflareProjectParamsWithAppId,
    ): Promise<void> => {
      const token = getCloudflareToken(context);
      const accountId = await getCloudflareAccountId(token);

      try {
        const app = await context.getApp(params.appId);
        const appPath = getDyadAppPath(app.path);

        // Detect build output directory if not provided
        const buildOutputDir =
          params.build_output_dir || (await detectBuildOutputDir(appPath));

        const projectData = await cloudflareApiRequest<CloudflareProject>(
          token,
          `/accounts/${accountId}/pages/projects`,
          {
            method: "POST",
            body: JSON.stringify({
              name: params.name,
              production_branch: params.production_branch || "main",
              build_command: params.build_command,
              build_output_dir: buildOutputDir || "dist",
            }),
          },
        );

        // Store project info in extension data
        await context.setExtensionData(
          params.appId,
          "projectId",
          projectData.id,
        );
        await context.setExtensionData(
          params.appId,
          "projectName",
          projectData.name,
        );
        await context.setExtensionData(params.appId, "accountId", accountId);

        // Get deployment URL (primary domain)
        if (projectData.domains && projectData.domains.length > 0) {
          await context.setExtensionData(
            params.appId,
            "deploymentUrl",
            `https://${projectData.domains[0]}`,
          );
        }

        logger.log(
          `Successfully created Cloudflare Pages project: ${projectData.name} (${projectData.id})`,
        );
      } catch (error: any) {
        logger.error("Error creating Cloudflare project:", error);
        throw new Error(`Failed to create project: ${error.message}`);
      }
    },
  );

  // Connect to existing Cloudflare Pages project
  registerIpcHandler(
    "extension:cloudflare:connect-existing-project",
    async (
      _event: IpcMainInvokeEvent,
      params: ConnectToExistingCloudflareProjectParams,
    ): Promise<void> => {
      const token = getCloudflareToken(context);
      const accountId = await getCloudflareAccountId(token);

      try {
        // Verify the project exists and get its details
        const projectData = await cloudflareApiRequest<CloudflareProject>(
          token,
          `/accounts/${accountId}/pages/projects/${params.projectId}`,
        );

        // Store project info in extension data
        await context.setExtensionData(
          params.appId,
          "projectId",
          projectData.id,
        );
        await context.setExtensionData(
          params.appId,
          "projectName",
          projectData.name,
        );
        await context.setExtensionData(params.appId, "accountId", accountId);

        // Get deployment URL (primary domain)
        if (projectData.domains && projectData.domains.length > 0) {
          await context.setExtensionData(
            params.appId,
            "deploymentUrl",
            `https://${projectData.domains[0]}`,
          );
        }

        logger.log(
          `Successfully connected to Cloudflare Pages project: ${projectData.name} (${projectData.id})`,
        );
      } catch (error: any) {
        logger.error("Error connecting to Cloudflare project:", error);
        throw new Error(`Failed to connect to project: ${error.message}`);
      }
    },
  );

  // Get deployments for a project
  registerIpcHandler(
    "extension:cloudflare:list-deployments",
    async (
      _event: IpcMainInvokeEvent,
      params: GetCloudflareDeploymentsParams,
    ): Promise<CloudflareDeployment[]> => {
      const token = getCloudflareToken(context);
      const projectId = await context.getExtensionData(
        params.appId,
        "projectId",
      );

      if (!projectId) {
        throw new Error(
          "Project not connected. Please connect a project first.",
        );
      }

      try {
        const accountId = await context.getExtensionData(
          params.appId,
          "accountId",
        );

        const deployments = await cloudflareApiRequest<CloudflareDeployment[]>(
          token,
          `/accounts/${accountId}/pages/projects/${projectId}/deployments`,
        );

        return Array.isArray(deployments) ? deployments : [];
      } catch (error: any) {
        logger.error("Error listing Cloudflare deployments:", error);
        throw new Error(`Failed to list deployments: ${error.message}`);
      }
    },
  );

  // Disconnect Cloudflare project
  registerIpcHandler(
    "extension:cloudflare:disconnect",
    async (
      _event: IpcMainInvokeEvent,
      params: DisconnectCloudflareProjectParams,
    ): Promise<void> => {
      try {
        // Delete all extension data for this app using the deleteExtensionData helper
        const { deleteExtensionData } = await import(
          "../../core/extension_data"
        );
        await deleteExtensionData(context.extensionId, params.appId);

        logger.log(`Disconnected Cloudflare project for app ${params.appId}`);
      } catch (error: any) {
        logger.error("Error disconnecting Cloudflare project:", error);
        throw new Error(`Failed to disconnect project: ${error.message}`);
      }
    },
  );
}
