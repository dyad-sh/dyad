/**
 * Tool definitions for Local Agent v2
 * Each tool includes a zod schema, description, and execute function
 */

import { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { readSettings, writeSettings } from "@/main/settings";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "@/user_input/main";
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
import { runPreCommitTool } from "./tools/run_pre_commit";
import { runBuildTool } from "./tools/run_build";
import { generateTestAssertionsTool } from "./tools/generate_test_assertions";
import {
  reinstallAndRestartAppTool,
  restartAppTool,
} from "./tools/app_lifecycle";
import { grepTool } from "./tools/grep";
import { codeSearchTool } from "./tools/code_search";
import { exploreChatHistoryTool } from "./tools/explore_chat_history";
import { searchChatsTool } from "./tools/search_chats";
import { readChatTool } from "./tools/read_chat";
import {
  cancelAgentTool,
  exploreCodeTool,
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
import {
  buildExecuteSandboxScriptDescription,
  executeSandboxScriptTool,
} from "./tools/execute_sandbox_script";
import { searchMcpToolsTool } from "./tools/search_mcp_tools";
import { getMcpToolSchemaTool } from "./tools/get_mcp_tool_schema";
import {
  estimateMcpInlineTokens,
  getMcpInlineTokenThreshold,
  type McpToolDef,
} from "./tools/mcp_type_defs";
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
import { asSchema } from "ai";
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
  shouldTrackToolFileMutation,
  shouldTrackToolMutation,
  trackAppMutation,
  trackFileEditTool,
} from "./tools/tool_invocation";
import type { AgentToolConsent } from "@/lib/schemas";
import { getSupabaseClientCode } from "@/supabase_admin/supabase_context";
import { getNeonClientCode } from "@/neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import { withTrackedMutation } from "./subagents/mutation_activity_tracker";
import { estimateTokens } from "@/ipc/utils/token_utils";

const logger = log.scope("local_agent_tools");

function recordStreamingToolActivity(
  ctx: AgentContext,
  activity: Parameters<NonNullable<AgentContext["onToolActivity"]>>[0],
): void {
  const update = ctx.onToolActivity?.(activity);
  if (update) {
    void update.catch((error) =>
      logger.warn("Failed to record streaming sub-agent activity", error),
    );
  }
}

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
  exploreChatHistoryTool,
  searchChatsTool,
  readChatTool,
  exploreCodeTool,
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
  runPreCommitTool,
  runBuildTool,
  runTestsTool,
  generateTestAssertionsTool,
  restartAppTool,
  reinstallAndRestartAppTool,
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
    subagent?: {
      threadId: string;
      persona: "explorer" | "implementer";
      taskName: string;
    };
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

  rememberUserInputSubscriber(event.sender);
  const requestId = userInputRegistry.request({
    kind: "agent-consent",
    chatId: params.chatId,
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    inputPreview: params.inputPreview,
    metadata: params.metadata,
    subagent: params.subagent,
    classifier: "none",
  });
  const response = await userInputRegistry.park(requestId, params.abortSignal);
  return response?.kind === "agent-consent" && response.decision !== "decline";
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

function serializeActivityOutput(result: ToolResult): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

export interface BuildAgentToolSetOptions {
  /**
   * Selects the fail-closed surface for the active writable mode. Build mode
   * intentionally exposes only the tools needed to create an app without
   * Agent-only orchestration, Engine, diagnostics, or verification tools.
   */
  toolProfile?: "agent" | "build";
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

export const BUILD_MODE_TOOL_NAMES = [
  "write_file",
  "search_replace",
  "copy_file",
  "delete_file",
  "rename_file",
  "add_dependency",
  "execute_sql",
  "read_file",
  "list_files",
  "grep",
  "get_supabase_project_info",
  "get_neon_project_info",
  "get_database_table_schema",
  "set_chat_summary",
  "add_integration",
  "enable_nitro",
  "restart_app",
  "reinstall_and_restart_app",
  "update_todos",
  "read_guide",
  "planning_questionnaire",
  "write_app_blueprint",
] as const satisfies readonly AgentToolName[];

const BUILD_MODE_TOOL_NAME_SET = new Set<AgentToolName>(BUILD_MODE_TOOL_NAMES);

export async function estimateAgentToolTokens({
  toolProfile = "agent",
  readOnly = false,
  planModeOnly = false,
  basicAgentMode = false,
  freeModelMode = false,
  enableAppBlueprint,
  isDyadPro,
  frameworkType,
  supabaseProjectId,
  supabaseProviderToolsAvailable = false,
  neonProjectId,
  neonActiveBranchId,
  neonProviderToolsAvailable = false,
  testingEnabled = false,
  canUseExplorerSubagent = false,
  canUseImplementerSubagent = false,
  canUseAdvancedSubagentTools = false,
  preCommitHookAvailable = false,
  reinstallAndRestartAppToolAvailable = true,
  mcpToolDefs = [],
}: {
  toolProfile?: "agent" | "build";
  readOnly?: boolean;
  planModeOnly?: boolean;
  basicAgentMode?: boolean;
  freeModelMode?: boolean;
  enableAppBlueprint: boolean;
  isDyadPro: boolean;
  frameworkType: AgentContext["frameworkType"];
  supabaseProjectId: string | null;
  supabaseProviderToolsAvailable?: boolean;
  neonProjectId: string | null;
  neonActiveBranchId: string | null;
  neonProviderToolsAvailable?: boolean;
  testingEnabled?: boolean;
  canUseExplorerSubagent?: boolean;
  canUseImplementerSubagent?: boolean;
  canUseAdvancedSubagentTools?: boolean;
  preCommitHookAvailable?: boolean;
  reinstallAndRestartAppToolAvailable?: boolean;
  mcpToolDefs?: McpToolDef[];
}): Promise<number> {
  const estimateContext = {
    isDyadPro,
    frameworkType,
    supabaseProjectId,
    supabaseProviderToolsAvailable,
    neonProjectId,
    neonActiveBranchId,
    neonProviderToolsAvailable,
    referencedApps: new Map(),
    testingEnabled,
    canUseExplorerSubagent,
    canUseImplementerSubagent,
    canUseAdvancedSubagentTools,
    preCommitHookAvailable,
    reinstallAndRestartAppToolAvailable,
    sandboxWriteFileHostEnabled: !readOnly && !planModeOnly,
  } as AgentContext;
  const options: BuildAgentToolSetOptions = {
    toolProfile,
    readOnly,
    planModeOnly,
    basicAgentMode,
    freeModelMode,
    enableAppBlueprint,
  };
  const mcpInSandboxEnabled =
    toolProfile !== "build" &&
    !readOnly &&
    !planModeOnly &&
    shouldIncludeTool(executeSandboxScriptTool, estimateContext, options);
  estimateContext.mcpToolsEnabled = mcpInSandboxEnabled;
  estimateContext.mcpToolDefs = mcpToolDefs;
  estimateContext.isMcpToolSearchAvailable =
    mcpInSandboxEnabled &&
    !!readSettings().enableMcpToolSearch &&
    estimateMcpInlineTokens(mcpToolDefs) > getMcpInlineTokenThreshold();

  let declarations = await Promise.all(
    TOOL_DEFINITIONS.filter((definition) =>
      shouldIncludeTool(definition, estimateContext, options),
    ).map(async (definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      inputSchema: await asSchema(definition.inputSchema).jsonSchema,
    })),
  );

  let useMcpToolSearch = estimateContext.isMcpToolSearchAvailable;
  if (
    useMcpToolSearch &&
    !declarations.some((declaration) => declaration.name === "search_mcp_tools")
  ) {
    useMcpToolSearch = false;
    declarations = declarations.filter(
      (declaration) => declaration.name !== "get_mcp_tool_schema",
    );
  }
  const hasGetSchemaTool = declarations.some(
    (declaration) => declaration.name === "get_mcp_tool_schema",
  );
  const sandboxDeclaration = declarations.find(
    (declaration) => declaration.name === "execute_sandbox_script",
  );
  if (sandboxDeclaration) {
    sandboxDeclaration.description = await buildExecuteSandboxScriptDescription(
      mcpToolDefs,
      {
        useSearch: useMcpToolSearch,
        hasGetSchemaTool,
        includeWriteFile: !!estimateContext.sandboxWriteFileHostEnabled,
      },
    );
  }

  if (
    toolProfile !== "build" &&
    !readOnly &&
    !planModeOnly &&
    !mcpInSandboxEnabled
  ) {
    const uniqueMcpTools = new Map(
      mcpToolDefs.map((definition) => [definition.toolKey, definition]),
    );
    declarations.push(
      ...[...uniqueMcpTools.values()].map((definition) => ({
        type: "function" as const,
        name: definition.toolKey,
        description: definition.description ?? "",
        inputSchema: definition.inputSchema,
      })),
    );
  }

  return estimateTokens(JSON.stringify(declarations));
}

export function estimateBuildModeToolTokens(
  options: Omit<Parameters<typeof estimateAgentToolTokens>[0], "toolProfile">,
): Promise<number> {
  return estimateAgentToolTokens({ ...options, toolProfile: "build" });
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

function toolAllowedInReadOnlyModes(
  tool: (typeof TOOL_DEFINITIONS)[number],
  ctx: AgentContext,
): boolean {
  if (typeof tool.allowInReadOnlyModes === "function") {
    return tool.allowInReadOnlyModes(ctx);
  }
  return tool.allowInReadOnlyModes === true;
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
  if (
    options.toolProfile === "build" &&
    !BUILD_MODE_TOOL_NAME_SET.has(tool.name)
  ) {
    return false;
  }
  // In plan mode, skip state-modifying tools unless they're planning-specific.
  if (
    options.planModeOnly &&
    toolModifiesState(tool, ctx) &&
    !toolAllowedInReadOnlyModes(tool, ctx) &&
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
  if (
    options.readOnly &&
    toolModifiesState(tool, ctx) &&
    !toolAllowedInReadOnlyModes(tool, ctx)
  ) {
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
      execute: async (
        args: any,
        executionOptions?: { toolCallId?: string },
      ) => {
        const toolCallId = executionOptions?.toolCallId;
        let presentationXml = "";
        const invocationCtx =
          toolCallId && ctx.onToolActivity
            ? {
                ...ctx,
                onXmlStream: (xml: string) => {
                  presentationXml = xml;
                  recordStreamingToolActivity(ctx, {
                    toolCallId,
                    toolName: tool.name,
                    status: "pending",
                    presentationXml: xml,
                  });
                },
                onXmlComplete: (xml: string) => {
                  presentationXml = xml;
                  recordStreamingToolActivity(ctx, {
                    toolCallId,
                    toolName: tool.name,
                    status: "pending",
                    presentationXml: xml,
                  });
                },
              }
            : ctx;
        try {
          const mutationRequiresTracking =
            toolModifiesState(tool, ctx) &&
            (tool.mutationTracking ?? "automatic") === "automatic";
          const processedArgs = await processArgPlaceholders(
            args,
            invocationCtx,
          );

          if (toolCallId && invocationCtx.onToolActivity) {
            presentationXml = tool.buildXml?.(processedArgs, false) ?? "";
            await invocationCtx.onToolActivity({
              toolCallId,
              toolName: tool.name,
              status: "pending",
              presentationXml,
              inputJson: processedArgs,
            });
          }

          // Reject tools that cannot pass the blueprint gate before asking
          // the user for consent. Consent may wait indefinitely, but this
          // precondition is synchronous and independent of mutation admission.
          if (
            toolModifiesState(tool, ctx) &&
            tool.requiresBlueprintApproval !== false &&
            !APP_BLUEPRINT_TOOLS.has(tool.name) &&
            !PLANNING_SPECIFIC_TOOLS.has(tool.name) &&
            !CAPABILITY_GATED_BLUEPRINT_TOOLS.has(tool.name)
          ) {
            assertAppBlueprintApproved({
              toolName: tool.name,
              chatId: invocationCtx.chatId,
              enabled: options.enableAppBlueprint !== false,
            });
          }

          // Consent can wait indefinitely for the user. Resolve it before
          // registering mutation activity so cancellation cannot let delayed
          // consent enter a closed actor generation.
          await requireToolConsentOrThrow(tool, processedArgs, invocationCtx);
          const invoke = async () => {
            if (invocationCtx.abortSignal?.aborted) {
              throw new DyadError(
                "This agent run was cancelled.",
                DyadErrorKind.UserCancelled,
              );
            }
            // Track file edit tool usage before execution to capture all attempts
            // (including failures) for retry/fallback telemetry
            trackFileEditTool(invocationCtx, tool.name, processedArgs);
            const result = await tool.execute(processedArgs, invocationCtx);

            // Only completed mutations unblock run_tests. Failed tool calls are
            // still present in fileEditTracker for retry/fallback telemetry, but
            // must not masquerade as a code change.
            const didMutate = shouldTrackToolMutation(
              tool,
              processedArgs,
              result,
              invocationCtx,
            );
            trackAppMutation(
              invocationCtx,
              tool.name,
              didMutate,
              didMutate &&
                (await shouldTrackToolFileMutation(
                  tool,
                  processedArgs,
                  result,
                  invocationCtx,
                )),
            );

            if (toolCallId && invocationCtx.onToolActivity) {
              await invocationCtx.onToolActivity({
                toolCallId,
                toolName: tool.name,
                status: "completed",
                presentationXml,
                inputJson: processedArgs,
                outputText: serializeActivityOutput(result),
              });
            }

            return convertToolResultForAiSdk(result);
          };

          return mutationRequiresTracking
            ? await withTrackedMutation(invocationCtx, invoke)
            : await invoke();
        } catch (error) {
          const errorMessage = getToolErrorSummary(error);
          const errorDetails = getToolErrorDisplayDetails(error);

          const errorXml = `<dyad-output type="error" message="Tool '${tool.name}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorDetails)}</dyad-output>`;
          invocationCtx.onXmlComplete(errorXml);
          if (toolCallId && invocationCtx.onToolActivity) {
            await invocationCtx.onToolActivity({
              toolCallId,
              toolName: tool.name,
              status: invocationCtx.abortSignal?.aborted ? "aborted" : "error",
              presentationXml: errorXml,
              inputJson:
                typeof args === "object" && args !== null ? args : undefined,
              error: errorDetails,
            });
          }
          throw error;
        }
      },
    };
  }

  return toolSet;
}
