/**
 * Shared types and utilities for Local Agent tools
 */

import { z } from "zod";
import { IpcMainInvokeEvent } from "electron";
import { jsonrepair } from "jsonrepair";
import { AgentToolConsent } from "@/lib/schemas";
import { AgentTodo } from "@/ipc/types";
import type { AppFrameworkType } from "@/lib/framework_constants";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import type { McpToolDef } from "./mcp_type_defs";

// ============================================================================
// XML Escape Helpers
// ============================================================================

export {
  escapeXmlAttr,
  unescapeXmlAttr,
  escapeXmlContent,
  unescapeXmlContent,
} from "../../../../../../../shared/xmlEscape";

// ============================================================================
// Todo Types
// ============================================================================

// Re-export AgentTodo as Todo for backwards compatibility within this module
export type Todo = AgentTodo;

/** Tracks which file-editing tools were used on each file path */
export const FILE_EDIT_TOOL_NAMES = ["write_file", "search_replace"] as const;
export type FileEditToolName = (typeof FILE_EDIT_TOOL_NAMES)[number];
export interface FileEditTracker {
  [filePath: string]: {
    write_file: number;
    search_replace: number;
  };
}

/**
 * Tools beyond write_file/search_replace whose invocation still changes the
 * app or its data, so a `run_tests` rerun after one of them is meaningful.
 * Feeds `AgentContext.mutationCount` after successful execution (including
 * sandbox write_file host calls).
 * Turn-scoped bookkeeping tools (update_todos, plan/blueprint tools) and
 * run_tests itself are deliberately excluded — they can't change a test's
 * outcome.
 */
export const APP_MUTATING_TOOL_NAMES = [
  "copy_file",
  "delete_file",
  "rename_file",
  "add_dependency",
  "execute_sql",
  "add_integration",
  "enable_nitro",
  "generate_image",
] as const;

