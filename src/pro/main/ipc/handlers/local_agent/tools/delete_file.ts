import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { lstatIfExists, prepareDeletePath } from "@/ipc/utils/path_utils";
import { gitRemove } from "@/ipc/utils/git_utils";
import { deleteSupabaseFunction } from "../../../../../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
} from "../../../../../../supabase_admin/supabase_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";

const logger = log.scope("delete_file");

function getFunctionNameFromPath(input: string): string {
  return path.basename(path.extname(input) ? path.dirname(input) : input);
}

const deleteFileSchema = z.object({
  path: z
    .string()
    .refine((value) => value.trim().length > 0, {
      message: "Path cannot be empty",
    })
    .describe("The file path to delete"),
});

export const deleteFileTool: ToolDefinition<z.infer<typeof deleteFileSchema>> =
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    inputSchema: deleteFileSchema,
    defaultConsent: "always",
    modifiesState: true,

    getConsentPreview: (args) => `Delete ${args.path}`,

    buildXml: (args, _isComplete) => {
      if (!args.path?.trim()) return undefined;
      return `<dyad-delete path="${escapeXmlAttr(args.path)}"></dyad-delete>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const { relativePath: operationPath, fullPath: fullFilePath } =
        await prepareDeletePath(ctx.appPath, args.path);

      // Track if this is a shared module
      if (isSharedServerModule(operationPath)) {
        ctx.isSharedModulesChanged = true;
        ctx.sharedServerModulePaths.push(operationPath);
      }

      const currentStat = lstatIfExists(fullFilePath);
      if (currentStat) {
        if (currentStat.isDirectory()) {
          fs.rmdirSync(fullFilePath, { recursive: true });
        } else {
          fs.unlinkSync(fullFilePath);
        }
        logger.log(`Successfully deleted file: ${fullFilePath}`);

        // Remove from git
        try {
          await gitRemove({ path: ctx.appPath, filepath: operationPath });
        } catch (error) {
          logger.warn(`Failed to git remove deleted file ${args.path}:`, error);
        }

        // Delete Supabase function if applicable
        if (ctx.supabaseProjectId && isServerFunction(operationPath)) {
          try {
            await deleteSupabaseFunction({
              supabaseProjectId: ctx.supabaseProjectId,
              functionName: getFunctionNameFromPath(operationPath),
              organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            });
          } catch (error) {
            return `File deleted, but failed to delete Supabase function: ${error}`;
          }
        }
      } else {
        logger.warn(`File to delete does not exist: ${fullFilePath}`);
      }

      queueCloudSandboxSnapshotSync({
        appId: ctx.appId,
        deletedPaths: [operationPath],
      });

      return `Successfully deleted ${args.path}`;
    },
  };
