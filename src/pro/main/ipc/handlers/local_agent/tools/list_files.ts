import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  StreamingArgsParser,
} from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
});

export const listFilesTool: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description: "List all files in the application directory",
  inputSchema: listFilesSchema,
  defaultConsent: "always",

  buildXml: (argsText: string, _isComplete: boolean): string => {
    const parser = new StreamingArgsParser();
    parser.push(argsText);

    const directory = parser.tryGetStringField("directory");
    const dirAttr = directory ? ` directory="${escapeXmlAttr(directory)}"` : "";

    return `<dyad-list-files${dirAttr}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
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