export interface AgentContext {
  event: IpcMainInvokeEvent;
  appId: number;
  appPath: string;
  /**
   * Apps referenced via `@app:Name` in the current turn. Read-only tools
   * can target these via an `app_name` parameter; write tools cannot reach them.
   * Keyed by lowercased app name so lookups are case-insensitive (matching
   * the mention-extraction pipeline in `mention_apps.ts`). Value is the
   * absolute app path.
   */
  referencedApps: Map<string, string>;
  chatId: number;
  supabaseProjectId: string | null;
  supabaseOrganizationSlug: string | null;
  neonProjectId: string | null;
  neonActiveBranchId: string | null;
  frameworkType: AppFrameworkType | null;
  messageId: number;
  isSharedModulesChanged: boolean;
  /** Turn-scoped _shared paths changed under supabase/functions/_shared. */
  sharedServerModulePaths: string[];
  /** Function deploys skipped because a shared module had already changed. */
  pendingFunctionDeploys: string[];
  chatSummary?: string;
  /** Turn-scoped todo list for agent task tracking */
  todos: Todo[];
  /** Request ID for tracking requests to the Dyad engine */
  dyadRequestId: string;
  /** Tracks file edit tool usage per file for telemetry */
  fileEditTracker: FileEditTracker;
  /** True after a tool has successfully changed workspace contents this turn. */
  workspaceMutated?: boolean;
  /**
   * Turn-scoped count of successfully completed tool invocations that change
   * the app or its data: file edits (including sandbox write_file host calls)
   * plus the tools in `APP_MUTATING_TOOL_NAMES`. This is the
   * signal for `run_tests`' require-a-change guards, which must see fixes made
   * through ANY mutating tool — not just write_file/search_replace.
   */
  mutationCount?: number;
  /**
   * If true, the user has Dyad Pro enabled.
   * Engine-dependent tools require this to access the Dyad Pro API.
   */
  isDyadPro: boolean;
  /** The durable child thread currently executing this tool, if any. */
  subagentThreadId?: string;
  /** Persona for a child tool invocation. Root turns leave this undefined. */
  subagentPersona?: "explorer" | "reviewer" | "implementer";
  /** Explicit relative path prefixes an Implementer may mutate. */
  subagentPathScope?: string[];
  /** Child threads spawned by this root turn, joined before deploy/commit. */
  spawnedSubagentThreadIds?: string[];
  /** Implementer children that must finish before root deploy/commit. */
  spawnedImplementerThreadIds?: string[];
  /**
   * Whether file tools may deploy server functions immediately. Implementer
   * children disable this so deployment stays owned by the root turn.
   */
  allowDeploySideEffects?: boolean;
  /** Propagates child shared-module edits to the root turn's deploy tracker. */
  onSharedServerModuleChange?: (relativePath: string) => void;
  /** Propagates child function deploy work to the root turn. */
  onDeferredFunctionDeploy?: (functionName: string) => void;
  /** Turn-scoped schema gates for root orchestration tools. */
  canUseExplorerSubagent?: boolean;
  canUseImplementerSubagent?: boolean;
  /**
   * If true, this turn is using a Dyad Free model. Some Pro-enabled
   * conveniences, such as MCP auto-approval, should stay disabled.
   */
  freeModelMode?: boolean;
  /**
   * Streams accumulated XML to UI without persisting to DB (for live preview).
   * Call this repeatedly with the full accumulated XML so far.
   */
  onXmlStream: (accumulatedXml: string) => void;
  /**
   * Writes final XML to UI and persists to DB.
   * Call this once when the tool's XML output is complete.
   */
  onXmlComplete: (finalXml: string) => void;
  requireConsent: (params: {
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
    metadata?: SqlConsentMetadata | null;
  }) => Promise<boolean>;
  /**
   * Append a user message to be sent after the tool result.
   * Use this when the tool needs to provide non-text content (like images)
   * that models don't support in tool result messages.
   */
  appendUserMessage: (content: UserMessageContentPart[]) => void;
  /**
   * Sends updated todos to the renderer for UI display.
   * Call this when todos are updated to show them in the chat input area.
   */
  onUpdateTodos: (todos: Todo[]) => void;
  /**
   * Queues a warning toast to be shown to the user when the turn completes.
   */
  onWarningMessage?: (message: string) => void;
  /**
   * Marks that the current turn actually accessed an attachment path.
   */
  onAttachmentAccess?: () => void;
  /**
   * Stream-scoped abort signal. Tools that block on user-driven async work
   * (e.g. waiting for an integration response) should race their wait against
   * this signal so they don't keep the stream alive after a cancel.
   */
  abortSignal?: AbortSignal;
  /**
   * Whether MCP tools should be exposed as host functions inside the
   * `execute_sandbox_script` sandbox this turn. Set by the local-agent
   * handler based on read-only / plan-mode status and effective
   * sandbox-tool availability. When false or undefined, `execute_sandbox_script`
   * skips MCP capability injection — preventing sandboxed scripts from
   * calling MCP tools in modes where MCP is intentionally not exposed.
   */
  mcpToolsEnabled?: boolean;
  /**
   * MCP tool definitions for the current turn, populated by the local-agent
   * handler. The handler uses these to build the dynamic
   * `execute_sandbox_script` description and the sandbox `execute()` path
   * uses the same array to build the capability map — so the prompt and
   * the runtime surface are guaranteed to agree.
   */
  mcpToolDefs?: McpToolDef[];
  /**
   * Whether this turn may expose the built-in write_file host function inside
   * `execute_sandbox_script`. Keep prompt text, tool filtering, and runtime
   * capability injection aligned to this same turn-scoped value.
   */
  sandboxWriteFileHostEnabled?: boolean;
  /**
   * Whether the app-blueprint approval flow gates state-modifying work this
   * turn (settings.enableAppBlueprint && app.needsAppBlueprint), mirroring
   * BuildAgentToolSetOptions.enableAppBlueprint. Consumed by capability-layer
   * gates such as the sandbox write_file host function; undefined is treated
   * as enabled so non-handler callers fail closed.
   */
  enableAppBlueprint?: boolean;
  /**
   * Whether MCP tool search may be used this turn. Gates registration of the
   * search_mcp_tools and get_mcp_tool_schema tools. The handler sets this to
   * true if both of the following are true:
   * 1) the tool search setting is on, and
   * 2) inlining every tool declaration would exceed the size threshold.
   * When false, the sandbox inlines every tool declaration instead.
   */
  isMcpToolSearchAvailable?: boolean;
  /**
   * Whether the app has opted into E2E testing (apps.testingEnabled). Gates the
   * `run_tests` tool, mirroring how `testingEnabled` gates the test-writing
   * guidance in the system prompt.
   */
  testingEnabled: boolean;
  /**
   * Turn-scoped `run_tests` attempt tracking, keyed by normalized spec path.
   * Created fresh per turn like `fileEditTracker`, so the 4-attempt fix cap
   * resets each turn.
   */
  testRunAttempts: Map<string, TestRunAttemptState>;
  /**
   * Actual Playwright runs started by `run_tests` during this turn, across all
   * specs. Preflight/dev-server refusals do not increment this.
   */
  testRunCount?: number;
}

