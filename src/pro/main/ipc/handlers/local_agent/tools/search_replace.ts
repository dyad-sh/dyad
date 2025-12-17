import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  StreamingArgsParser,
} from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { deploySupabaseFunction } from "../../../../../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
} from "../../../../../../supabase_admin/supabase_utils";
import { applySearchReplace } from "../../../../../../pro/main/ipc/processors/search_replace_processor";

const readFile = fs.promises.readFile;
const logger = log.scope("search_replace");

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

  buildXml: (argsText: string, isComplete: boolean): string | undefined => {
    const parser = new StreamingArgsParser();
    parser.push(argsText);

    const filePath = parser.tryGetStringField("path");
    if (!filePath) return undefined;

    const description = parser.tryGetStringField("description") ?? "";
    const search = parser.tryGetStringField("search") ?? "";
    const replace = parser.tryGetStringField("replace");

    let xml = `<dyad-search-replace path="${escapeXmlAttr(filePath)}" description="${escapeXmlAttr(description)}">\n<<<<<<< SEARCH\n${search}`;

    // Add separator and replace content if replace has started
    if (replace !== undefined) {
      xml += `\n=======\n${replace}`;
    }

    if (isComplete) {
      if (replace === undefined) {
        xml += "\n=======\n";
      }
      xml += "\n>>>>>>> REPLACE\n</dyad-search-replace>";
    }

    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "search_replace",
      toolDescription: "Apply search/replace edits",
      inputPreview: `Edit ${args.path}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for search_replace");
    }

    const fullFilePath = safeJoin(ctx.appPath, args.path);

    // Track if this is a shared module
    if (isSharedServerModule(args.path)) {
      ctx.isSharedModulesChanged = true;
    }

    if (!fs.existsSync(fullFilePath)) {
      throw new Error(`File does not exist: ${args.path}`);
    }

    const original = await readFile(fullFilePath, "utf8");
    // Construct the operations string in the expected format
    const operations = `<<<<<<< SEARCH\n${args.search}\n=======\n${args.replace}\n>>>>>>> REPLACE`;
    const result = applySearchReplace(original, operations);

    if (!result.success || typeof result.content !== "string") {
      throw new Error(
        `Failed to apply search-replace: ${result.error ?? "unknown"}`,
      );
    }

    fs.writeFileSync(fullFilePath, result.content);
    logger.log(`Successfully applied search-replace to: ${fullFilePath}`);

    // Deploy Supabase function if applicable
    if (
      ctx.supabaseProjectId &&
      isServerFunction(args.path) &&
      !ctx.isSharedModulesChanged
    ) {
      try {
        await deploySupabaseFunction({
          supabaseProjectId: ctx.supabaseProjectId,
          functionName: path.basename(path.dirname(args.path)),
          appPath: ctx.appPath,
        });
      } catch (error) {
        return `Search-replace applied, but failed to deploy Supabase function: ${error}`;
      }
    }

    return `Successfully applied edits to ${args.path}`;
  },
};
