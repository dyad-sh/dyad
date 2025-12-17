/**
 * Tool definitions for Local Agent v2
 * Each tool includes a zod schema, description, and execute function
 */

import { IpcMainInvokeEvent } from "electron";
import { readSettings, writeSettings } from "@/main/settings";
import { writeFileTool } from "./tools/write_file";
import { deleteFileTool } from "./tools/delete_file";
import { renameFileTool } from "./tools/rename_file";
import { addDependencyTool } from "./tools/add_dependency";
import { executeSqlTool } from "./tools/execute_sql";
import { searchReplaceTool } from "./tools/search_replace";
import { readFileTool } from "./tools/read_file";
import { listFilesTool } from "./tools/list_files";
import { getDatabaseSchemaTool } from "./tools/get_database_schema";
import { setChatSummaryTool } from "./tools/set_chat_summary";
import type { ToolDefinition, AgentContext } from "./tools/types";
import type { AgentToolConsent } from "@/ipc/ipc_types";
// Combined tool definitions array
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  writeFileTool,
  deleteFileTool,
  renameFileTool,
  addDependencyTool,
  executeSqlTool,
  searchReplaceTool,
  readFileTool,
  listFilesTool,
  getDatabaseSchemaTool,
  setChatSummaryTool,
];
// ============================================================================
// Agent Tool Name Type (derived from TOOL_DEFINITIONS)
// ============================================================================

export type AgentToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

// ============================================================================
// Agent Tool Consent Management
// ============================================================================

const pendingConsentResolvers = new Map<
  string,
  (d: "accept-once" | "accept-always" | "decline") => void
>();

export function waitForAgentToolConsent(
  requestId: string,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, resolve);
  });
}

export function resolveAgentToolConsent(
  requestId: string,
  decision: "accept-once" | "accept-always" | "decline",
) {
  const resolver = pendingConsentResolvers.get(requestId);
  if (resolver) {
    pendingConsentResolvers.delete(requestId);
    resolver(decision);
  }
}

export function getDefaultConsent(toolName: AgentToolName): AgentToolConsent {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  return tool?.defaultConsent ?? "ask";
}

export function getAgentToolConsent(toolName: AgentToolName): AgentToolConsent {
  const settings = readSettings();
  const stored = settings.agentToolConsents?.[toolName];
  if (stored === "ask" || stored === "always") {
    return stored;
  }
  return getDefaultConsent(toolName);
}

export function setAgentToolConsent(
  toolName: AgentToolName,
  consent: AgentToolConsent,
): void {
  const settings = readSettings();
  writeSettings({
    agentToolConsents: {
      ...settings.agentToolConsents,
      [toolName]: consent,
    },
  });
}

export function getAllAgentToolConsents(): Record<
  AgentToolName,
  AgentToolConsent
> {
  const settings = readSettings();
  const stored = settings.agentToolConsents ?? {};
  const result: Record<string, AgentToolConsent> = {};

  // Start with defaults, override with stored values
  for (const tool of TOOL_DEFINITIONS) {
    const storedConsent = stored[tool.name];
    if (storedConsent === "ask" || storedConsent === "always") {
      result[tool.name] = storedConsent;
    } else {
      result[tool.name] = getDefaultConsent(tool.name as AgentToolName);
    }
  }

  return result as Record<AgentToolName, AgentToolConsent>;
}

export async function requireAgentToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    toolName: AgentToolName;
    toolDescription?: string | null;
    inputPreview?: string | null;
  },
): Promise<boolean> {
  const current = getAgentToolConsent(params.toolName);

  if (current === "always") return true;

  // Ask renderer for a decision via event bridge
  const requestId = `agent:${params.toolName}:${Date.now()}`;
  (event.sender as any).send("agent-tool:consent-request", {
    requestId,
    ...params,
  });

  const response = await waitForAgentToolConsent(requestId);

  if (response === "accept-always") {
    setAgentToolConsent(params.toolName, "always");
    return true;
  }
  if (response === "decline") {
    return false;
  }
  return response === "accept-once";
}

// ============================================================================
// Build Agent Tool Set
// ============================================================================

/**
 * Build ToolSet for AI SDK from tool definitions
 */
export function buildAgentToolSet(ctx: AgentContext) {
  const toolSet: Record<string, any> = {};

  for (const tool of TOOL_DEFINITIONS) {
    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: any) => {
        return tool.execute(args, ctx);
      },
    };
  }

  return toolSet;
}
