import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeDeleteFile } from "../processors/file_operations";

const deleteFileSchema = z.object({
  path: z.string().describe("The file path to delete"),
});

export const deleteFileTool: ToolDefinition<z.infer<typeof deleteFileSchema>> =
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    inputSchema: deleteFileSchema,
    defaultConsent: "always",
    execute: async (args, ctx: AgentContext) => {
      const allowed = await ctx.requireConsent({
        toolName: "delete_file",
        toolDescription: "Delete a file",
        inputPreview: `Delete ${args.path}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for delete_file");
      }

      ctx.onXmlChunk(
        `<dyad-delete path="${escapeXmlAttr(args.path)}"></dyad-delete>`,
      );

      const result = await executeDeleteFile(ctx, args.path);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || `Successfully deleted ${args.path}`;
    },
  };
