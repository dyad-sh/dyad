/**
 * JoyMarketplace IPC Handlers
 * Handles app publishing, deployment, and marketplace operations
 */

import { ipcMain, app } from "electron";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import AdmZip from "adm-zip";
import { getDyadAppPath } from "../../paths/paths";
import type {
  PublishAppRequest,
  PublishAppResponse,
  MarketplaceAsset,
  MarketplaceCredentials,
  PublisherProfile,
  DeploymentStatus,
  EarningsReport,
  AppBundle,
} from "@/types/marketplace_types";

const logger = log.scope("marketplace_handlers");

// JoyMarketplace API configuration
const MARKETPLACE_API_URL = process.env.JOYMARKETPLACE_API_URL || "https://api.joymarketplace.io";
const MARKETPLACE_WEB_URL = process.env.JOYMARKETPLACE_WEB_URL || "https://joymarketplace.io";

// Store credentials in memory (should be persisted in settings)
let marketplaceCredentials: MarketplaceCredentials | null = null;

/**
 * Get the marketplace credentials file path
 */
function getCredentialsPath(): string {
  return path.join(app.getPath("userData"), "marketplace-credentials.json");
}

/**
 * Load marketplace credentials from disk
 */
async function loadCredentials(): Promise<MarketplaceCredentials | null> {
  try {
    const credPath = getCredentialsPath();
    if (await fs.pathExists(credPath)) {
      const data = await fs.readJson(credPath);
      marketplaceCredentials = data;
      return data;
    }
  } catch (error) {
    logger.error("Failed to load marketplace credentials:", error);
  }
  return null;
}

/**
 * Save marketplace credentials to disk
 */
async function saveCredentials(credentials: MarketplaceCredentials): Promise<void> {
  try {
    const credPath = getCredentialsPath();
    await fs.writeJson(credPath, credentials, { spaces: 2 });
    marketplaceCredentials = credentials;
  } catch (error) {
    logger.error("Failed to save marketplace credentials:", error);
    throw error;
  }
}

/**
 * Make authenticated API request to marketplace
 */
async function marketplaceRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!marketplaceCredentials) {
    await loadCredentials();
  }
  
  if (!marketplaceCredentials?.apiKey) {
    throw new Error("Not authenticated with JoyMarketplace. Please connect your account in Settings.");
  }

  const url = `${MARKETPLACE_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${marketplaceCredentials.apiKey}`,
      "X-Publisher-ID": marketplaceCredentials.publisherId,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Marketplace API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Bundle an app for upload
 */
