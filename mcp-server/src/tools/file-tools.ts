/**
 * File operations tools for Dyad MCP Server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { DyadDatabase } from "../database.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

export function registerFileTools(
  db: DyadDatabase,
  registerTool: (tool: Tool, handler: (args: any) => Promise<any>) => void
): void {
  // ============================================
  // dyad_read_file
  // ============================================
  registerTool(
    {
      name: "dyad_read_file",
      description:
        "Read the contents of a file in a Dyad app. Use this to inspect source code, configuration files, or any other file in the app.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "The unique ID of the app",
          },
          filePath: {
            type: "string",
            description:
              "Relative path to the file within the app (e.g., 'src/index.ts')",
          },
        },
        required: ["appId", "filePath"],
      },
    },
    async (args: { appId: number; filePath: string }) => {
      const schema = z.object({
        appId: z.number(),
        filePath: z.string(),
      });
      const { appId, filePath: relativeFilePath } = schema.parse(args);

      const app = await db.getApp(appId);
      if (!app) {
        throw new Error(`App with ID ${appId} not found`);
      }

      const fullPath = path.join(app.path, relativeFilePath);

      // Security check: ensure the file is within the app directory
      const normalizedAppPath = path.normalize(app.path);
      const normalizedFilePath = path.normalize(fullPath);
      if (!normalizedFilePath.startsWith(normalizedAppPath)) {
        throw new Error("Access denied: file path is outside app directory");
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${relativeFilePath}`);
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${relativeFilePath}`);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n").length;

      return {
        appId,
        appName: app.name,
        filePath: relativeFilePath,
        fullPath,
        content,
        size: stats.size,
        lines,
        lastModified: stats.mtime.toISOString(),
      };
    }
  );

  // ============================================
  // dyad_list_files
  // ============================================
  registerTool(
    {
      name: "dyad_list_files",
      description:
        "List all files in a Dyad app or a specific directory within the app. Returns file paths, sizes, and types.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "The unique ID of the app",
          },
          directory: {
            type: "string",
            description:
              "Relative directory path within the app (default: root directory)",
            default: "",
          },
          recursive: {
            type: "boolean",
            description:
              "Whether to list files recursively in subdirectories (default: true)",
            default: true,
          },
          extensions: {
            type: "array",
            items: {
              type: "string",
            },
            description:
              "Filter by file extensions (e.g., ['.ts', '.tsx', '.js']). If not provided, all files are returned.",
          },
        },
        required: ["appId"],
      },
    },
    async (args: {
      appId: number;
      directory?: string;
      recursive?: boolean;
      extensions?: string[];
    }) => {
      const schema = z.object({
        appId: z.number(),
        directory: z.string().default(""),
        recursive: z.boolean().default(true),
        extensions: z.array(z.string()).optional(),
      });
      const { appId, directory, recursive, extensions } = schema.parse(args);

      const app = await db.getApp(appId);
      if (!app) {
        throw new Error(`App with ID ${appId} not found`);
      }

      const targetDir = path.join(app.path, directory);

      // Security check
      const normalizedAppPath = path.normalize(app.path);
      const normalizedTargetDir = path.normalize(targetDir);
      if (!normalizedTargetDir.startsWith(normalizedAppPath)) {
        throw new Error("Access denied: directory is outside app path");
      }

      if (!fs.existsSync(targetDir)) {
        throw new Error(`Directory not found: ${directory}`);
      }

      const files = listFiles(targetDir, app.path, recursive, extensions);

      return {
        appId,
        appName: app.name,
        directory: directory || "/",
        files,
        count: files.length,
        filtered: extensions !== undefined,
        extensions: extensions || [],
      };
    }
  );
}

/**
 * Helper function to list files recursively
 */
function listFiles(
  dir: string,
  baseDir: string,
  recursive: boolean,
  extensions?: string[]
): Array<{ path: string; size: number; type: string; lastModified: string }> {
  const results: Array<{
    path: string;
    size: number;
    type: string;
    lastModified: string;
  }> = [];

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
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip ignored patterns
      if (ignorePatterns.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        if (recursive) {
          results.push(...listFiles(fullPath, baseDir, recursive, extensions));
        }
      } else if (entry.isFile()) {
        // Filter by extensions if provided
        if (extensions && extensions.length > 0) {
          const ext = path.extname(entry.name);
          if (!extensions.includes(ext)) {
            continue;
          }
        }

        const stats = fs.statSync(fullPath);
        results.push({
          path: relativePath.replace(/\\/g, "/"), // Normalize path separators
          size: stats.size,
          type: path.extname(entry.name) || "file",
          lastModified: stats.mtime.toISOString(),
        });
      }
    }
  } catch (error) {
    // Silently skip directories we can't read
  }

  return results;
}
