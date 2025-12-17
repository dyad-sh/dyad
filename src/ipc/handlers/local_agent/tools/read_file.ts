import { z } from "zod";
import { ToolDefinition, ToolExecuteContext, escapeXmlAttr } from "./types";
import {
  readFileForContext,
  type FileOperationContext,
} from "../../../processors/file_operations";

const readFileSchema = z.object({
  path: z.string().describe("The file path to read"),
});

export const readFileTool: ToolDefinition<z.infer<typeof readFileSchema>> = {
  name: "read_file",
  description: "Read the content of a file from the codebase",
  inputSchema: readFileSchema,
  defaultConsent: "always",
  execute: async (args, ctx: ToolExecuteContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "read_file",
      toolDescription: "Read a file",
      inputPreview: `Read ${args.path}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for read_file");
    }

    ctx.onXmlChunk(
      `<dyad-read path="${escapeXmlAttr(args.path)}"></dyad-read>`,
    );

    const opCtx: FileOperationContext = {
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
    };

    const result = await readFileForContext(opCtx, args.path);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.content || "";
  },
};
