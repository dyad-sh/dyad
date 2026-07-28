/** Dyad tool definitions exposed through the pi agent pipeline. */

import { readSettings, writeSettings } from "@/main/settings";
import type { AgentToolConsent, UserSettings } from "@/lib/schemas";
import {
  toolModifiesState,
  type AgentContext,
  type ToolDefinition,
} from "./types";

import { addDependencyTool } from "./add_dependency";
import { addIntegrationTool } from "./add_integration";
import { rebuildAppTool, restartAppTool } from "./app_lifecycle";
import { bashTool } from "./bash";
import { copyFileTool } from "./copy_file";
import { deleteFileTool } from "./delete_file";
import { enableNitroTool } from "./enable_nitro";
import { executeSqlTool } from "./execute_sql";
import { exitPlanTool } from "./exit_plan";
import { generateImageTool } from "./generate_image";
import { getDatabaseTableSchemaTool } from "./get_database_table_schema";
import { getNeonProjectInfoTool } from "./get_neon_project_info";
import { getSupabaseProjectInfoTool } from "./get_supabase_project_info";
import {
  gitDiffTool,
  gitLogTool,
  gitRestoreFileTool,
  gitShowCommitTool,
  gitShowFileTool,
  gitStatusTool,
} from "./git";
import { grepTool } from "./grep";
import { listFilesTool } from "./list_files";
import { planningQuestionnaireTool } from "./planning_questionnaire";
import { readChatTool } from "./read_chat";
import { readFileTool } from "./read_file";
import { readGuideTool } from "./read_guide";
import { readLogsTool } from "./read_logs";
import { renameFileTool } from "./rename_file";
import { runTestsTool } from "./run_tests";
import { runTypeChecksTool } from "./run_type_checks";
import { searchChatsTool } from "./search_chats";
import { setChatSummaryTool } from "./set_chat_summary";
import { updateTodosTool } from "./update_todos";
import { writeAppBlueprintTool } from "./write_app_blueprint";
import { writeFileTool } from "./write_file";
import { writePlanTool } from "./write_plan";
import { fetchContentTool, webSearchTool } from "./web_access";

/** Tool definitions available through the pi pipeline. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  writeFileTool,
  copyFileTool,
  deleteFileTool,
  renameFileTool,
  addDependencyTool,
  bashTool,
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
  webSearchTool,
  fetchContentTool,
  searchChatsTool,
  readChatTool,
  getSupabaseProjectInfoTool,
  getNeonProjectInfoTool,
  getDatabaseTableSchemaTool,
  setChatSummaryTool,
  addIntegrationTool,
  enableNitroTool,
  readLogsTool,
  generateImageTool,
  updateTodosTool,
  runTypeChecksTool,
  runTestsTool,
  restartAppTool,
  rebuildAppTool,
  readGuideTool,
  // Plan mode tools
  planningQuestionnaireTool,
  writePlanTool,
  exitPlanTool,
  // App blueprint tools
  writeAppBlueprintTool,
];

export type AgentToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export interface BuildAgentToolSetOptions {
  /** Exclude tools that modify state (files, database, etc.). */
  readOnly?: boolean;
  /** Only include tools allowed in plan mode (read-only + planning-specific). */
  planModeOnly?: boolean;
  /** If false, exclude app blueprint tools (write_app_blueprint). */
  enableAppBlueprint?: boolean;
}

/** Tools that should ONLY be available in plan mode. */
const PLAN_MODE_ONLY_TOOLS = new Set(["write_plan", "exit_plan"]);

/** Planning-specific tools allowed in plan mode despite modifying state. */
const PLANNING_SPECIFIC_TOOLS = new Set([
  ...PLAN_MODE_ONLY_TOOLS,
  "planning_questionnaire",
]);

/** Tools that are part of the app blueprint flow. */
const APP_BLUEPRINT_TOOLS = new Set<string>(["write_app_blueprint"]);
const PER_INVOCATION_CONSENT_TOOLS = new Set<string>(["bash"]);

export function getDefaultConsent(toolName: string): AgentToolConsent {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  return tool?.defaultConsent ?? "ask";
}

export function getAgentToolConsent(toolName: string): AgentToolConsent {
  const settings = readSettings();
  return resolveAgentToolConsents(settings)[toolName] ?? "ask";
}

export function setAgentToolConsent(
  toolName: AgentToolName,
  consent: AgentToolConsent,
): void {
  const settings = readSettings();
  writeSettings({
    agentToolConsents: {
      ...settings.agentToolConsents,
      [toolName]:
        PER_INVOCATION_CONSENT_TOOLS.has(toolName) && consent === "always"
          ? "ask"
          : consent,
    },
  });
}

export function getAllAgentToolConsents(): Record<string, AgentToolConsent> {
  return resolveAgentToolConsents(readSettings());
}

/** Resolve immutable effective consent values for one accepted turn. */
export function resolveAgentToolConsents(
  settings: Pick<UserSettings, "agentToolConsents" | "autoApproveChanges">,
): Record<string, AgentToolConsent> {
  const stored = settings.agentToolConsents ?? {};
  const result: Record<string, AgentToolConsent> = {};
  for (const tool of TOOL_DEFINITIONS) {
    if (PER_INVOCATION_CONSENT_TOOLS.has(tool.name)) {
      result[tool.name] = stored[tool.name] === "never" ? "never" : "ask";
      continue;
    }
    result[tool.name] =
      stored[tool.name] ??
      (settings.autoApproveChanges === true
        ? "always"
        : getDefaultConsent(tool.name));
  }
  return result;
}

/** Whether a tool belongs in this turn's tool set. */
export function shouldIncludeTool(
  tool: ToolDefinition,
  ctx: AgentContext,
  options: BuildAgentToolSetOptions = {},
): boolean {
  if ((ctx.toolConsents[tool.name] ?? tool.defaultConsent) === "never") {
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
    if (!tool.isEnabled(ctx)) {
      return false;
    }
  }
  return true;
}
