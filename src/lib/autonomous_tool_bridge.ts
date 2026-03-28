/**
 * Bridge between the Autonomous Agent system and Local Agent tools.
 *
 * Wraps Local Agent tool definitions so the autonomous agent can call
 * write_file, run_command, verify_app, run_tests, etc. instead of
 * ad-hoc fs/exec implementations.
 */

import type { ActionResult } from "./autonomous_agent";
import {
  TOOL_DEFINITIONS,
  type AgentToolName,
} from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";

// ============================================================================
// Types
// ============================================================================

/** Mapping from autonomous agent action types to local agent tool names */
const ACTION_TO_TOOL: Record<string, AgentToolName> = {
  write_file: "write_file" as AgentToolName,
  read_file: "read_file" as AgentToolName,
  run_command: "run_command" as AgentToolName,
  generate_code: "write_file" as AgentToolName, // code gen writes files
  generate_component: "write_file" as AgentToolName,
  generate_style: "write_file" as AgentToolName,
  search_web: "web_scraper" as AgentToolName,
  scrape_webpage: "web_scraper" as AgentToolName,
};

/** Subset of AgentContext fields needed for autonomous bridge */
export interface BridgeConfig {
  /** App directory to operate in (replaces autonomous agent's codeDir) */
  appPath: string;
  /** Callback for streaming XML to the autonomous agent's event system */
  onOutput?: (xml: string) => void;
}

// ============================================================================
// Synthetic AgentContext
// ============================================================================

/**
 * Build a minimal AgentContext for autonomous tool execution.
 * Autonomous agents run in the main process without a renderer event,
 * so we stub event/consent and route output through the bridge config.
 */
function createSyntheticContext(config: BridgeConfig): AgentContext {
  return {
    // Stub event — autonomous agent has no IpcMainInvokeEvent.
    // Tools that truly need sender (only consent-related code) are bypassed below.
    event: null as any,
    appPath: config.appPath,
    chatId: -1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    messageId: -1,
    isSharedModulesChanged: false,
    onXmlStream: (xml: string) => config.onOutput?.(xml),
    onXmlComplete: (xml: string) => config.onOutput?.(xml),
    // Auto-approve within mission scope
    requireConsent: async () => true,
  };
}

// ============================================================================
// Param Adapters
// ============================================================================

/**
 * Transform autonomous-agent action params into local-agent tool args.
 * Each action type may name its params differently from the local tool schema.
 */
function adaptParams(
  actionType: string,
  params: Record<string, unknown>,
  appPath: string,
): Record<string, unknown> {
  switch (actionType) {
    case "write_file":
    case "generate_code":
    case "generate_component":
    case "generate_style": {
      const filePath = (params.path as string) || (params.filePath as string) || "output.tsx";
      return {
        filePath,
        content: (params.content as string) || (params.code as string) || "",
      };
    }

    case "read_file": {
      const filePath = (params.path as string) || (params.filePath as string) || "";
      return { filePath };
    }

    case "run_command": {
      return {
        command: (params.command as string) || "",
      };
    }

    case "search_web":
    case "scrape_webpage": {
      return {
        url: (params.url as string) || (params.query as string) || "",
        selector: (params.selector as string) || undefined,
      };
    }

    default:
      return params;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute a local agent tool on behalf of the autonomous agent.
 *
 * @returns ActionResult compatible with AutonomousAgentSystem.executeAction
 */
export async function executeViaBridge(
  actionType: string,
  params: Record<string, unknown>,
  config: BridgeConfig,
): Promise<ActionResult> {
  const toolName = ACTION_TO_TOOL[actionType];
  if (!toolName) {
    return { success: false, error: `No tool bridge for action: ${actionType}` };
  }

  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  if (!tool) {
    return { success: false, error: `Tool not found: ${toolName}` };
  }

  const ctx = createSyntheticContext(config);
  const adaptedArgs = adaptParams(actionType, params, config.appPath);

  try {
    const output = await tool.execute(adaptedArgs, ctx);
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check whether an action type has a local-agent tool equivalent.
 */
export function hasBridgedTool(actionType: string): boolean {
  return actionType in ACTION_TO_TOOL;
}

/**
 * Run the verify_app tool for an autonomous mission's target app.
 */
export async function verifyApp(appPath: string): Promise<ActionResult> {
  return executeViaBridge("verify_app_direct", {}, { appPath });
}

// Direct tool helpers (bypass the action-type mapping)

export async function runVerifyApp(config: BridgeConfig): Promise<string> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === "verify_app");
  if (!tool) throw new Error("verify_app tool not found");
  const ctx = createSyntheticContext(config);
  return tool.execute({}, ctx);
}

export async function runTests(config: BridgeConfig): Promise<string> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === "run_tests");
  if (!tool) throw new Error("run_tests tool not found");
  const ctx = createSyntheticContext(config);
  return tool.execute({}, ctx);
}
