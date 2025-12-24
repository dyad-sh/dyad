import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { gitRemove } from "@/ipc/utils/git_utils";
import { deleteSupabaseFunction } from "../../../../../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
} from "../../../../../../supabase_admin/supabase_utils";

const logger = log.scope("delete_file");

function getFunctionNameFromPath(input: string): string {
  return path.basename(path.extname(input) ? path.dirname(input) : input);
}

const deleteFileSchema = z.object({
  path: z.string().describe("The file path to delete"),
});

export const deleteFileTool: ToolDefinition<z.infer<typeof deleteFileSchema>> =
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    inputSchema: deleteFileSchema,
    defaultConsent: "always",

    getConsentPreview: (args) => `Delete ${args.path}`,

    buildXml: (args, _isComplete) => {
      if (!args.path) return undefined;
      return `<dyad-delete path="${escapeXmlAttr(args.path)}"></dyad-delete>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const fullFilePath = safeJoin(ctx.appPath, args.path);

      // Track if this is a shared module
      if (isSharedServerModule(args.path)) {
        ctx.isSharedModulesChanged = true;
      }

      if (fs.existsSync(fullFilePath)) {
        if (fs.lstatSync(fullFilePath).isDirectory()) {
          fs.rmdirSync(fullFilePath, { recursive: true });
        } else {
          fs.unlinkSync(fullFilePath);
        }
        logger.log(`Successfully deleted file: ${fullFilePath}`);

        // Remove from git
        try {
          await gitRemove({ path: ctx.appPath, filepath: args.path });
        } catch (error) {
          logger.warn(`Failed to git remove deleted file ${args.path}:`, error);
        }

        // Delete Supabase function if applicable
        if (ctx.supabaseProjectId && isServerFunction(args.path)) {
          try {
            await deleteSupabaseFunction({
              supabaseProjectId: ctx.supabaseProjectId,
              functionName: getFunctionNameFromPath(args.path),
              organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            });
          } catch (error) {
            return `File deleted, but failed to delete Supabase function: ${error}`;
          }
        }
      } else {
        logger.warn(`File to delete does not exist: ${fullFilePath}`);
      }

      return `Successfully deleted ${args.path}`;
    },
  };
