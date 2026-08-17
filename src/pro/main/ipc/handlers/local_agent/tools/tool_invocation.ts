/**
 * Shared tool-invocation policy helpers used by both the AI-SDK tool set
 * wrapper (`buildAgentToolSet` in `tool_definitions.ts`) and the sandbox
 * host-function bridge in `execute_sandbox_script.ts`. They live in their
 * own module so the sandbox tool can reuse the exact same consent,
 * tracking, and blueprint gating without a circular import —
 * `tool_definitions.ts` imports every tool, including
 * `execute_sandbox_script.ts`.
 */

import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAppBlueprintForChat } from "@/ipc/handlers/app_blueprint_handlers";
import type { AgentToolConsent } from "@/lib/schemas";
import { gitIsIgnored } from "@/ipc/utils/git_utils";
import {
  AgentContext,
  APP_MUTATING_TOOL_NAMES,
  AppMutatingToolName,
  FILE_EDIT_TOOL_NAMES,
  FileEditToolName,
  ToolDefinition,
} from "./types";

const FILE_EDIT_TOOLS: Set<FileEditToolName> = new Set(FILE_EDIT_TOOL_NAMES);
const APP_MUTATING_TOOLS: Set<string> = new Set(APP_MUTATING_TOOL_NAMES);

type FileMutationPolicy = "always" | "never" | "path" | "tool";
type MutationToolName = FileEditToolName | AppMutatingToolName;

/**
 * Exhaustive Git-visible file-impact policy for every mutation-counted tool.
 * Adding a name to either mutation-tool tuple without classifying it here is a
 * type error, so pre-commit eligibility cannot silently drift from the tool
 * registry.
 */
export const FILE_MUTATION_POLICIES = {
  write_file: "path",
  search_replace: "path",
  copy_file: "tool",
  delete_file: "always",
  rename_file: "always",
  add_dependency: "always",
  execute_sql: "tool",
  add_integration: "tool",
  enable_nitro: "always",
  generate_image: "never",
  generate_test_assertions: "always",
  git_restore_file: "always",
} as const satisfies Record<MutationToolName, FileMutationPolicy>;

export async function isPathGitVisible(
  ctx: Pick<AgentContext, "appPath">,
  filePath: string,
): Promise<boolean> {
  try {
    // Unlike a standalone .gitignore matcher, `git check-ignore` consults the
    // index by default: a tracked path remains visible even if a later ignore
    // rule matches it.
    return !(await gitIsIgnored({ path: ctx.appPath, filepath: filePath }));
  } catch {
    // Failure to classify must not suppress verification of a real edit.
    return true;
  }
}

export async function shouldTrackToolFileMutation<T>(
  tool: ToolDefinition<T>,
  args: T,
  result: string,
  ctx: AgentContext,
): Promise<boolean> {
  const policy =
    FILE_MUTATION_POLICIES[tool.name as MutationToolName] ?? "never";
  switch (policy) {
    case "always":
      return true;
    case "never":
      return false;
    case "path": {
      const pathArgs = args as { file_path?: string; path?: string };
      const filePath = pathArgs.file_path ?? pathArgs.path;
      return filePath ? isPathGitVisible(ctx, filePath) : false;
    }
    case "tool":
      return (await tool.shouldTrackFileMutation?.(args, result, ctx)) ?? false;
  }
}

/**
 * Track file edit tool usage for retry/fallback telemetry. This intentionally
 * records attempts before execution, including failures; successful mutation
 * counting is separate in `trackAppMutation`.
 */
export function trackFileEditTool(
  ctx: AgentContext,
  toolName: string,
  args: { file_path?: string; path?: string },
): void {
  if (!FILE_EDIT_TOOLS.has(toolName as FileEditToolName)) {
    return;
  }
  const filePath = args.file_path ?? args.path;
  if (!filePath) {
    return;
  }
  if (!ctx.fileEditTracker[filePath]) {
    ctx.fileEditTracker[filePath] = {
      write_file: 0,
      search_replace: 0,
    };
  }
  ctx.fileEditTracker[filePath][toolName as FileEditToolName]++;
}

/**
 * Count a successfully completed tool that changes the app or its data. File
 * edits and other app-mutating tools both feed this signal so `run_tests` only
 * accepts a rerun after a mutation actually completed.
 */
export function trackAppMutation(
  ctx: AgentContext,
  toolName: string,
  didMutate = true,
  didMutateFile = false,
): void {
  if (!didMutate) {
    return;
  }
  if (
    !FILE_EDIT_TOOLS.has(toolName as FileEditToolName) &&
    !APP_MUTATING_TOOLS.has(toolName)
  ) {
    return;
  }
  ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
  if (didMutateFile) {
    ctx.fileMutationCount = (ctx.fileMutationCount ?? 0) + 1;
  }
  ctx.onWorkspaceMutation?.(didMutateFile);
}

/**
 * Decide whether a completed tool result represents an app mutation. Tools in
 * APP_MUTATING_TOOL_NAMES must opt in with a result-aware predicate so a
 * handled failure/no-op string cannot accidentally unblock run_tests. The two
 * file-edit tools keep their historical success-after-return default; errors
 * from them throw before this function runs.
 */
export function shouldTrackToolMutation<T>(
  tool: ToolDefinition<T>,
  args: T,
  result: string,
  ctx: AgentContext,
): boolean {
  if (tool.shouldTrackMutation) {
    return tool.shouldTrackMutation(args, result, ctx);
  }
  return !APP_MUTATING_TOOLS.has(tool.name);
}

/**
 * Effective consent for a tool: the stored per-tool setting, falling back to
 * the tool's declared default. Matches `getAgentToolConsent` in
 * `tool_definitions.ts`, but takes the tool object so it stays usable from
 * modules that `tool_definitions.ts` itself imports.
 */
export function getToolConsent(tool: ToolDefinition): AgentToolConsent {
  return readSettings().agentToolConsents?.[tool.name] ?? tool.defaultConsent;
}

/**
 * Ask the user for consent to run a tool and throw UserCancelled on denial.
 */
export async function requireToolConsentOrThrow<T>(
  tool: ToolDefinition<T>,
  args: T,
  ctx: AgentContext,
): Promise<void> {
  const allowed = await ctx.requireConsent({
    toolName: tool.name,
    toolDescription: tool.description,
    inputPreview: tool.getConsentPreview?.(args) ?? null,
    metadata: tool.getConsentMetadata?.(args) ?? null,
  });
  if (!allowed) {
    throw new DyadError(
      `User denied permission for ${tool.name}`,
      DyadErrorKind.UserCancelled,
    );
  }
}

/**
 * App-blueprint precondition shared by the tool-set wrapper and
 * capability-layer gates (e.g. the sandbox write_file host function):
 * state-modifying work must wait until the blueprint is created and
 * approved. No-op when the blueprint flow is disabled for the turn.
 */
export function assertAppBlueprintApproved(params: {
  toolName: string;
  chatId: number;
  enabled: boolean;
}): void {
  if (!params.enabled) {
    return;
  }
  const plan = getAppBlueprintForChat(params.chatId);
  if (!plan) {
    throw new DyadError(
      `App blueprint must be created and approved before running ${params.toolName}. Call write_app_blueprint first to present the blueprint for approval.`,
      DyadErrorKind.Precondition,
    );
  }
  if (!plan.approved) {
    throw new DyadError(
      `App blueprint must be approved before running ${params.toolName}. Call write_app_blueprint to present the blueprint for approval.`,
      DyadErrorKind.Precondition,
    );
  }
}
