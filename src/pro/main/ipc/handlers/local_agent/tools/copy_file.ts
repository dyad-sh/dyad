import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { gitAdd } from "@/ipc/utils/git_utils";
import { isWithinDyadMediaDir } from "@/ipc/utils/media_path_utils";
import { deploySupabaseFunction } from "../../../../../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
  extractFunctionNameFromPath,
} from "../../../../../../supabase_admin/supabase_utils";

const logger = log.scope("copy_file");

const copyFileSchema = z.object({
  from: z
    .string()
    .describe(
      "The source file path (can be a dyad-media path or a path relative to the app root)",
    ),
  to: z.string().describe("The destination file path relative to the app root"),
  description: z
    .string()
    .optional()
    .describe("Brief description of why the file is being copied"),
});

export const copyFileTool: ToolDefinition<z.infer<typeof copyFileSchema>> = {
  name: "copy_file",
  description:
    "Copy a file from one location to another. Can copy uploaded attachment files (from dyad-media) into the codebase, or copy files within the codebase.",
  inputSchema: copyFileSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Copy ${args.from} to ${args.to}`,

  buildXml: (args, _isComplete) => {
    if (!args.from || !args.to) return undefined;
    return `<dyad-copy from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}" description="${escapeXmlAttr(args.description ?? "")}"></dyad-copy>`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Resolve the source path: allow both dyad-media paths and app-relative paths
    let fromFullPath: string;
    if (path.isAbsolute(args.from)) {
      // Security: only allow absolute paths within the app's dyad-media directory
      if (!isWithinDyadMediaDir(args.from, ctx.appPath)) {
        throw new Error(
          `Absolute source paths are only allowed within the dyad-media directory`,
        );
      }
      fromFullPath = path.resolve(args.from);
    } else {
      fromFullPath = safeJoin(ctx.appPath, args.from);
    }

    const toFullPath = safeJoin(ctx.appPath, args.to);

    if (!fs.existsSync(fromFullPath)) {
      throw new Error(`Source file does not exist: ${args.from}`);
    }

    // Track if this is a shared module
    if (isSharedServerModule(args.to)) {
      ctx.isSharedModulesChanged = true;
    }

    // Ensure destination directory exists
    const dirPath = path.dirname(toFullPath);
    fs.mkdirSync(dirPath, { recursive: true });

    // Copy the file
    fs.copyFileSync(fromFullPath, toFullPath);
    logger.log(`Successfully copied file: ${fromFullPath} -> ${toFullPath}`);

    // Add to git
    await gitAdd({ path: ctx.appPath, filepath: args.to });

    // Deploy Supabase function if applicable
    if (
      ctx.supabaseProjectId &&
      isServerFunction(args.to) &&
      !ctx.isSharedModulesChanged
    ) {
      try {
        await deploySupabaseFunction({
          supabaseProjectId: ctx.supabaseProjectId,
          functionName: extractFunctionNameFromPath(args.to),
          appPath: ctx.appPath,
          organizationSlug: ctx.supabaseOrganizationSlug ?? null,
        });
      } catch (error) {
        return `File copied, but failed to deploy Supabase function: ${error}`;
      }
    }

    return `Successfully copied ${args.from} to ${args.to}`;
  },
};
