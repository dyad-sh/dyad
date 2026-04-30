import path from "node:path";
import { z } from "zod";
import { glob } from "glob";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { extractCodebase } from "../../../../../../utils/codebase";
import { resolveDirectoryWithinAppPath } from "./path_safety";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DYAD_INTERNAL_GLOB,
  filterDyadInternalFiles,
  resolveTargetAppPath,
} from "./resolve_app_context";

const MAX_PATHS_TO_RETURN = 1_000;

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to list from instead of the current app. Omit to list the current app.",
    ),
  recursive: z
    .boolean()
    .optional()
    .describe("Whether to list files recursively (default: false)"),
  include_ignored: z
    .boolean()
    .optional()
    .describe(
      "Whether to include git-ignored and hidden files/directories such as node_modules (default: false).",
    ),
});

type ListFilesArgs = z.infer<typeof listFilesSchema>;

interface ListedPath {
  path: string;
  isDirectory: boolean;
}

function getDisplayPath(entry: ListedPath): string {
  return entry.isDirectory ? `${entry.path}/` : entry.path;
}

function sortListedPaths(entries: ListedPath[]): ListedPath[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });
}

function getXmlAttributes(args: ListFilesArgs, count?: number, total?: number) {
  const dirAttr = args.directory
    ? ` directory="${escapeXmlAttr(args.directory)}"`
    : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  const recursiveAttr =
    args.recursive !== undefined ? ` recursive="${args.recursive}"` : "";
  const includeIgnoredAttr =
    args.include_ignored !== undefined
      ? ` include_ignored="${args.include_ignored}"`
      : "";
  const countAttr = count !== undefined ? ` count="${count}"` : "";
  const totalAttr =
    total !== undefined && total > (count ?? 0) ? ` total="${total}"` : "";
  const truncatedAttr = totalAttr ? ` truncated="true"` : "";
  return `${dirAttr}${appNameAttr}${recursiveAttr}${includeIgnoredAttr}${countAttr}${totalAttr}${truncatedAttr}`;
}

export const listFilesTool: ToolDefinition<ListFilesArgs> = {
  name: "list_files",
  description:
    "List files in the application directory. By default, lists only the immediate directory contents. Use recursive=true to list all files recursively. Use include_ignored=true to include git-ignored and hidden paths; recursive ignored listings require directory to be set. Results are capped at 1000 paths.",
  inputSchema: listFilesSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const recursiveText = args.recursive ? " (recursive)" : "";
    const ignoredText = args.include_ignored ? " (include ignored)" : "";
    const appSuffix = args.app_name ? ` (app: ${args.app_name})` : "";
    const target = args.directory ?? "all files";
    return `List ${target}${recursiveText}${ignoredText}${appSuffix}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) {
      return undefined;
    }
    return `<dyad-list-files${getXmlAttributes(args)}></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    // Validate directory path to prevent path traversal attacks
    let sanitizedDirectory: string | undefined;
    if (args.directory) {
      const relativePathFromApp = resolveDirectoryWithinAppPath({
        appPath: targetAppPath,
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

    if (args.include_ignored && args.recursive && !sanitizedDirectory) {
      throw new DyadError(
        "include_ignored=true with recursive=true requires a non-root directory to avoid listing too many files.",
        DyadErrorKind.Validation,
      );
    }

    // Use "**" for recursive, "*" for non-recursive (immediate children only)
    const globSuffix = args.recursive ? "/**" : "/*";
    const globPath = sanitizedDirectory
      ? sanitizedDirectory + globSuffix
      : globSuffix.slice(1); // Remove leading "/" for root directory

    let allPaths: ListedPath[];

    if (args.include_ignored) {
      const normalizedAppPath = targetAppPath.replace(/\\/g, "/");
      const globPattern = `${normalizedAppPath}/${globPath}`;
      const ignoredGlobs = args.app_name
        ? ["**/.git", "**/.git/**", DYAD_INTERNAL_GLOB]
        : ["**/.git", "**/.git/**"];
      const ignoredPaths = await glob(globPattern, {
        withFileTypes: true,
        dot: true,
        ignore: ignoredGlobs,
      });

      allPaths = sortListedPaths(
        ignoredPaths.map((entry) => ({
          path: path
            .relative(targetAppPath, entry.fullpath())
            .split(path.sep)
            .join("/"),
          isDirectory: entry.isDirectory(),
        })),
      );
    } else {
      const { files } = await extractCodebase({
        appPath: targetAppPath,
        chatContext: {
          contextPaths: [{ globPath }],
          smartContextAutoIncludes: [],
          excludePaths: [],
        },
      });

      const filteredFiles = filterDyadInternalFiles(files, args.app_name);

      // Build the list of file paths
      allPaths = sortListedPaths(
        filteredFiles.map((file) => ({
          path: file.path,
          isDirectory: false,
        })),
      );
    }

    const totalCount = allPaths.length;
    const cappedPaths = allPaths.slice(0, MAX_PATHS_TO_RETURN);
    const wasTruncated = totalCount > cappedPaths.length;

    // Build full file list for LLM
    const allFilesList =
      cappedPaths.map((entry) => " - " + getDisplayPath(entry)).join("\n") ||
      "";
    const resultText = wasTruncated
      ? `${allFilesList}\n\n[TRUNCATED: Showing ${cappedPaths.length} of ${totalCount} paths. Use directory to narrow the listing.]`
      : allFilesList;

    // Build abbreviated list for UI display
    const MAX_FILES_TO_SHOW = 20;
    const displayedFiles = cappedPaths.slice(0, MAX_FILES_TO_SHOW);
    const abbreviatedList =
      displayedFiles.map((entry) => " - " + getDisplayPath(entry)).join("\n") ||
      "";
    const countInfo =
      totalCount > MAX_FILES_TO_SHOW
        ? `\n... and ${totalCount - MAX_FILES_TO_SHOW} more paths (${totalCount} total)`
        : `\n(${totalCount} paths total)`;

    // Write abbreviated list to UI
    ctx.onXmlComplete(
      `<dyad-list-files${getXmlAttributes(args, cappedPaths.length, totalCount)}>${escapeXmlContent(abbreviatedList + countInfo)}</dyad-list-files>`,
    );

    // Return full file list for LLM
    return resultText;
  },
};
