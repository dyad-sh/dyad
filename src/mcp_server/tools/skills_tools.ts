/**
 * MCP Tools — Skills / Plugins / Prompts
 * Create, manage, and publish skills, prompts, and plugins via JoyCreate.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSkillsTools(server: McpServer) {
  server.registerTool(
    "joycreate_skill_create",
    {
      description: "Create a new reusable AI skill or prompt template in JoyCreate. Skills can be packaged and sold on Joy Marketplace.",
      inputSchema: {
        name: z.string().describe("Skill name"),
        description: z.string().describe("What this skill does"),
        type: z.enum(["prompt", "chain", "tool", "plugin", "workflow"]).describe("Skill type"),
        content: z.string().describe("The skill content — prompt template, code, or config"),
        variables: z.array(z.object({
          name: z.string(),
          description: z.string(),
          type: z.enum(["string", "number", "boolean", "array"]).optional(),
          default: z.string().optional(),
        })).optional().describe("Input variables for parameterized skills"),
        tags: z.array(z.string()).optional(),
        category: z.string().optional().describe("Category (e.g. coding, writing, research, creative)"),
      },
    },
    async (params) => {
      try {
        const { createPrompt } = require("@/ipc/handlers/prompt_handlers");
        const result = await createPrompt?.(params) ?? { error: "Skill creation not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_skill_list",
    {
      description: "List skills, prompt templates, and plugins in JoyCreate.",
      inputSchema: {
        search: z.string().optional().describe("Search by name or description"),
        type: z.enum(["prompt", "chain", "tool", "plugin", "workflow"]).optional(),
        category: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (params) => {
      try {
        const { listPrompts } = require("@/ipc/handlers/prompt_handlers");
        const result = await listPrompts?.(params) ?? { skills: [], count: 0 };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_skill_publish",
    {
      description: "Publish a skill or prompt template to Joy Marketplace as a sellable asset.",
      inputSchema: {
        skill_id: z.string().describe("Skill/prompt ID to publish"),
        price_usd: z.number().optional().describe("Price in USD (0 for free)"),
        license: z.string().optional().describe("License type"),
        royalty_percent: z.number().optional(),
      },
    },
    async (params) => {
      try {
        const { publishPrompt } = require("@/ipc/handlers/prompt_handlers");
        const result = await publishPrompt?.(params) ?? { error: "Skill publish not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_plugin_list",
    {
      description: "List installed plugins in JoyCreate and browse the plugin registry.",
      inputSchema: {
        installed_only: z.boolean().optional().describe("Only show installed plugins (default false = show all)"),
        search: z.string().optional(),
        category: z.string().optional(),
      },
    },
    async (params) => {
      try {
        const { listPlugins } = require("@/ipc/handlers/plugin_handlers");
        const result = await listPlugins?.(params) ?? { plugins: [] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_plugin_install",
    {
      description: "Install a plugin into JoyCreate from the registry or a URL.",
      inputSchema: {
        plugin_id: z.string().optional().describe("Plugin ID from registry"),
        url: z.string().optional().describe("Direct URL to plugin package"),
      },
    },
    async (params) => {
      try {
        const { installPlugin } = require("@/ipc/handlers/plugin_handlers");
        const result = await installPlugin?.(params) ?? { error: "Plugin install not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
