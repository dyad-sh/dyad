import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeRenameFile } from "../processors/file_operations";

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
    execute: async (args, ctx: AgentContext) => {
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

      const result = await executeRenameFile(ctx, args.from, args.to);
      if (!result.success) {
        throw new Error(result.error);
      }
      return (
        result.warning || `Successfully renamed ${args.from} to ${args.to}`
      );
    },
  };
