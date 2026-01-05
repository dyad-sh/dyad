import { loadDevelopmentExtension } from "./load_development_extension";
import type { ExtensionManifest } from "./extension_types";
import { app } from "electron";
import * as path from "node:path";
import log from "electron-log";

const logger = log.scope("load-development-extensions");

/**
 * Load development extensions from source code
 * This is called in development mode to load extensions statically
 */
export async function loadDevelopmentExtensions(): Promise<void> {
  try {
    // Import Cloudflare extension
    const cloudflareManifest: ExtensionManifest = {
      id: "cloudflare",
      name: "Cloudflare Pages",
      version: "1.0.0",
      description: "Deploy your projects to Cloudflare Pages",
      author: "Dyad",
      capabilities: {
        hasMainProcess: true,
        hasRendererProcess: true,
        hasDatabaseSchema: false,
        hasSettingsSchema: false,
        ipcChannels: [
          "save-token",
          "list-projects",
          "create-project",
          "connect-existing-project",
          "deploy",
          "list-deployments",
          "disconnect",
        ],
      },
      main: "main.ts",
      renderer: "renderer.ts",
      ui: {
        settingsPage: {
          component: "CloudflareSettings",
          title: "Cloudflare Pages",
          icon: "Cloud",
        },
        appConnector: {
          component: "CloudflareConnector",
          title: "Cloudflare Pages",
        },
      },
    };

    // Import the main entry point
    const cloudflareMainModule = await import("../plugins/cloudflare/main");
    const cloudflareMain = cloudflareMainModule.main;

    // Get the extension directory path (for context)
    // In development, app.getAppPath() is the project root
    const cloudflareExtensionDir = path.join(
      app.getAppPath(),
      "src",
      "extensions",
      "plugins",
      "cloudflare",
    );

    await loadDevelopmentExtension(
      cloudflareManifest,
      cloudflareMain,
      cloudflareExtensionDir,
    );

    logger.log("Development extensions loaded successfully");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error loading development extensions:", errorMessage);
    throw error;
  }
}
