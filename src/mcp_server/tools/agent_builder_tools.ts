/**
 * MCP Tools — Agent Creator / Builder
 * Create, configure, deploy, and manage AI agents via JoyCreate's Agent Builder system.
 * Extends the existing agent_tools.ts (which lists/reads) with full CRUD + deployment.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerAgentBuilderTools(server: McpServer) {
  server.registerTool(
    "joycreate_agent_create",
    {
      description: "Create a new AI agent in JoyCreate Agent Builder. Define its personality, tools, memory, and capabilities.",
      inputSchema: {
        name: z.string().describe("Agent name"),
        description: z.string().describe("What this agent does"),
        system_prompt: z.string().describe("System prompt defining the agent's behavior and persona"),
        model: z.string().optional().describe("Model to use (e.g. gpt-5.1, claude-sonnet-4-20250514, mistral:7b)"),
        tools: z.array(z.string()).optional().describe("Tool names to enable (e.g. ['web_search', 'code_execution', 'file_read'])"),
        memory_enabled: z.boolean().optional().describe("Enable persistent memory across sessions"),
        voice_enabled: z.boolean().optional().describe("Enable voice interface"),
        autonomous: z.boolean().optional().describe("Enable autonomous task execution"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
      },
    },
    async (params) => {
      try {
        const { createAgent } = require("@/ipc/handlers/agent_creation_handlers");
        const result = await createAgent?.(params) ?? { error: "Agent creation not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_agent_deploy",
    {
      description: "Deploy an agent to a channel or publish to Joy Marketplace. Supports Telegram, Discord, web widget, API, and more.",
      inputSchema: {
        agent_id: z.string().describe("Agent ID to deploy"),
        channels: z.array(z.enum(["telegram", "discord", "web", "api", "whatsapp"])).describe("Deployment channels"),
        publish_to_marketplace: z.boolean().optional().describe("Also publish to Joy Marketplace"),
        price_usd: z.number().optional().describe("Marketplace price if publishing"),
        license: z.string().optional().describe("License type"),
      },
    },
    async (params) => {
      try {
        const { deployAgent } = require("@/ipc/handlers/agent_marketplace_handlers");
        const result = await deployAgent?.(params) ?? { error: "Agent deploy not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_agent_swarm",
    {
      description: "Create and run a swarm of cooperative AI agents. Each agent has a specialized role and they collaborate to solve complex tasks.",
      inputSchema: {
        task: z.string().describe("High-level task for the swarm to complete"),
        agents: z.array(z.object({
          role: z.string().describe("Agent role (e.g. researcher, coder, reviewer, writer)"),
          model: z.string().optional().describe("Model for this agent"),
          instructions: z.string().optional().describe("Specific instructions for this role"),
        })).describe("Swarm agent definitions"),
        max_rounds: z.number().optional().describe("Max collaboration rounds (default 5)"),
        output_format: z.string().optional().describe("Expected output format"),
      },
    },
    async (params) => {
      try {
        const { runAgentSwarm } = require("@/ipc/handlers/agent_swarm_handlers");
        const result = await runAgentSwarm?.(params) ?? { error: "Agent swarm not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_agent_stack",
    {
      description: "Build a vertical agent stack — a chain of agents where each processes the previous agent's output (pipeline pattern).",
      inputSchema: {
        name: z.string().describe("Stack name"),
        stages: z.array(z.object({
          agent_id: z.string().optional().describe("Existing agent ID (or define inline)"),
          role: z.string().describe("Stage role"),
          model: z.string().optional(),
          prompt_template: z.string().optional().describe("Template with {{input}} placeholder"),
        })).describe("Pipeline stages in order"),
        input: z.string().optional().describe("Initial input to run through the stack"),
      },
    },
    async (params) => {
      try {
        const { buildAgentStack } = require("@/ipc/handlers/agent_stack_handlers");
        const result = await buildAgentStack?.(params) ?? { error: "Agent stack not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
