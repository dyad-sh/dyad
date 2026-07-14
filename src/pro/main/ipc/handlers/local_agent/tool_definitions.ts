/**
 * Tool definitions for Local Agent v2
 * Each tool includes a zod schema, description, and execute function
 */

import { IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";
import { readSettings, writeSettings } from "@/main/settings";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import { writeFileTool } from "./tools/write_file";
import { deleteFileTool } from "./tools/delete_file";
import { renameFileTool } from "./tools/rename_file";
import { copyFileTool } from "./tools/copy_file";
import { addDependencyTool } from "./tools/add_dependency";
import { executeSqlTool } from "./tools/execute_sql";
import { getNeonProjectInfoTool } from "./tools/get_neon_project_info";
import { getDatabaseTableSchemaTool } from "./tools/get_database_table_schema";

import { readFileTool } from "./tools/read_file";
import { listFilesTool } from "./tools/list_files";
import { getSupabaseProjectInfoTool } from "./tools/get_supabase_project_info";
import { setChatSummaryTool } from "./tools/set_chat_summary";
import { addIntegrationTool } from "./tools/add_integration";
import { enableNitroTool } from "./tools/enable_nitro";
import { readLogsTool } from "./tools/read_logs";
import { searchReplaceTool } from "./tools/search_replace";
import { webSearchTool } from "./tools/web_search";
import { webCrawlTool } from "./tools/web_crawl";
import { webFetchTool } from "./tools/web_fetch";
import { generateImageTool } from "./tools/generate_image";
import { updateTodosTool } from "./tools/update_todos";
import { runTypeChecksTool } from "./tools/run_type_checks";
import { runTestsTool } from "./tools/run_tests";
import { grepTool } from "./tools/grep";
import { codeSearchTool } from "./tools/code_search";
import { exploreCodeTool } from "./tools/explore_code";
import { exploreChatHistoryTool } from "./tools/explore_chat_history";
import { searchChatsTool } from "./tools/search_chats";
import { readChatTool } from "./tools/read_chat";
import {
  cancelAgentTool,
  compilerExploreTool,
  followupTaskTool,
  listAgentsTool,
  sendMessageTool,
  spawnAgentTool,
  waitAgentsTool,
} from "./tools/subagent_tools";
import { planningQuestionnaireTool } from "./tools/planning_questionnaire";
import { writePlanTool } from "./tools/write_plan";
import { exitPlanTool } from "./tools/exit_plan";
import { readGuideTool } from "./tools/read_guide";
import { executeSandboxScriptTool } from "./tools/execute_sandbox_script";
import { searchMcpToolsTool } from "./tools/search_mcp_tools";
import { getMcpToolSchemaTool } from "./tools/get_mcp_tool_schema";
import { writeAppBlueprintTool } from "./tools/write_app_blueprint";
import {
  gitDiffTool,
  gitLogTool,
  gitRestoreFileTool,
  gitShowCommitTool,
  gitShowFileTool,
  gitStatusTool,
} from "./tools/git";
import type { LanguageModelV3ToolResultOutput } from "@ai-sdk/provider";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type ToolDefinition,
  type AgentContext,
  type ToolResult,
} from "./tools/types";
import {
  assertAppBlueprintApproved,
  requireToolConsentOrThrow,
  shouldTrackToolMutation,
  trackAppMutation,
  trackFileEditTool,
} from "./tools/tool_invocation";
import type { AgentToolConsent } from "@/lib/schemas";
import { getSupabaseClientCode } from "@/supabase_admin/supabase_context";
import { getNeonClientCode } from "@/neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import { assertMutationLease } from "./subagents/mutation_lease";

function getToolErrorDisplayDetails(error: unknown): string {
  if (error instanceof ExecuteAddDependencyError) {
    return error.displayDetails;
  }

  return error instanceof Error ? error.message : String(error);
}

function getToolErrorSummary(error: unknown): string {
  if (error instanceof ExecuteAddDependencyError) {
    return error.displaySummary;
  }

  return error instanceof Error ? error.message : String(error);
}

