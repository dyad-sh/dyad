import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
});

export const listFilesTool: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description:
    "List all files in the application directory recursively. If you are not sure, list all files by omitting the directory parameter.",
  inputSchema: listFilesSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    args.directory ? `List ${args.directory}` : "List all files",

  buildXml: (args, _isComplete) => {
    const dirAttr = args.directory
      ? ` directory="${escapeXmlAttr(args.directory)}"`
      : "";
    return `<dyad-list-files${dirAttr}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const { files } = await extractCodebase({
      appPath: ctx.appPath,
      // TODO
      chatContext: {
        contextPaths: args.directory
          ? [{ globPath: args.directory + "/**" }]
          : [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    return files.map((file) => " - " + file.path).join("\n") || "";
  },
};