/** Per-spec fix-loop state for the `run_tests` tool, tracked across one turn. */
export interface TestRunAttemptState {
  /** Failed runs counted toward the per-spec cap (infra/flake runs excluded). */
  attempts: number;
  /** Normalized failure signature of the last failing run, for no-progress detection. */
  lastFailureSignature?: string;
  /** `AgentContext.mutationCount` at the last run, for the require-a-change guard. */
  fileEditCountAtLastRun?: number;
  /**
   * Canonical key for the tests targeted by the last run. Changing what's
   * targeted is itself a meaningful change, so the require-a-change guard
   * doesn't block e.g. widening from a subset to the whole file after a fix.
   */
  lastRunTargetKey?: string;
  /** Whether the one free `flakeCheck` rerun has been used for this spec. */
  flakeCheckUsed?: boolean;
  /**
   * `AgentContext.mutationCount` at the time each target last PASSED, keyed by
   * canonical target ("" = whole file). Rerunning a target that already passed
   * with no file changes since is refused — some models otherwise loop
   * re-running already-green tests.
   */
  passedAtEditCount?: Record<string, number>;
}

// ============================================================================
// Partial JSON Parser
// ============================================================================

/**
 * Parse partial/streaming JSON into a partial object using jsonrepair.
 * Handles incomplete JSON gracefully during streaming.
 */
export function parsePartialJson<T extends Record<string, unknown>>(
  jsonText: string,
): Partial<T> {
  if (!jsonText.trim()) {
    return {} as Partial<T>;
  }

  try {
    const repaired = jsonrepair(jsonText);
    return JSON.parse(repaired) as Partial<T>;
  } catch {
    // If jsonrepair fails, return empty object
    return {} as Partial<T>;
  }
}

// ============================================================================
// Tool Result Types
// ============================================================================

/**
 * Content part types for user messages (supports images)
 * These can be appended as follow-up user messages after tool results
 */
export type UserMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image-url"; url: string };

/** Tool result text returned to the model. */
export type ToolResult = string;

// ============================================================================
// Tool Definition Interface
// ============================================================================

export interface ToolDefinition<T = any> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<T>;
  /** Build a turn-specific schema when capabilities change the valid input. */
  readonly getInputSchema?: (ctx: AgentContext) => z.ZodType<T>;
  readonly defaultConsent: AgentToolConsent;
  /**
   * If true, this tool modifies state (files, database, etc.).
   * Used to filter out state-modifying tools in read-only mode (e.g., ask mode).
   * Wrapper tools may use a predicate when their writable capability is
   * conditionally exposed by the current turn context.
   */
  readonly modifiesState?: boolean | ((ctx: AgentContext) => boolean);
  /** Sub-agent capability; hidden and runtime-rejected for non-Pro users. */
  readonly subagentOnly?: boolean;
  /**
   * Whether a state-modifying tool must own the app mutation lease. Set false
   * for orchestration controls whose state is durable metadata, not workspace
   * mutation; writable children acquire their own lease in the manager.
   */
  readonly requiresMutationLease?: boolean;
  /**
   * If true, this tool calls a Dyad Engine endpoint outside the main model
   * generation endpoint.
   */
  readonly usesEngineEndpoint?: boolean;
  execute: (args: T, ctx: AgentContext) => Promise<ToolResult>;

  /**
   * If defined, returns whether the tool should be available in the current context.
   * If it returns false, the tool will be filtered out.
   */
  isEnabled?: (ctx: AgentContext) => boolean;

  /**
   * Returns a preview string describing what the tool will do with the given args.
   * Used for consent prompts. If not provided, no inputPreview will be shown.
   *
   * @param args - The parsed args for the tool call
   * @returns A human-readable description of the operation
   */
  getConsentPreview?: (args: T) => string;

  /**
   * Returns structured metadata for consent prompts. Keep this small and
   * renderer-safe; it is sent over IPC.
   */
  getConsentMetadata?: (args: T) => SqlConsentMetadata | null | undefined;

  /**
   * For state-modifying tools, returns whether a successful execution actually
   * changed app state. Required for tools in APP_MUTATING_TOOL_NAMES so handled
   * failures and no-op results do not unblock run_tests. File-edit tools that
   * return successfully default to true.
   */
  shouldTrackMutation?: (
    args: T,
    result: ToolResult,
    ctx: AgentContext,
  ) => boolean;

  /**
   * Build XML from parsed partial args.
   * Called by the handler during streaming and on completion.
   *
   * @param args - Partial args parsed from accumulated JSON (type inferred from inputSchema)
   * @param isComplete - True if this is the final call (include closing tags)
   * @returns The XML string, or undefined if not enough args yet
   */
  buildXml?: (args: Partial<T>, isComplete: boolean) => string | undefined;
}
