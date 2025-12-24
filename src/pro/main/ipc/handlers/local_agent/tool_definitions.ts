/**
 * Tool definitions for Local Agent v2
 * Each tool includes a zod schema, description, and execute function
 */

import { IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";
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
import { addIntegrationTool } from "./tools/add_integration";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type ToolDefinition,
  type AgentContext,
} from "./tools/types";
import type { AgentToolConsent } from "@/ipc/ipc_types";
import { getSupabaseClientCode } from "@/supabase_admin/supabase_context";
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
  addIntegrationTool,
];
// ============================================================================
// Agent Tool Name Type (derived from TOOL_DEFINITIONS)
// ============================================================================

export type AgentToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

// ============================================================================
// Agent Tool Consent Management
// ============================================================================

interface PendingConsentEntry {
  chatId: number;
  resolve: (d: "accept-once" | "accept-always" | "decline") => void;
}

const pendingConsentResolvers = new Map<string, PendingConsentEntry>();

export function waitForAgentToolConsent(
  requestId: string,
  chatId: number,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, { chatId, resolve });
  });
}

export function resolveAgentToolConsent(
  requestId: string,
  decision: "accept-once" | "accept-always" | "decline",
) {
  const entry = pendingConsentResolvers.get(requestId);
  if (entry) {
    pendingConsentResolvers.delete(requestId);
    entry.resolve(decision);
  }
}

/**
 * Clean up all pending consent requests for a given chat.
 * Called when a stream is cancelled/aborted to prevent orphaned promises
 * and stale UI banners.
 */
export function clearPendingConsentsForChat(chatId: number): void {
  for (const [requestId, entry] of pendingConsentResolvers) {
    if (entry.chatId === chatId) {
      pendingConsentResolvers.delete(requestId);
      // Resolve with decline so the tool execution fails gracefully
      entry.resolve("decline");
    }
  }
}

export function getDefaultConsent(toolName: AgentToolName): AgentToolConsent {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  return tool?.defaultConsent ?? "ask";
}

export function getAgentToolConsent(toolName: AgentToolName): AgentToolConsent {
  const settings = readSettings();
  const stored = settings.agentToolConsents?.[toolName];
  if (stored) {
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
    if (storedConsent) {
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
    chatId: number;
    toolName: AgentToolName;
    toolDescription?: string | null;
    inputPreview?: string | null;
  },
): Promise<boolean> {
  const current = getAgentToolConsent(params.toolName);

  if (current === "always") return true;

  // Ask renderer for a decision via event bridge
  const requestId = `agent:${params.toolName}:${crypto.randomUUID()}`;
  (event.sender as any).send("agent-tool:consent-request", {
    requestId,
    ...params,
  });

  const response = await waitForAgentToolConsent(requestId, params.chatId);

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
 * Process placeholders in tool args (e.g. $$SUPABASE_CLIENT_CODE$$)
 * Recursively processes all string values in the args object.
 */
async function processArgPlaceholders<T extends Record<string, any>>(
  args: T,
  ctx: AgentContext,
): Promise<T> {
  if (!ctx.supabaseProjectId) {
    return args;
  }

  // Check if any string values contain the placeholder
  const argsStr = JSON.stringify(args);
  if (!argsStr.includes("$$SUPABASE_CLIENT_CODE$$")) {
    return args;
  }

  // Fetch the replacement value once
  const supabaseClientCode = await getSupabaseClientCode({
    projectId: ctx.supabaseProjectId,
    organizationSlug: ctx.supabaseOrganizationSlug ?? null,
  });

  // Process all string values in args
  const processValue = (value: any): any => {
    if (typeof value === "string") {
      return value.replace(/\$\$SUPABASE_CLIENT_CODE\$\$/g, supabaseClientCode);
    }
    if (Array.isArray(value)) {
      return value.map(processValue);
    }
    if (value && typeof value === "object") {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = processValue(v);
      }
      return result;
    }
    return value;
  };

  return processValue(args) as T;
}

/**
 * Build ToolSet for AI SDK from tool definitions
 */
export function buildAgentToolSet(ctx: AgentContext) {
  const toolSet: Record<string, any> = {};

  for (const tool of TOOL_DEFINITIONS) {
    if (tool.isEnabled && !tool.isEnabled(ctx)) {
      continue;
    }

    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: any) => {
        try {
          const processedArgs = await processArgPlaceholders(args, ctx);

          // Check consent before executing the tool
          const allowed = await ctx.requireConsent({
            toolName: tool.name,
            toolDescription: tool.description,
            inputPreview: tool.getConsentPreview?.(processedArgs) ?? null,
          });
          if (!allowed) {
            throw new Error(`User denied permission for ${tool.name}`);
          }

          return await tool.execute(processedArgs, ctx);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack =
            error instanceof Error && error.stack ? error.stack : "";
          ctx.onXmlComplete(
            `<dyad-output type="error" message="Tool '${tool.name}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</dyad-output>`,
          );
          throw error;
        }
      },
    };
  }

  return toolSet;
}
