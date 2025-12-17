import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeWriteFile } from "../processors/file_operations";

const writeFileSchema = z.object({
  path: z.string().describe("The file path relative to the app root"),
  content: z.string().describe("The content to write to the file"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the change"),
});

export const writeFileTool: ToolDefinition<z.infer<typeof writeFileSchema>> = {
  name: "write_file",
  description: "Create or completely overwrite a file in the codebase",
  inputSchema: writeFileSchema,
  defaultConsent: "always",
  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "write_file",
      toolDescription: "Create or overwrite a file",
      inputPreview: `Write to ${args.path}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for write_file");
    }

    ctx.onXmlChunk(
      `<dyad-write path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "")}">
${args.content}
</dyad-write>`,
    );

    const result = await executeWriteFile(ctx, args.path, args.content);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.warning || `Successfully wrote ${args.path}`;
  },
};
