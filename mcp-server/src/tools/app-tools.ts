/**
 * App management tools for Dyad MCP Server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { DyadDatabase } from "../database.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

export function registerAppTools(
  db: DyadDatabase,
  registerTool: (tool: Tool, handler: (args: any) => Promise<any>) => void
): void {
  // ============================================
  // dyad_list_apps
  // ============================================
  registerTool(
    {
      name: "dyad_list_apps",
      description:
        "List all Dyad apps. Returns app metadata including id, name, path, creation date, and favorite status. Use this to discover what apps exist in Dyad.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    async () => {
      const apps = await db.listApps();
      return {
        apps,
        count: apps.length,
      };
    }
  );

  // ============================================
  // dyad_get_app
  // ============================================
  registerTool(
    {
      name: "dyad_get_app",
      description:
        "Get detailed information about a specific Dyad app by its ID. Returns app metadata and checks if the app path exists on disk.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "The unique ID of the app",
          },
        },
        required: ["appId"],
      },
    },
    async (args: { appId: number }) => {
      const schema = z.object({
        appId: z.number(),
      });
      const { appId } = schema.parse(args);

      const app = await db.getApp(appId);
      if (!app) {
        throw new Error(`App with ID ${appId} not found`);
      }

      // Check if app path exists
      const appPathExists = fs.existsSync(app.path);

      return {
        ...app,
        pathExists: appPathExists,
      };
    }
  );

  // ============================================
  // dyad_search_apps
  // ============================================
  registerTool(
    {
      name: "dyad_search_apps",
      description:
        "Search for Dyad apps by name. Performs a case-insensitive substring match on app names.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to match against app names",
          },
        },
        required: ["query"],
      },
    },
    async (args: { query: string }) => {
      const schema = z.object({
        query: z.string(),
      });
      const { query } = schema.parse(args);

      const apps = await db.searchApps(query);
      return {
        apps,
        count: apps.length,
        query,
      };
    }
  );

  // ============================================
  // dyad_get_app_structure
  // ============================================
  registerTool(
    {
      name: "dyad_get_app_structure",
      description:
        "Get the file and directory structure of a Dyad app. Returns a tree of all files and folders in the app, excluding node_modules and common ignore patterns.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "The unique ID of the app",
          },
          maxDepth: {
            type: "number",
            description:
              "Maximum depth to traverse (default: 5). Use lower values for large projects.",
            default: 5,
          },
        },
        required: ["appId"],
      },
    },
    async (args: { appId: number; maxDepth?: number }) => {
      const schema = z.object({
        appId: z.number(),
        maxDepth: z.number().default(5),
      });
      const { appId, maxDepth } = schema.parse(args);

      const app = await db.getApp(appId);
      if (!app) {
        throw new Error(`App with ID ${appId} not found`);
      }

      if (!fs.existsSync(app.path)) {
        throw new Error(`App path does not exist: ${app.path}`);
      }

      const structure = getDirectoryStructure(app.path, maxDepth);

      return {
        appId,
        appName: app.name,
        appPath: app.path,
        structure,
      };
    }
  );
}

/**
 * Helper function to get directory structure
 */
function getDirectoryStructure(
  dirPath: string,
  maxDepth: number,
  currentDepth = 0
): any {
  if (currentDepth >= maxDepth) {
    return { truncated: true };
  }

  const items: any[] = [];
  const ignorePatterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "out",
    ".cache",
    "coverage",
  ];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip ignored patterns
      if (ignorePatterns.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          type: "directory",
          children: getDirectoryStructure(fullPath, maxDepth, currentDepth + 1),
        });
      } else {
        items.push({
          name: entry.name,
          type: "file",
        });
      }
    }
  } catch (error) {
    return { error: "Unable to read directory" };
  }

  return items;
}
