import * as path from "node:path";
import * as fs from "node:fs/promises";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import type {
  ExtensionManifest,
  ExtensionContext,
  ExtensionMain,
  LoadedExtension,
  App,
} from "./extension_types";
import { extensionRegistry } from "./extension_registry";
import { getDb } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readSettings, writeSettings } from "@/main/settings";
import {
  setExtensionData,
  getExtensionData,
  getAllExtensionData,
} from "./extension_data";
import { getFilesRecursively } from "@/ipc/utils/file_utils";
import { getDyadAppPath } from "@/paths/paths";
import { normalizePath } from "../../../shared/normalizePath";

const logger = log.scope("extension-manager");

/**
 * Validates an extension manifest
 */
function validateManifest(manifest: any): manifest is ExtensionManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be an object");
  }

  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("Manifest must have a string 'id' field");
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("Manifest must have a string 'name' field");
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("Manifest must have a string 'version' field");
  }

  if (!manifest.capabilities || typeof manifest.capabilities !== "object") {
    throw new Error("Manifest must have a 'capabilities' object");
  }

  // Validate IPC channel names if provided
  if (manifest.capabilities.ipcChannels) {
    if (!Array.isArray(manifest.capabilities.ipcChannels)) {
      throw new Error("ipcChannels must be an array");
    }
    for (const channel of manifest.capabilities.ipcChannels) {
      if (typeof channel !== "string" || !/^[a-z0-9-:]+$/.test(channel)) {
        throw new Error(
          `Invalid IPC channel name: "${channel}". Must be lowercase alphanumeric with hyphens and colons only.`,
        );
      }
    }
  }

  return true;
}

/**
 * Validates IPC channel name to ensure it's properly namespaced
 */
function validateChannelName(extensionId: string, channel: string): void {
  const expectedPrefix = `extension:${extensionId}:`;
  if (!channel.startsWith(expectedPrefix)) {
    throw new Error(
      `IPC channel "${channel}" must start with "${expectedPrefix}"`,
    );
  }
  if (!/^[a-z0-9-:]+$/.test(channel)) {
    throw new Error(
      `Invalid IPC channel name: "${channel}". Must be lowercase alphanumeric with hyphens and colons only.`,
    );
  }
}

/**
 * Helper function to get app data (simplified version of the handler)
 */
async function getAppData(appId: number): Promise<App> {
  const db = getDb();
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error(`App with id ${appId} not found`);
  }

  // Get app files
  const appPath = getDyadAppPath(app.path);
  let files: string[] = [];

  try {
    files = getFilesRecursively(appPath, appPath);
    files = files.map((filePath) => normalizePath(filePath));
  } catch (error) {
    logger.error(`Error reading files for app ${appId}:`, error);
    // Continue without files
  }

  // Simplified app data - extensions can get full data via IPC if needed
  return {
    id: app.id,
    name: app.name,
    path: app.path,
    files,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    githubOrg: app.githubOrg,
    githubRepo: app.githubRepo,
    githubBranch: app.githubBranch,
    supabaseProjectId: app.supabaseProjectId,
    supabaseParentProjectId: app.supabaseParentProjectId,
    supabaseProjectName: null,
    supabaseOrganizationSlug: app.supabaseOrganizationSlug,
    neonProjectId: app.neonProjectId,
    neonDevelopmentBranchId: app.neonDevelopmentBranchId,
    neonPreviewBranchId: app.neonPreviewBranchId,
    vercelProjectId: app.vercelProjectId,
    vercelProjectName: app.vercelProjectName,
    vercelTeamSlug: null,
    vercelDeploymentUrl: app.vercelDeploymentUrl,
    installCommand: app.installCommand,
    startCommand: app.startCommand,
    isFavorite: app.isFavorite,
  };
}

/**
 * Creates extension context for an extension
 */
export function createExtensionContext(
  manifest: ExtensionManifest,
  _directory: string,
): ExtensionContext & { registeredChannels: string[] } {
  const extensionLogger = log.scope(`extension:${manifest.id}`);
  const registeredChannels: string[] = [];

  const context: ExtensionContext & { registeredChannels: string[] } = {
    extensionId: manifest.id,
    manifest,
    logger: extensionLogger,
    registeredChannels,
    registerIpcHandler: (channel: string, handler: Function) => {
      // Validate channel name
      validateChannelName(manifest.id, channel);

      // Check if channel was declared in manifest
      if (
        manifest.capabilities.ipcChannels &&
        !manifest.capabilities.ipcChannels.some((declared) =>
          channel.endsWith(`:${declared}`),
        )
      ) {
        extensionLogger.warn(
          `Channel "${channel}" was not declared in manifest ipcChannels`,
        );
      }

      // Register handler with logging
      ipcMain.handle(
        channel,
        async (event: IpcMainInvokeEvent, ...args: any[]) => {
          extensionLogger.log(`IPC: ${channel} called`);
          try {
            const result = await handler(event, ...args);
            extensionLogger.log(`IPC: ${channel} completed`);
            return result;
          } catch (error) {
            extensionLogger.error(`IPC: ${channel} error:`, error);
            throw error;
          }
        },
      );

      registeredChannels.push(channel);
      extensionLogger.log(`Registered IPC channel: ${channel}`);
    },
    getDb: () => getDb(),
    readSettings,
    writeSettings,
    getApp: async (appId: number) => {
      return getAppData(appId);
    },
    updateApp: async (appId: number, data: Partial<App>) => {
      const db = getDb();
      await db.update(apps).set(data).where(eq(apps.id, appId));
    },
    setExtensionData: async (appId: number, key: string, value: any) => {
      return setExtensionData(manifest.id, appId, key, value);
    },
    getExtensionData: async (appId: number, key: string) => {
      return getExtensionData(manifest.id, appId, key);
    },
    getAllExtensionData: async (appId: number) => {
      return getAllExtensionData(manifest.id, appId);
    },
  };

  return context;
}

