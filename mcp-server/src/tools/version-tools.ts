/**
 * Version control tools for Dyad MCP Server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { DyadDatabase } from "../database.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as git from "isomorphic-git";

export function registerVersionTools(
  db: DyadDatabase,
  registerTool: (tool: Tool, handler: (args: any) => Promise<any>) => void
): void {
  // ============================================
  // dyad_get_git_status
  // ============================================
  registerTool(
    {
      name: "dyad_get_git_status",
      description:
        "Get the Git status of a Dyad app. Returns information about the current branch, commit, and file changes.",
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

      if (!fs.existsSync(app.path)) {
        throw new Error(`App path does not exist: ${app.path}`);
      }

      try {
        // Get current branch
        const currentBranch = await git.currentBranch({
          fs,
          dir: app.path,
          fullname: false,
        });

        // Get current commit
        const commitOid = await git.resolveRef({
          fs,
          dir: app.path,
          ref: "HEAD",
        });

        // Get commit details
        const commit = await git.readCommit({
          fs,
          dir: app.path,
          oid: commitOid,
        });

        // Get status matrix for file changes
        const statusMatrix = await git.statusMatrix({
          fs,
          dir: app.path,
        });

        const changes = {
          modified: [] as string[],
          added: [] as string[],
          deleted: [] as string[],
          untracked: [] as string[],
        };

        for (const [filepath, headStatus, workdirStatus, stageStatus] of statusMatrix) {
          if (headStatus === 1 && workdirStatus === 2 && stageStatus === 2) {
            changes.modified.push(filepath);
          } else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
            changes.untracked.push(filepath);
          } else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 0) {
            changes.deleted.push(filepath);
          } else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 2) {
            changes.added.push(filepath);
          }
        }

        return {
          appId,
          appName: app.name,
          branch: currentBranch || "main",
          commit: {
            oid: commitOid,
            message: commit.commit.message,
            author: commit.commit.author.name,
            timestamp: new Date(
              commit.commit.author.timestamp * 1000
            ).toISOString(),
          },
          changes,
          hasChanges:
            changes.modified.length > 0 ||
            changes.added.length > 0 ||
            changes.deleted.length > 0 ||
            changes.untracked.length > 0,
        };
      } catch (error) {
        throw new Error(
          `Failed to get Git status: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ============================================
  // dyad_get_git_log
  // ============================================
  registerTool(
    {
      name: "dyad_get_git_log",
      description:
        "Get the Git commit history of a Dyad app. Returns a list of commits with their messages, authors, and timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "number",
            description: "The unique ID of the app",
          },
          limit: {
            type: "number",
            description: "Maximum number of commits to return (default: 20)",
            default: 20,
          },
        },
        required: ["appId"],
      },
    },
    async (args: { appId: number; limit?: number }) => {
      const schema = z.object({
        appId: z.number(),
        limit: z.number().default(20),
      });
      const { appId, limit } = schema.parse(args);

      const app = await db.getApp(appId);
      if (!app) {
        throw new Error(`App with ID ${appId} not found`);
      }

      if (!fs.existsSync(app.path)) {
        throw new Error(`App path does not exist: ${app.path}`);
      }

      try {
        const commits = await git.log({
          fs,
          dir: app.path,
          depth: limit,
        });

        const formattedCommits = commits.map((commit) => ({
          oid: commit.oid,
          message: commit.commit.message,
          author: {
            name: commit.commit.author.name,
            email: commit.commit.author.email,
          },
          timestamp: new Date(
            commit.commit.author.timestamp * 1000
          ).toISOString(),
        }));

        return {
          appId,
          appName: app.name,
          commits: formattedCommits,
          count: formattedCommits.length,
          limited: formattedCommits.length === limit,
        };
      } catch (error) {
        throw new Error(
          `Failed to get Git log: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