async function bundleApp(appId: number): Promise<AppBundle> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!appRecord) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(appRecord.path);
  
  if (!await fs.pathExists(appPath)) {
    throw new Error("App directory not found");
  }

  const bundle: AppBundle = {
    appId,
    appName: appRecord.name,
    files: [],
    totalSize: 0,
    createdAt: new Date().toISOString(),
  };

  // Files/folders to exclude from bundle
  const excludePatterns = [
    "node_modules",
    ".git",
    ".env",
    ".env.local",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
  ];

  async function collectFiles(dir: string, relativePath: string = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      // Skip excluded patterns
      if (excludePatterns.some(pattern => entry.name === pattern || entry.name.startsWith("."))) {
        continue;
      }

      if (entry.isDirectory()) {
        await collectFiles(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath);
          const base64Content = content.toString("base64");
          bundle.files.push({
            path: relPath.replace(/\\/g, "/"),
            content: base64Content,
            size: content.length,
          });
          bundle.totalSize += content.length;
        } catch (error) {
          logger.warn(`Failed to read file ${fullPath}:`, error);
        }
      }
    }
  }

  await collectFiles(appPath);
  
  logger.info(`Bundled app ${appRecord.name}: ${bundle.files.length} files, ${(bundle.totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  return bundle;
}

/**
 * Create a ZIP file from the app
 */
async function createAppZip(appId: number): Promise<string> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!appRecord) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(appRecord.path);
  const tempDir = path.join(app.getPath("temp"), "joycreate-exports");
  await fs.ensureDir(tempDir);
  
  const zipPath = path.join(tempDir, `${appRecord.name.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.zip`);
  
  const zip = new AdmZip();
  
  const excludePatterns = [
    "node_modules",
    ".git",
    ".env",
    ".env.local",
    "dist",
    "build",
    ".next",
    ".cache",
  ];

  async function addFilesToZip(dir: string, zipPath: string = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      
      if (excludePatterns.some(pattern => entry.name === pattern)) {
        continue;
      }

      if (entry.isDirectory()) {
        await addFilesToZip(fullPath, entryZipPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath);
          zip.addFile(entryZipPath, content);
        } catch (error) {
          logger.warn(`Failed to add file ${fullPath} to zip:`, error);
        }
      }
    }
  }

  await addFilesToZip(appPath);
  zip.writeZip(zipPath);
  
  logger.info(`Created ZIP for app ${appRecord.name}: ${zipPath}`);
  
  return zipPath;
}

/**
 * Register all marketplace IPC handlers
 */
export function registerMarketplaceHandlers() {
  // Check marketplace connection status
  ipcMain.handle("marketplace:status", async () => {
    try {
      await loadCredentials();
      
      if (!marketplaceCredentials?.apiKey) {
        return {
          connected: false,
          profile: null,
        };
      }

      // Verify credentials with API
      const profile = await marketplaceRequest<PublisherProfile>("/v1/publisher/profile");
      
      return {
        connected: true,
        profile,
      };
    } catch (error) {
      logger.error("Failed to check marketplace status:", error);
      return {
        connected: false,
        profile: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Connect to marketplace (authenticate)
  ipcMain.handle("marketplace:connect", async (_, apiKey: string) => {
    try {
      // Verify the API key
      const response = await fetch(`${MARKETPLACE_API_URL}/v1/publisher/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("Invalid API key");
      }

      const data = await response.json();
      
      const credentials: MarketplaceCredentials = {
        apiKey,
        publisherId: data.publisherId,
      };
      
      await saveCredentials(credentials);
      
      return {
        success: true,
        profile: data.profile,
      };
    } catch (error) {
      logger.error("Failed to connect to marketplace:", error);
      throw error;
    }
  });

  // Disconnect from marketplace
  ipcMain.handle("marketplace:disconnect", async () => {
    try {
      const credPath = getCredentialsPath();
      if (await fs.pathExists(credPath)) {
        await fs.remove(credPath);
      }
      marketplaceCredentials = null;
      return { success: true };
    } catch (error) {
      logger.error("Failed to disconnect from marketplace:", error);
      throw error;
    }
  });

  // Get publisher profile
  ipcMain.handle("marketplace:get-profile", async () => {
    return marketplaceRequest<PublisherProfile>("/v1/publisher/profile");
  });

  // Get published assets
  ipcMain.handle("marketplace:list-assets", async () => {
    return marketplaceRequest<MarketplaceAsset[]>("/v1/publisher/assets");
  });

  // Get single asset details
  ipcMain.handle("marketplace:get-asset", async (_, assetId: string) => {
    return marketplaceRequest<MarketplaceAsset>(`/v1/assets/${assetId}`);
  });

  // Publish app to marketplace
  ipcMain.handle("marketplace:publish", async (_, request: PublishAppRequest): Promise<PublishAppResponse> => {
    try {
      logger.info(`Publishing app ${request.appId} to marketplace...`);
      
      // Bundle the app
      const bundle = await bundleApp(request.appId);
      
      // Prepare the publish payload
      const payload = {
        ...request,
        bundle: {
          files: bundle.files,
          totalSize: bundle.totalSize,
        },
      };

      // Upload to marketplace
      const response = await marketplaceRequest<PublishAppResponse>("/v1/assets/publish", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      logger.info(`App published successfully: ${response.assetId}`);
      
      return {
        ...response,
        assetUrl: response.assetId ? `${MARKETPLACE_WEB_URL}/assets/${response.assetId}` : undefined,
      };
    } catch (error) {
      logger.error("Failed to publish app:", error);
      return {
        success: false,
        status: "rejected",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Update published asset
  ipcMain.handle("marketplace:update-asset", async (_, assetId: string, updates: Partial<PublishAppRequest>) => {
    return marketplaceRequest<MarketplaceAsset>(`/v1/assets/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  });

  // Unpublish/archive asset
  ipcMain.handle("marketplace:unpublish", async (_, assetId: string) => {
    return marketplaceRequest<{ success: boolean }>(`/v1/assets/${assetId}/archive`, {
      method: "POST",
    });
  });

  // Get earnings report
  ipcMain.handle("marketplace:earnings", async () => {
    return marketplaceRequest<EarningsReport>("/v1/publisher/earnings");
  });

  // Export app as ZIP for manual upload
  ipcMain.handle("marketplace:export-zip", async (_, appId: number) => {
    try {
      const zipPath = await createAppZip(appId);
      return {
        success: true,
        path: zipPath,
      };
    } catch (error) {
      logger.error("Failed to export app as ZIP:", error);
      throw error;
    }
  });

  // Get deployment status for an app
  ipcMain.handle("marketplace:deployment-status", async (_, appId: number): Promise<DeploymentStatus> => {
    // For now, return idle status
    // In production, this would check actual deployment status
    return {
      target: "joymarketplace",
      status: "idle",
    };
  });

  // Open marketplace in browser
  ipcMain.handle("marketplace:open", async (_, path?: string) => {
    const { shell } = await import("electron");
    const url = path ? `${MARKETPLACE_WEB_URL}${path}` : MARKETPLACE_WEB_URL;
    await shell.openExternal(url);
    return { success: true };
  });

  // Get marketplace URL
  ipcMain.handle("marketplace:get-url", async () => {
    return {
      apiUrl: MARKETPLACE_API_URL,
      webUrl: MARKETPLACE_WEB_URL,
    };
  });

  logger.info("Marketplace IPC handlers registered");
}
