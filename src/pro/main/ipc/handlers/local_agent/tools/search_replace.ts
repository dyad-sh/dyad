import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeSearchReplaceFile } from "../processors/file_operations";

const searchReplaceSchema = z.object({
  path: z.string().describe("The file path to edit"),
  search: z
    .string()
    .describe(
      "Content to search for in the file. This should match the existing code that will be replaced",
    ),
  replace: z
    .string()
    .describe("New content to replace the search content with"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the changes"),
});

export const searchReplaceTool: ToolDefinition<
  z.infer<typeof searchReplaceSchema>
> = {
  name: "search_replace",
  description:
    "Apply targeted search/replace edits to a file. This is the preferred tool for editing a file.",
  inputSchema: searchReplaceSchema,
  defaultConsent: "always",
  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "search_replace",
      toolDescription: "Apply search/replace edits",
      inputPreview: `Edit ${args.path}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for search_replace");
    }

    ctx.onXmlChunk(
      `<dyad-search-replace path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "")}">
<<<<<<< SEARCH
${args.search}
=======
${args.replace}
>>>>>>> REPLACE
</dyad-search-replace>`,
    );

    console.error(
      "EXECUTING SEARCH REPLACE FILE",
      args.path,
      args.search,
      args.replace,
    );
    const result = await executeSearchReplaceFile(
      ctx,
      args.path,
      args.search,
      args.replace,
    );
    console.error("**RESULT**", result);

    if (!result.success) {
      throw new Error(result.error);
    }
    return result.warning || `Successfully applied edits to ${args.path}`;
  },
};
