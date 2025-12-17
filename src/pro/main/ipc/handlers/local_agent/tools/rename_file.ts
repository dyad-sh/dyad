import { z } from "zod";
import { ToolDefinition, ToolExecuteContext, escapeXmlAttr } from "./types";
import {
  executeRenameFile,
  type FileOperationContext,
} from "../processors/file_operations";

const renameFileSchema = z.object({
  from: z.string().describe("The current file path"),
  to: z.string().describe("The new file path"),
});

export const renameFileTool: ToolDefinition<z.infer<typeof renameFileSchema>> =
  {
    name: "rename_file",
    description: "Rename or move a file in the codebase",
    inputSchema: renameFileSchema,
    defaultConsent: "always",
    execute: async (args, ctx: ToolExecuteContext) => {
      const allowed = await ctx.requireConsent({
        toolName: "rename_file",
        toolDescription: "Rename or move a file",
        inputPreview: `Rename ${args.from} to ${args.to}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for rename_file");
      }

      ctx.onXmlChunk(
        `<dyad-rename from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}"></dyad-rename>`,
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeRenameFile(opCtx, args.from, args.to);
      if (!result.success) {
        throw new Error(result.error);
      }
      return (
        result.warning || `Successfully renamed ${args.from} to ${args.to}`
      );
    },
  };
