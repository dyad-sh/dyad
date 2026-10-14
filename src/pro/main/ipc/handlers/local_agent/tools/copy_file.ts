import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeCopyFile } from "@/ipc/utils/copy_file_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { isPathGitVisible } from "./tool_invocation";
import { isSupabaseFunctionSyncDeferred } from "@/supabase_admin/supabase_recording_deferred_sync";

const copyFileSchema = z.object({
  from: z
    .string()
    .describe(
      "The source file path (can be attachments:<name>, a .dyad/media path, or a path relative to the app root)",
    ),
  to: z.string().describe("The destination file path relative to the app root"),
  description: z
    .string()
    .optional()
    .describe("Brief description of why the file is being copied"),
});

export const copyFileTool: ToolDefinition<z.infer<typeof copyFileSchema>> = {
  name: "copy_file",
  description:
    "Copy a file from one location to another. Can copy uploaded attachment files (attachments:<name> or .dyad/media paths) into the codebase, or copy files within the codebase.",
  inputSchema: copyFileSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Copy ${args.from} to ${args.to}`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Successfully copied") ||
    result.startsWith("File copied,"),
  shouldTrackFileMutation: async (args, _result, ctx) =>
    isPathGitVisible(ctx, args.to),

  buildXml: (args, _isComplete) => {
    if (!args.from || !args.to) return undefined;
    return `<dyad-copy from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}" description="${escapeXmlAttr(args.description ?? "")}"></dyad-copy>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const result = await executeCopyFile({
      from: args.from,
      to: args.to,
      appId: ctx.appId,
      workspace:
        ctx.workspaceCoordinationKey !== undefined
          ? {
              appPath: ctx.appPath,
              mediaAppPath: ctx.dyadMetadataPath ?? ctx.appPath,
              coordinationKey: ctx.workspaceCoordinationKey,
            }
          : undefined,
      isSharedModulesChanged: ctx.isSharedModulesChanged,
      allowDeploySideEffects: ctx.allowDeploySideEffects,
      signal: ctx.abortSignal,
    });

    if (result.sharedModuleChanged) {
      ctx.isSharedModulesChanged = true;
      ctx.sharedServerModulePaths.push(args.to);
      ctx.onSharedServerModuleChange?.(args.to);
    }

    if (result.skippedFunctionDeploy) {
      if (ctx.allowDeploySideEffects === false) {
        ctx.onDeferredFunctionDeploy?.(result.skippedFunctionDeploy);
      } else {
        ctx.pendingFunctionDeploys.push(result.skippedFunctionDeploy);
      }
    }

    queueCloudSandboxSnapshotSync({
      // Isolated workspace edits reach the app's sandbox once merged.
      appId: ctx.runtimeAppId ?? ctx.appId,
      changedPaths: [args.to],
    });

    if (result.deployError) {
      if (isSupabaseFunctionSyncDeferred(result.deployError)) {
        return `Successfully copied ${args.from} to ${args.to}. ${result.deployError.message}`;
      }
      return `File copied, but failed to deploy Supabase function: ${result.deployError}`;
    }

    return `Successfully copied ${args.from} to ${args.to}`;
  },
};
