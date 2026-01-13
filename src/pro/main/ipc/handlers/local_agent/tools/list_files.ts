import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
  recursive: z
    .boolean()
    .optional()
    .describe("Whether to list files recursively (default: false)"),
});

export const listFilesTool: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description:
    "List files in the application directory. By default, lists only the immediate directory contents. Use recursive=true to list all files recursively. If you are not sure, list all files by omitting the directory parameter.",
  inputSchema: listFilesSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const recursiveText = args.recursive ? " (recursive)" : "";
    return args.directory
      ? `List ${args.directory}${recursiveText}`
      : `List all files${recursiveText}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) {
      return undefined;
    }
    const dirAttr = args.directory
      ? ` directory="${escapeXmlAttr(args.directory)}"`
      : "";
    const recursiveAttr =
      args.recursive !== undefined ? ` recursive="${args.recursive}"` : "";
    return `<dyad-list-files${dirAttr}${recursiveAttr}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    console.log("list_files", args);
    // Use "**" for recursive, "*" for non-recursive (immediate children only)
    const globSuffix = args.recursive ? "/**" : "/*";
    const globPath = args.directory
      ? args.directory + globSuffix
      : globSuffix.slice(1); // Remove leading "/" for root directory

    const { files } = await extractCodebase({
      appPath: ctx.appPath,
      chatContext: {
        contextPaths: [{ globPath }],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    // Build full file list for LLM
    const allFilesList =
      files.map((file) => " - " + file.path).join("\n") || "";

    // Build abbreviated list for UI display
    const MAX_FILES_TO_SHOW = 20;
    const totalCount = files.length;
    const displayedFiles = files.slice(0, MAX_FILES_TO_SHOW);
    const abbreviatedList =
      displayedFiles.map((file) => " - " + file.path).join("\n") || "";
    const countInfo =
      totalCount > MAX_FILES_TO_SHOW
        ? `\n... and ${totalCount - MAX_FILES_TO_SHOW} more files (${totalCount} total)`
        : `\n(${totalCount} files total)`;

    // Write abbreviated list to UI
    const dirAttr = args.directory
      ? ` directory="${escapeXmlAttr(args.directory)}"`
      : "";
    const recursiveAttr =
      args.recursive !== undefined ? ` recursive="${args.recursive}"` : "";
    ctx.onXmlComplete(
      `<dyad-list-files${dirAttr}${recursiveAttr}>${abbreviatedList}${countInfo}</dyad-list-files>`,
    );

    // Return full file list for LLM
    return allFilesList;
  },
};
