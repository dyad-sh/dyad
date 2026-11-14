import path from "node:path";
import { z } from "zod";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "@/user_input/main";
import type { CliControlRequest } from "../runtime";
import type { NativeMutationTracker } from "./mutation_tracker";
import { NATIVE_FILE_EDIT_TOOLS } from "./tool_policy";

/** Hook callback ids Dyad registers in `initialize`. */
export const NATIVE_HOOK_IDS = {
  PreToolUse: ["dyad-pre-tool"],
  PostToolUse: ["dyad-post-tool"],
} as const;

const CanUseToolSchema = z.object({
  subtype: z.literal("can_use_tool"),
  tool_name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  decision_reason: z.string().optional(),
  blocked_path: z.string().optional(),
});

const HookCallbackSchema = z.object({
  subtype: z.literal("hook_callback"),
  callback_id: z.string(),
  input: z
    .object({
      hook_event_name: z.string().optional(),
      tool_name: z.string().optional(),
      tool_input: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .default({}),
});

const MAX_PREVIEW_CHARS = 4_000;

function preview(toolName: string, input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : "";
  const file =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.notebook_path === "string"
        ? input.notebook_path
        : "";
  const body = command || file || JSON.stringify(input, null, 2);
  const description =
    typeof input.description === "string" ? `\n\n${input.description}` : "";
  return `${toolName}: ${body}${description}`.slice(0, MAX_PREVIEW_CHARS);
}

/**
 * Whether `filePath` is inside another Dyad app (a sibling under the Dyad
 * apps folder). Claude Code may edit anything the user can, but silently
 * editing a different Dyad app would corrupt that app's own history.
 */
export function isOtherDyadAppPath(
  filePath: string,
  appPath: string,
  appsRoot: string | undefined,
): boolean {
  if (!appsRoot) return false;
  const app = path.resolve(appPath);
  const resolved = path.resolve(app, filePath);
  const inApps = path.relative(path.resolve(appsRoot), resolved);
  if (inApps.startsWith("..") || path.isAbsolute(inApps)) return false;
  const inApp = path.relative(app, resolved);
  return inApp.startsWith("..") || path.isAbsolute(inApp);
}

/**
 * Answers the CLI's control requests for a native turn.
 *
 * - `can_use_tool`: anything auto mode wants a human to approve is shown on
 *   Dyad's approval card. "Always" is not offered: Dyad cannot show or revoke
 *   a saved approval for a Claude Code tool in Settings.
 * - `hook_callback`: Dyad's PreToolUse guard and PostToolUse change tracking.
 */
export function createNativeControlHandler({
  ctx,
  appsRoot,
  mutations,
}: {
  ctx: AgentContext;
  /** The Dyad apps folder, when the app lives inside it. */
  appsRoot?: string;
  mutations: NativeMutationTracker;
}) {
  return async (
    request: CliControlRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    if (request.subtype === "can_use_tool") {
      const parsed = CanUseToolSchema.parse(request);
      rememberUserInputSubscriber(ctx.event.sender);
      const requestId = userInputRegistry.request({
        kind: "agent-consent",
        allowAlways: false,
        chatId: ctx.chatId,
        toolName: `Claude Code: ${parsed.tool_name}`,
        toolDescription:
          parsed.decision_reason ??
          "Claude Code's auto mode asked for approval before running this.",
        inputPreview: preview(parsed.tool_name, parsed.input),
        classifier: "none",
      });
      const response = await userInputRegistry.park(requestId, signal);
      const approved =
        response?.kind === "agent-consent" && response.decision !== "decline";
      return approved
        ? { behavior: "allow", updatedInput: parsed.input }
        : {
            behavior: "deny",
            message: "The user declined this action in Dyad.",
          };
    }
    if (request.subtype === "hook_callback") {
      const parsed = HookCallbackSchema.parse(request);
      const toolName = parsed.input.tool_name ?? "";
      const input = parsed.input.tool_input ?? {};
      if (parsed.callback_id === NATIVE_HOOK_IDS.PreToolUse[0]) {
        const filePath =
          typeof input.file_path === "string"
            ? input.file_path
            : typeof input.notebook_path === "string"
              ? input.notebook_path
              : undefined;
        if (
          NATIVE_FILE_EDIT_TOOLS.has(toolName) &&
          filePath &&
          isOtherDyadAppPath(filePath, ctx.appPath, appsRoot)
        )
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason:
                "This file belongs to a different Dyad app. Only edit files in the current app.",
            },
          };
        return {};
      }
      if (parsed.callback_id === NATIVE_HOOK_IDS.PostToolUse[0]) {
        mutations.afterTool(toolName, input);
        return {};
      }
      return {};
    }
    throw new Error(`Unsupported control request: ${request.subtype}`);
  };
}
