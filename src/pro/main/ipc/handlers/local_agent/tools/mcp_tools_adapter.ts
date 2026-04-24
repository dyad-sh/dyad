/**
 * MCP → ToolDefinition Adapter
 *
 * The MCP server module already curates 60+ JoyCreate tools across apps,
 * agents, datasets, documents, images, video, neural models, marketplace,
 * skills, compute, chat, knowledge, workflows, etc. Rather than re-implement
 * each as a `ToolDefinition`, this adapter:
 *
 *  1. Implements a minimal `McpServer.registerTool(name, schema, handler)`
 *     surface that captures registrations.
 *  2. Invokes every `register*Tools(server)` function from `src/mcp_server/tools/`.
 *  3. Wraps each capture as a `ToolDefinition` so it can be exposed to the
 *     local agent + swarm runtime through the same channel as native tools.
 *
 * Net effect: anything available via MCP is automatically available to swarm
 * agents. Adding a new MCP tool file requires zero changes here other than
 * wiring its `register*` function below.
 */

import { z } from "zod";
import log from "electron-log";
import type { ToolDefinition } from "./types";

import { registerAppBuilderTools } from "@/mcp_server/tools/app_builder_tools";
import { registerAgentBuilderTools } from "@/mcp_server/tools/agent_builder_tools";
import { registerAgentTools } from "@/mcp_server/tools/agent_tools";
import { registerAgentMarketplaceTools } from "@/mcp_server/tools/agent_marketplace_tools";
import { registerWorkflowTools } from "@/mcp_server/tools/workflow_tools";
import { registerVideoTools } from "@/mcp_server/tools/video_tools";
import { registerSkillsTools } from "@/mcp_server/tools/skills_tools";
import { registerKnowledgeBaseTools } from "@/mcp_server/tools/knowledge_base_tools";
import { registerDocumentTools } from "@/mcp_server/tools/document_tools";
import { registerNeuralModelTools } from "@/mcp_server/tools/neural_model_tools";
import { registerImageTools } from "@/mcp_server/tools/image_tools";
import { registerDatasetTools } from "@/mcp_server/tools/dataset_tools";
import { registerMarketplaceTools } from "@/mcp_server/tools/marketplace_tools";
import { registerChatTools } from "@/mcp_server/tools/chat_tools";
import { registerComputeTools } from "@/mcp_server/tools/compute_tools";
import { registerCreatorDashboardTools } from "@/mcp_server/tools/creator_dashboard_tools";

const logger = log.scope("mcp_tools_adapter");

interface McpToolHandlerResult {
  content: Array<{ type: "text"; text: string }>;
}

type McpToolHandler = (args: any) => Promise<McpToolHandlerResult>;

interface McpToolRegistration {
  name: string;
  description: string;
  inputShape: Record<string, z.ZodTypeAny>;
  handler: McpToolHandler;
}

/**
 * Minimal McpServer surface — just enough for `register*Tools(server)` calls
 * to succeed without pulling in the real SDK runtime.
 */
class CapturingServer {
  registrations: McpToolRegistration[] = [];

  registerTool(
    name: string,
    schema: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
    handler: McpToolHandler,
  ): void {
    this.registrations.push({
      name,
      description: schema.description ?? "",
      inputShape: schema.inputSchema ?? {},
      handler,
    });
  }
}

/**
 * Heuristic: tools that look like they mutate state require explicit consent.
 */
const DESTRUCTIVE_PREFIXES = [
  "create",
  "delete",
  "update",
  "remove",
  "build",
  "deploy",
  "execute",
  "run",
  "publish",
  "trigger",
  "activate",
  "deactivate",
  "install",
  "uninstall",
  "train",
  "submit",
  "purchase",
  "buy",
  "mint",
  "send",
];

function isDestructive(shortName: string): boolean {
  return DESTRUCTIVE_PREFIXES.some(
    (p) => shortName.startsWith(`${p}_`) || shortName.includes(`_${p}_`),
  );
}

/**
 * Convert a captured MCP registration into a ToolDefinition.
 * Strips the `joycreate_` prefix to keep tool names succinct in the LLM context.
 */
function toToolDefinition(reg: McpToolRegistration): ToolDefinition {
  const inputSchema =
    Object.keys(reg.inputShape).length > 0
      ? z.object(reg.inputShape)
      : z.object({}).passthrough();

  const shortName = reg.name.replace(/^joycreate_/, "");
  const destructive = isDestructive(shortName);

  return {
    name: shortName,
    description: reg.description,
    inputSchema,
    defaultConsent: destructive ? "ask" : "always",
    getConsentPreview: (args: Record<string, unknown>) => {
      const keys = Object.keys(args).slice(0, 3);
      const sample = keys
        .map((k) => {
          const v = args[k];
          const sv =
            typeof v === "string"
              ? v.slice(0, 40)
              : JSON.stringify(v)?.slice(0, 40) ?? "";
          return `${k}=${sv}`;
        })
        .join(", ");
      return `${shortName}(${sample})`;
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const result = await reg.handler(args);
        const text = result?.content
          ?.map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
          .join("\n");
        return text ?? "";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${shortName} failed: ${msg}`);
      }
    },
  };
}

let cachedTools: ToolDefinition[] | null = null;

/**
 * Build (and memoize) the full MCP-derived tool list.
 * Called lazily so MCP tool modules don't run their imports until needed.
 */
export function getMcpAgentTools(): ToolDefinition[] {
  if (cachedTools) return cachedTools;

  const server = new CapturingServer();
  const registrars = [
    registerAppBuilderTools,
    registerAgentBuilderTools,
    registerAgentTools,
    registerAgentMarketplaceTools,
    registerWorkflowTools,
    registerVideoTools,
    registerSkillsTools,
    registerKnowledgeBaseTools,
    registerDocumentTools,
    registerNeuralModelTools,
    registerImageTools,
    registerDatasetTools,
    registerMarketplaceTools,
    registerChatTools,
    registerComputeTools,
    registerCreatorDashboardTools,
  ];

  for (const fn of registrars) {
    try {
      fn(server as unknown as Parameters<typeof fn>[0]);
    } catch (err) {
      logger.warn(`MCP registrar ${fn.name} threw: ${err}`);
    }
  }

  // Deduplicate by short name (last wins) — protects against accidental collisions
  const byName = new Map<string, ToolDefinition>();
  for (const reg of server.registrations) {
    const def = toToolDefinition(reg);
    byName.set(def.name, def);
  }
  cachedTools = Array.from(byName.values());
  logger.info(
    `MCP adapter exposed ${cachedTools.length} tools to the local agent`,
  );
  return cachedTools;
}

/**
 * Names exposed by the MCP adapter — useful for the swarm runtime allowlist.
 */
export function getMcpAgentToolNames(): string[] {
  return getMcpAgentTools().map((t) => t.name);
}
