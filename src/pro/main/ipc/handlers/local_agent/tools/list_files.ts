import path from "node:path";
import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";
import { resolveDirectoryWithinAppPath } from "./path_safety";

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
  recursive: z
    .boolean()
    .optional()
    .describe("Whether to list files recursively (default: false)"),
});

type ListFilesArgs = z.infer<typeof listFilesSchema>;

function getXmlAttributes(args: ListFilesArgs) {
  const dirAttr = args.directory
    ? ` directory="${escapeXmlAttr(args.directory)}"`
    : "";
  const recursiveAttr =
    args.recursive !== undefined ? ` recursive="${args.recursive}"` : "";
  return `${dirAttr}${recursiveAttr}`;
}

export const listFilesTool: ToolDefinition<ListFilesArgs> = {
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
    return `<dyad-list-files${getXmlAttributes(args)}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Validate directory path to prevent path traversal attacks
    let sanitizedDirectory: string | undefined;
    if (args.directory) {
      const relativePathFromApp = resolveDirectoryWithinAppPath({
        appPath: ctx.appPath,
        directory: args.directory,
      });

      // Normalize for glob usage (glob treats "\" as an escape on Windows)
      const normalizedRelativePath = relativePathFromApp
        .split(path.sep)
        .join("/")
        .replace(/\\/g, "/");

      // Empty means "root"
      sanitizedDirectory = normalizedRelativePath || undefined;
    }

    // Use "**" for recursive, "*" for non-recursive (immediate children only)
    const globSuffix = args.recursive ? "/**" : "/*";
    const globPath = sanitizedDirectory
      ? sanitizedDirectory + globSuffix
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
    ctx.onXmlComplete(
      `<dyad-list-files${getXmlAttributes(args)}>${escapeXmlContent(abbreviatedList + countInfo)}</dyad-list-files>`,
    );

    // Return full file list for LLM
    return allFilesList;
  },
};
