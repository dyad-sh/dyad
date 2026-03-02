import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeCopyFile } from "@/ipc/utils/copy_file_utils";

const copyFileSchema = z.object({
  from: z
    .string()
    .describe(
      "The source file path (can be a .dyad/media path or a path relative to the app root)",
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
    "Copy a file from one location to another. Can copy uploaded attachment files (from .dyad/media) into the codebase, or copy files within the codebase.",
  inputSchema: copyFileSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Copy ${args.from} to ${args.to}`,

  buildXml: (args, _isComplete) => {
    if (!args.from || !args.to) return undefined;
    return `<dyad-copy from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}" description="${escapeXmlAttr(args.description ?? "")}"></dyad-copy>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const result = await executeCopyFile({
      from: args.from,
      to: args.to,
      appId: ctx.appId,
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
      supabaseOrganizationSlug: ctx.supabaseOrganizationSlug,
      isSharedModulesChanged: ctx.isSharedModulesChanged,
    });

    if (result.sharedModuleChanged) {
      ctx.isSharedModulesChanged = true;
    }

    if (result.deployError) {
      return `File copied, but failed to deploy Supabase function: ${result.deployError}`;
    }

    return `Successfully copied ${args.from} to ${args.to}`;
  },
};
