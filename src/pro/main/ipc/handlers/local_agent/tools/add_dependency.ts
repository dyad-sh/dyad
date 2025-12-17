import { z } from "zod";
import { ToolDefinition, ToolExecuteContext, escapeXmlAttr } from "./types";
import {
  executeAddDependencies,
  type FileOperationContext,
} from "../processors/file_operations";

const addDependencySchema = z.object({
  packages: z.array(z.string()).describe("Array of package names to install"),
});

export const addDependencyTool: ToolDefinition<
  z.infer<typeof addDependencySchema>
> = {
  name: "add_dependency",
  description: "Install npm packages",
  inputSchema: addDependencySchema,
  defaultConsent: "ask",
  execute: async (args, ctx: ToolExecuteContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      inputPreview: `Install ${args.packages.join(", ")}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for add_dependency");
    }

    ctx.onXmlChunk(
      `<dyad-add-dependency packages="${escapeXmlAttr(args.packages.join(" "))}"></dyad-add-dependency>`,
    );

    const opCtx: FileOperationContext = {
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
    };

    const result = await executeAddDependencies(
      opCtx,
      args.packages,
      ctx.messageId,
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    return (
      result.warning || `Successfully installed ${args.packages.join(", ")}`
    );
  },
};
