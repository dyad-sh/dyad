/**
 * MCP Tools — App Builder
 * Create, manage, build, and deploy apps via JoyCreate's App Builder.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "@/db";
import { apps } from "@/db/schema";
import { eq, like, desc } from "drizzle-orm";

export function registerAppBuilderTools(server: McpServer) {
  server.registerTool(
    "joycreate_app_list",
    {
      description: "List apps in JoyCreate App Builder. Each app is a full project with its own chat history, files, and configuration.",
      inputSchema: {
        search: z.string().optional().describe("Search apps by name"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
    },
    async ({ search, limit }) => {
      try {
        const db = getDb();
        let query: any = db.select({
          id: apps.id,
          name: apps.name,
          description: apps.description,
          createdAt: apps.createdAt,
          updatedAt: apps.updatedAt,
        }).from(apps).orderBy(desc(apps.updatedAt)).limit(limit ?? 20);
        if (search) query = query.where(like(apps.name, `%${search}%`));
        const results = await query;
        return { content: [{ type: "text" as const, text: JSON.stringify({ apps: results, count: results.length }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_app_create",
    {
      description: "Create a new app/project in JoyCreate. Optionally use a template to scaffold common project types.",
      inputSchema: {
        name: z.string().describe("App name"),
        description: z.string().optional().describe("App description"),
        template: z.string().optional().describe("Template to use (e.g. react, nextjs, fastapi, electron, blank)"),
        framework: z.string().optional().describe("Framework (e.g. react, vue, svelte, python)"),
      },
    },
    async (params) => {
      try {
        const { createApp } = require("@/ipc/handlers/app_handlers");
        const result = await createApp?.(params) ?? { error: "App creation not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_app_build",
    {
      description: "Build an app in JoyCreate — runs the build process and returns output/errors.",
      inputSchema: {
        app_id: z.number().describe("App ID to build"),
        environment: z.enum(["development", "production"]).optional().describe("Build environment"),
      },
    },
    async (params) => {
      try {
        const { buildApp } = require("@/ipc/handlers/app_handlers");
        const result = await buildApp?.(params) ?? { error: "App build not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_app_deploy",
    {
      description: "Deploy an app from JoyCreate to a hosting target (Vercel, decentralized, local, or Joy Marketplace).",
      inputSchema: {
        app_id: z.number().describe("App ID to deploy"),
        target: z.enum(["vercel", "decentralized", "local", "marketplace"]).describe("Deploy target"),
        publish_to_marketplace: z.boolean().optional().describe("Also list on Joy Marketplace"),
        price_usd: z.number().optional().describe("Marketplace price if publishing"),
      },
    },
    async (params) => {
      try {
        const { deployApp } = require("@/ipc/handlers/decentralized_deploy_handlers");
        const result = await deployApp?.(params) ?? { error: "App deploy not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
