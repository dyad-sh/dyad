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

// ============================================================================
// XML Escape Helpers
// ============================================================================

export {
  escapeXmlAttr,
  unescapeXmlAttr,
  escapeXmlContent,
  unescapeXmlContent,
} from "../../../../../shared/xmlEscape";

// ============================================================================
// Todo Types
// ============================================================================

// Tool-local alias used by the migrated Dyad tools.
export type Todo = AgentTodo;

/** Tracks which file-editing tools were used on each file path */
export const FILE_EDIT_TOOL_NAMES = ["write_file"] as const;
export type FileEditToolName = (typeof FILE_EDIT_TOOL_NAMES)[number];
export interface FileEditTracker {
  [filePath: string]: {
    write_file: number;
  };
}

/**
 * Tools beyond write_file whose invocation still changes the
 * app or its data, so a `run_tests` rerun after one of them is meaningful.
 * Feeds `AgentContext.mutationCount` after successful execution (including
 * indirect workspace mutations).
 * Turn-scoped bookkeeping tools (update_todos, plan/blueprint tools) and
 * run_tests itself are deliberately excluded — they can't change a test's
 * outcome.
 */
export const APP_MUTATING_TOOL_NAMES = [
  "copy_file",
  "delete_file",
  "rename_file",
  "add_dependency",
  "bash",
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
  planAcceptInNewChat?: boolean;
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
  /** Correlation ID for this model request. */
  dyadRequestId: string;
  /** Effective per-tool consent values captured when this turn was accepted. */
  toolConsents: Readonly<Record<string, AgentToolConsent>>;
  /** SQL auto-approval policy captured with the rest of the turn settings. */
  autoApproveNonSchemaSql: boolean;
  /** Tracks file edit tool usage per file for telemetry */
  fileEditTracker: FileEditTracker;
  /** True after a tool has successfully changed workspace contents this turn. */
  workspaceMutated?: boolean;
  /**
   * Turn-scoped count of successfully completed tool invocations that change
   * the app or its data: file edits
   * plus the tools in `APP_MUTATING_TOOL_NAMES`. This is the
   * signal for `run_tests`' require-a-change guards, which must see fixes made
   * through any mutating tool, not just write_file.
   */
  mutationCount?: number;
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
   * Whether the app-blueprint approval flow gates state-modifying work this
   * turn (settings.enableAppBlueprint && app.needsAppBlueprint), mirroring
   * the tool-set selection options. Undefined is treated as
   * enabled so non-handler callers fail closed.
   */
  enableAppBlueprint?: boolean;
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
  /** Whether rebuild_app is registered in this turn's effective tool set. */
  rebuildAppToolAvailable?: boolean;
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
  readonly defaultConsent: AgentToolConsent;
  /**
   * If true, this tool modifies state (files, database, etc.).
   * Used to filter out state-modifying tools in read-only mode (e.g., ask mode).
   * Wrapper tools may use a predicate when their writable capability is
   * conditionally exposed by the current turn context.
   */
  readonly modifiesState?: boolean | ((ctx: AgentContext) => boolean);
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

export function toolModifiesState(
  tool: ToolDefinition,
  ctx: AgentContext,
): boolean {
  return typeof tool.modifiesState === "function"
    ? tool.modifiesState(ctx)
    : tool.modifiesState === true;
}
