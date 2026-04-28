/**
 * MCP Tools â€” AI Agents
 *
 * List, inspect, and create AI agents stored in the local JoyCreate database.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "@/db";
import { agents, agentTools } from "@/db/schema";
import type { AgentStatus } from "@/db/schema";
import { eq, like, desc } from "drizzle-orm";

export function registerAgentTools(server: McpServer) {
  // â”€â”€ List agents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.registerTool(
    "joycreate_list_agents",
    {
      description:
        "List AI agents defined in JoyCreate. Agents can be chatbots, code generators, research assistants, etc.",
      inputSchema: {
        search: z.string().optional().describe("Search agents by name"),
        status: z
          .enum(["draft", "testing", "deployed", "archived"])
          .optional()
          .describe("Filter by agent status"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
    },
    async ({ search, status, limit }) => {
      const db = getDb();
      let query = db
        .select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          type: agents.type,
          status: agents.status,
          modelId: agents.modelId,
          version: agents.version,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .$dynamic();

      if (search) {
        query = query.where(like(agents.name, `%${search}%`));
      }
      if (status) {
        query = query.where(eq(agents.status, status as AgentStatus));
      }

      const rows = await query
        .orderBy(desc(agents.updatedAt))
        .limit(limit ?? 20);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  // â”€â”€ Get agent detail + tools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.registerTool(
    "joycreate_get_agent",
    {
      description:
        "Get detailed information about a specific agent, including its system prompt and custom tools.",
      inputSchema: {
        agentId: z.number().describe("The agent ID"),
      },
    },
    async ({ agentId }) => {
      const db = getDb();
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent ${agentId} not found.` }],
        };
      }

      const tools = await db
        .select()
        .from(agentTools)
        .where(eq(agentTools.agentId, agentId));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ...agent,
                tools: tools.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  enabled: t.enabled,
                  requiresApproval: t.requiresApproval,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // â”€â”€ Create agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.registerTool(
    "joycreate_create_agent",
    {
      description:
        "Create a new AI agent in JoyCreate with a name, type, and optional system prompt + model.",
      inputSchema: {
        name: z.string().describe("Agent name"),
        description: z.string().optional().describe("Short description"),
        type: z
          .enum(["chatbot", "coder", "researcher", "custom"])
          .optional()
          .describe("Agent type (default: chatbot)"),
        systemPrompt: z.string().optional().describe("System prompt for the agent"),
        modelId: z.string().optional().describe("AI model identifier (e.g. gpt-5.1, claude-sonnet-4-5)"),
      },
    },
    async ({ name, description, type, systemPrompt, modelId }) => {
      const db = getDb();
      const [created] = await db
        .insert(agents)
        .values({
          name,
          description: description ?? null,
          type: (type as any) ?? "chatbot",
          systemPrompt: systemPrompt ?? null,
          modelId: modelId ?? null,
        })
        .returning({ id: agents.id, name: agents.name });

      return {
        content: [
          {
            type: "text" as const,
            text: `Agent created: ${created.name} (ID: ${created.id})`,
          },
        ],
      };
    },
  );
}