// Combined tool definitions array
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  writeFileTool,
  searchReplaceTool,
  copyFileTool,
  deleteFileTool,
  renameFileTool,
  addDependencyTool,
  executeSqlTool,
  readFileTool,
  listFilesTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitShowCommitTool,
  gitShowFileTool,
  gitRestoreFileTool,
  grepTool,
  codeSearchTool,
  exploreCodeTool,
  exploreChatHistoryTool,
  searchChatsTool,
  readChatTool,
  compilerExploreTool,
  spawnAgentTool,
  listAgentsTool,
  waitAgentsTool,
  cancelAgentTool,
  sendMessageTool,
  followupTaskTool,
  getSupabaseProjectInfoTool,
  getNeonProjectInfoTool,
  getDatabaseTableSchemaTool,
  setChatSummaryTool,
  addIntegrationTool,
  enableNitroTool,
  readLogsTool,
  webSearchTool,
  webCrawlTool,
  webFetchTool,
  generateImageTool,
  updateTodosTool,
  runTypeChecksTool,
  runTestsTool,
  readGuideTool,
  executeSandboxScriptTool,
  searchMcpToolsTool,
  getMcpToolSchemaTool,
  // Plan mode tools
  planningQuestionnaireTool,
  writePlanTool,
  exitPlanTool,
  // App blueprint tools
  writeAppBlueprintTool,
];
// ============================================================================
// Agent Tool Name Type (derived from TOOL_DEFINITIONS)
// ============================================================================

export type AgentToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

