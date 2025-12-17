import { z } from "zod";
import { ToolDefinition, ToolExecuteContext, escapeXmlAttr } from "./types";
import {
  listFilesInApp,
  type FileOperationContext,
} from "../processors/file_operations";

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
});

export const listFilesTool: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description: "List all files in the application directory",
  inputSchema: listFilesSchema,
  defaultConsent: "always",
  execute: async (args, ctx: ToolExecuteContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "list_files",
      toolDescription: "List files in the app",
      inputPreview: args.directory
        ? `List ${args.directory}`
        : "List all files",
    });
    if (!allowed) {
      throw new Error("User denied permission for list_files");
    }

    const dirAttr = args.directory
      ? ` directory="${escapeXmlAttr(args.directory)}"`
      : "";
    ctx.onXmlChunk(`<dyad-list-files${dirAttr}></dyad-list-files>`);

    const opCtx: FileOperationContext = {
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
    };

    const result = await listFilesInApp(opCtx, args.directory);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.files || "";
  },
};
