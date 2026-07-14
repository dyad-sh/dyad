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
import {
  AgentContext,
  APP_MUTATING_TOOL_NAMES,
  FILE_EDIT_TOOL_NAMES,
  FileEditToolName,
  ToolDefinition,
} from "./types";

const FILE_EDIT_TOOLS: Set<FileEditToolName> = new Set(FILE_EDIT_TOOL_NAMES);
const APP_MUTATING_TOOLS: Set<string> = new Set(APP_MUTATING_TOOL_NAMES);

/**
 * Track file edit tool usage for telemetry and for the mutation count that
 * feeds `run_tests`' require-a-change guards. Also called by the sandbox
 * write_file host bridge, so sandbox-script writes count as changes too.
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
  ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
}

/**
 * Count non-file-edit tools that still change the app or its data
 * (delete/rename/copy, dependency installs, SQL, integrations, image
 * generation), so a `run_tests` rerun after one of them isn't refused as
 * "you haven't made any changes". File-edit tools are counted inside
 * `trackFileEditTool`.
 */
export function trackAppMutation(ctx: AgentContext, toolName: string): void {
  if (!APP_MUTATING_TOOLS.has(toolName)) {
    return;
  }
  ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
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