function getAgentToolConsentSettings(
  toolName: AgentToolName,
  consent: AgentToolConsent,
) {
  const settings = readSettings();
  return {
    agentToolConsents: {
      ...settings.agentToolConsents,
      [toolName]: consent,
    },
  };
}

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
  abortSignal?: AbortSignal,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve("decline");
      return;
    }

    const onAbort = () => {
      const entry = pendingConsentResolvers.get(requestId);
      if (entry) {
        pendingConsentResolvers.delete(requestId);
        entry.resolve("decline");
      }
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    pendingConsentResolvers.set(requestId, {
      chatId,
      resolve: (decision) => {
        abortSignal?.removeEventListener("abort", onAbort);
        resolve(decision);
      },
    });
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

/**
 * When autoApproveNonSchemaSql is enabled, execute_sql calls that the schema
 * classifier determines do not mutate the schema and do not delete data run
 * without a consent prompt. Schema-mutating or data-deleting SQL still
 * requires consent.
 */
export function shouldAutoApproveAgentTool(params: {
  toolName: AgentToolName;
  metadata?: SqlConsentMetadata | null;
  autoApproveNonSchemaSql: boolean | undefined;
}): boolean {
  return (
    params.toolName === "execute_sql" &&
    params.metadata?.sqlMutatesSchema === false &&
    params.metadata?.sqlDeletesData === false &&
    params.autoApproveNonSchemaSql === true
  );
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
  writeSettings(getAgentToolConsentSettings(toolName, consent));
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
    metadata?: SqlConsentMetadata | null;
    abortSignal?: AbortSignal;
  },
): Promise<boolean> {
  const current = getAgentToolConsent(params.toolName);

  if (current === "always") return true;
  if (current === "never")
    throw new DyadError(
      "Should not ask for consent for a tool marked as 'never'",
      DyadErrorKind.Internal,
    );

  if (
    shouldAutoApproveAgentTool({
      toolName: params.toolName,
      metadata: params.metadata,
      autoApproveNonSchemaSql: readSettings().autoApproveNonSchemaSql,
    })
  ) {
    return true;
  }

  // Ask renderer for a decision via event bridge
  const requestId = `agent:${params.toolName}:${crypto.randomUUID()}`;
  const { abortSignal, ...rendererParams } = params;
  (event.sender as any).send("agent-tool:consent-request", {
    requestId,
    ...rendererParams,
  });

  const response = await waitForAgentToolConsent(
    requestId,
    params.chatId,
    abortSignal,
  );

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
 * Process placeholders in tool args (e.g. $$SUPABASE_CLIENT_CODE$$, $$NEON_CLIENT_CODE$$)
 * Recursively processes all string values in the args object.
 */
async function processArgPlaceholders<T extends Record<string, any>>(
  args: T,
  ctx: AgentContext,
): Promise<T> {
  const argsStr = JSON.stringify(args);
  const hasSupabasePlaceholder = argsStr.includes("$$SUPABASE_CLIENT_CODE$$");
  const hasNeonPlaceholder = argsStr.includes("$$NEON_CLIENT_CODE$$");

  if (!hasSupabasePlaceholder && !hasNeonPlaceholder) {
    return args;
  }

  let supabaseClientCode: string | undefined;
  if (hasSupabasePlaceholder && ctx.supabaseProjectId) {
    supabaseClientCode = await getSupabaseClientCode({
      projectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
    });
  }

  let neonClientCode: string | undefined;
  if (hasNeonPlaceholder) {
    if (ctx.neonProjectId) {
      neonClientCode = getNeonClientCode(ctx.frameworkType);
    } else {
      neonClientCode = "";
    }
  }

  // Process all string values in args
  const processValue = (value: any): any => {
    if (typeof value === "string") {
      let result = value;
      if (supabaseClientCode) {
        result = result.replace(
          /\$\$SUPABASE_CLIENT_CODE\$\$/g,
          supabaseClientCode,
        );
      }
      if (neonClientCode !== undefined) {
        result = result.replace(/\$\$NEON_CLIENT_CODE\$\$/g, neonClientCode);
      }
      return result;
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
 * Convert our ToolResult to AI SDK format
 */
function convertToolResultForAiSdk(
  result: ToolResult,
): LanguageModelV3ToolResultOutput {
  if (typeof result === "string") {
    return { type: "text", value: result };
  }
  throw new DyadError(
    `Unsupported tool result type: ${typeof result}`,
    DyadErrorKind.Internal,
  );
}

export interface BuildAgentToolSetOptions {
  /**
   * If true, exclude tools that modify state (files, database, etc.).
   * Used for read-only modes like "ask" mode.
   */
  readOnly?: boolean;
  /**
   * If true, only include tools that are allowed in plan mode.
   * Plan mode has access to read-only tools plus planning-specific tools.
   */
  planModeOnly?: boolean;
  /**
   * If true, exclude Pro-only tools.
   * Used for basic agent mode where some tools may not be available.
   */
  basicAgentMode?: boolean;
  /**
   * If true, exclude tools that call separate Dyad Engine endpoints.
   * The free Pro model only uses the engine chat-completions endpoint.
   */
  freeModelMode?: boolean;
  /**
   * If false, exclude app blueprint tools (write_app_blueprint).
   */
  enableAppBlueprint?: boolean;
}

/**
 * Tools that should ONLY be available in plan mode (excluded from normal agent mode).
 * Note: planning_questionnaire is intentionally omitted so it's available in pro agent mode too.
 */
const PLAN_MODE_ONLY_TOOLS = new Set(["write_plan", "exit_plan"]);

/**
 * Planning-specific tools that are allowed in plan mode despite modifying state.
 * Superset of PLAN_MODE_ONLY_TOOLS plus tools that participate in planning
 * but are also available in normal (pro) agent mode.
 */
const PLANNING_SPECIFIC_TOOLS = new Set([
  ...PLAN_MODE_ONLY_TOOLS,
  "planning_questionnaire",
]);

/**
 * Tools only available in Pro agent mode (excluded from basic agent mode).
 */
const PRO_AGENT_ONLY_TOOLS = new Set<string>();

/**
 * Tools that are part of the app blueprint flow. Excluded when the feature
 * is disabled via the Workflow setting or once the per-app blueprint flag is
 * cleared.
 */
const APP_BLUEPRINT_TOOLS = new Set<string>(["write_app_blueprint"]);

/**
 * Tools that enforce the app-blueprint precondition themselves at the
 * capability layer instead of at the wrapper level. execute_sandbox_script
 * is state-modifying only because it MAY expose the write_file host
 * function; gating the whole tool would also block read-only inspection
 * scripts and MCP host calls during blueprint drafting, so the gate runs
 * inside the write_file host capability (see buildWriteFileCapability in
 * execute_sandbox_script.ts).
 */
const CAPABILITY_GATED_BLUEPRINT_TOOLS = new Set<string>([
  "execute_sandbox_script",
]);

function toolModifiesState(
  tool: (typeof TOOL_DEFINITIONS)[number],
  ctx: AgentContext,
): boolean {
  if (typeof tool.modifiesState === "function") {
    return tool.modifiesState(ctx);
  }
  return tool.modifiesState === true;
}

/**
 * Whether a tool belongs in this turn's tool set. Single source of truth for
 * inclusion, so a caller that needs the answer before the set is built (e.g. a
 * tool whose availability depends on another tool) can ask the same question
 * the builder does.
 */
export function shouldIncludeTool(
  tool: (typeof TOOL_DEFINITIONS)[number],
  ctx: AgentContext,
  options: BuildAgentToolSetOptions = {},
): boolean {
  if (getAgentToolConsent(tool.name) === "never") {
    return false;
  }
  // In plan mode, skip state-modifying tools unless they're planning-specific.
  if (
    options.planModeOnly &&
    toolModifiesState(tool, ctx) &&
    !PLANNING_SPECIFIC_TOOLS.has(tool.name)
  ) {
    return false;
  }
  // Skip plan-mode-only tools when NOT in plan mode.
  if (!options.planModeOnly && PLAN_MODE_ONLY_TOOLS.has(tool.name)) {
    return false;
  }
  // Skip Pro-only tools in basic agent mode.
  if (options.basicAgentMode && PRO_AGENT_ONLY_TOOLS.has(tool.name)) {
    return false;
  }
  if (options.freeModelMode && tool.usesEngineEndpoint) {
    return false;
  }
  if (tool.subagentOnly && !ctx.isDyadPro) {
    return false;
  }
  // search_chats is superseded by the explore_chat_history sub-agent wherever
  // the explorer is present (Pro): broad recall routes through the explorer
  // and targeted drill-down through read_chat. When the explorer is filtered
  // out (non-Pro, free-model mode), direct search remains available so chat
  // history stays reachable.
  if (
    tool.name === "search_chats" &&
    shouldIncludeTool(exploreChatHistoryTool, ctx, options)
  ) {
    return false;
  }
  // Skip app blueprint tools when the feature is disabled.
  if (
    options.enableAppBlueprint === false &&
    APP_BLUEPRINT_TOOLS.has(tool.name)
  ) {
    return false;
  }
  // In read-only mode, skip tools that modify state.
  if (options.readOnly && toolModifiesState(tool, ctx)) {
    return false;
  }
  if (tool.isEnabled) {
    const enabled = tool.isEnabled(ctx);
    if (!enabled) {
      return false;
    }
  }
  return true;
}

/**
 * Build ToolSet for AI SDK from tool definitions
 */
export function buildAgentToolSet(
  ctx: AgentContext,
  options: BuildAgentToolSetOptions = {},
) {
  const toolSet: Record<string, any> = {};

  for (const tool of TOOL_DEFINITIONS) {
    if (!shouldIncludeTool(tool, ctx, options)) {
      continue;
    }

    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.getInputSchema?.(ctx) ?? tool.inputSchema,
      execute: async (args: any) => {
        try {
          if (
            toolModifiesState(tool, ctx) &&
            tool.requiresMutationLease !== false
          ) {
            assertMutationLease(ctx);
          }
          // Guard against state-modifying tools running before the app
          // blueprint approval is resolved. `write_app_blueprint` owns the
          // approval gate; blueprint tools themselves are allowed through so
          // the flow can progress to approval. Skip entirely when the
          // blueprint feature is disabled — otherwise a plan left over from
          // before the toggle would permanently block the agent.
          //
          // When the feature is enabled, also block if NO plan exists yet —
          // the prompt instructs the model to call write_app_blueprint first,
          // but the prompt isn't an enforcement boundary. Without this check,
          // a model that skips write_app_blueprint can still call e.g.
          // write_file and bypass the required blueprint approval flow.
          if (
            toolModifiesState(tool, ctx) &&
            !APP_BLUEPRINT_TOOLS.has(tool.name) &&
            !PLANNING_SPECIFIC_TOOLS.has(tool.name) &&
            !CAPABILITY_GATED_BLUEPRINT_TOOLS.has(tool.name)
          ) {
            assertAppBlueprintApproved({
              toolName: tool.name,
              chatId: ctx.chatId,
              enabled: options.enableAppBlueprint !== false,
            });
          }

          const processedArgs = await processArgPlaceholders(args, ctx);

          // Check consent before executing the tool
          await requireToolConsentOrThrow(tool, processedArgs, ctx);

          // Track file edit tool usage before execution to capture all attempts
          // (including failures) for retry/fallback telemetry
          trackFileEditTool(ctx, tool.name, processedArgs);
          const result = await tool.execute(processedArgs, ctx);

          // Only completed mutations unblock run_tests. Failed tool calls are
          // still present in fileEditTracker for retry/fallback telemetry, but
          // must not masquerade as a code change.
          trackAppMutation(
            ctx,
            tool.name,
            shouldTrackToolMutation(tool, processedArgs, result, ctx),
          );

          return convertToolResultForAiSdk(result);
        } catch (error) {
          const errorMessage = getToolErrorSummary(error);
          const errorDetails = getToolErrorDisplayDetails(error);

          ctx.onXmlComplete(
            `<dyad-output type="error" message="Tool '${tool.name}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorDetails)}</dyad-output>`,
          );
          throw error;
        }
      },
    };
  }

  return toolSet;
}