/**
 * Loads a single extension from a directory
 */
async function loadExtension(
  extensionDir: string,
): Promise<LoadedExtension | null> {
  const extensionId = path.basename(extensionDir);
  const manifestPath = path.join(extensionDir, "manifest.json");

  try {
    // Read and validate manifest
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const manifestJson = JSON.parse(manifestContent);
    validateManifest(manifestJson);
    const manifest = manifestJson as ExtensionManifest;

    // Validate extension ID matches directory name
    if (manifest.id !== extensionId) {
      throw new Error(
        `Extension ID "${manifest.id}" does not match directory name "${extensionId}"`,
      );
    }

    logger.log(`Loading extension: ${manifest.id} v${manifest.version}`);

    const loadedExtension: LoadedExtension = {
      manifest,
      directory: extensionDir,
      registeredChannels: [],
    };

    // Load main process code if specified
    if (manifest.capabilities.hasMainProcess && manifest.main) {
      const mainPath = path.join(extensionDir, manifest.main);

      // Check if file exists
      try {
        await fs.access(mainPath);
      } catch {
        throw new Error(`Main entry point not found: ${mainPath}`);
      }

      // Dynamic import of extension main code
      // Note: In production, extensions would need to be in a format that can be imported
      // For development, we assume extensions are TypeScript/JavaScript files
      try {
        // Use require for now (extensions will need to be compiled or use .js extension)
        // In production, you'd want to load from a compiled location
        const mainModule = await import(
          /* @vite-ignore */ mainPath.replace(/\\/g, "/")
        );
        if (!mainModule.main || typeof mainModule.main !== "function") {
          throw new Error(`Extension main entry must export a 'main' function`);
        }
        loadedExtension.mainEntry = mainModule.main as ExtensionMain;

        // Create context and initialize extension
        const context = createExtensionContext(manifest, extensionDir);
        await loadedExtension.mainEntry(context);
        loadedExtension.registeredChannels = context.registeredChannels || [];

        logger.log(
          `Extension ${manifest.id} main process initialized with ${loadedExtension.registeredChannels.length} IPC channels`,
        );
      } catch (error: any) {
        throw new Error(
          `Failed to load extension main process: ${error.message}`,
        );
      }
    }

    // Renderer process code is loaded separately by renderer extension manager
    // We just store the path for now

    return loadedExtension;
  } catch (error: any) {
    logger.error(`Failed to load extension from ${extensionDir}:`, error);
    return null;
  }
}

/**
 * Extension Manager
 * Manages loading and lifecycle of extensions
 */
export class ExtensionManager {
  private extensionsDirectory: string;

  constructor(extensionsDirectory: string) {
    this.extensionsDirectory = extensionsDirectory;
  }

  /**
   * Discover and load all extensions
   */
  async loadExtensions(): Promise<void> {
    logger.log(`Loading extensions from: ${this.extensionsDirectory}`);

    try {
      // Ensure extensions directory exists
      await fs.mkdir(this.extensionsDirectory, { recursive: true });

      // Read extension directories
      const entries = await fs.readdir(this.extensionsDirectory, {
        withFileTypes: true,
      });

      const extensionDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.extensionsDirectory, entry.name));

      logger.log(`Found ${extensionDirs.length} extension directories`);

      // Load each extension
      const loadPromises = extensionDirs.map((dir) => loadExtension(dir));
      const loadedExtensions = await Promise.all(loadPromises);

      // Register successfully loaded extensions
      let successCount = 0;
      for (const extension of loadedExtensions) {
        if (extension) {
          extensionRegistry.register(extension);
          successCount++;
        }
      }

      logger.log(
        `Successfully loaded ${successCount}/${extensionDirs.length} extensions`,
      );
    } catch (error) {
      logger.error("Error loading extensions:", error);
      throw error;
    }
  }

  /**
   * Get all loaded extensions
   */
  getExtensions(): LoadedExtension[] {
    return extensionRegistry.getAll();
  }

  /**
   * Get extension by ID
   */
  getExtension(id: string): LoadedExtension | undefined {
    return extensionRegistry.get(id);
  }
}
