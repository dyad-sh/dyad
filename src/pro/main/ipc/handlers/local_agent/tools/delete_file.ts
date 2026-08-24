import fs from "node:fs";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { lstatIfExists, prepareDeletePath } from "@/ipc/utils/path_utils";
import { gitRemove } from "@/ipc/utils/git_utils";
import {
  deleteSupabaseFunction,
  deploySupabaseFunction,
} from "../../../../../../supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
  supabaseFunctionEntryExists,
} from "../../../../../../supabase_admin/supabase_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";

const logger = log.scope("delete_file");

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

    shouldTrackMutation: (_args, result) =>
      result.startsWith("Successfully deleted") ||
      result.startsWith("File deleted,"),

    execute: async (args, ctx: AgentContext) => {
      const { relativePath: operationPath, fullPath: fullFilePath } =
        await prepareDeletePath(ctx.appPath, args.path);

      return withLock(await getFileWriteKey(fullFilePath), async () => {
        const currentStat = lstatIfExists(fullFilePath);
        const didDelete = currentStat !== null;
        if (currentStat) {
          // Track if this is a shared module
          if (isSharedServerModule(operationPath)) {
            ctx.isSharedModulesChanged = true;
            ctx.sharedServerModulePaths.push(operationPath);
            ctx.onSharedServerModuleChange?.(operationPath);
          }

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
            logger.warn(
              `Failed to git remove deleted file ${args.path}:`,
              error,
            );
          }

          // Delete Supabase function if applicable
          if (ctx.supabaseProjectId && isServerFunction(operationPath)) {
            const functionName = extractFunctionNameFromPath(operationPath);
            if (ctx.allowDeploySideEffects === false) {
              ctx.onDeferredFunctionDelete?.(functionName);
            } else {
              try {
                if (
                  await supabaseFunctionEntryExists(ctx.appPath, functionName)
                ) {
                  await deploySupabaseFunction({
                    supabaseProjectId: ctx.supabaseProjectId,
                    functionName,
                    appPath: ctx.appPath,
                    organizationSlug: ctx.supabaseOrganizationSlug ?? null,
                  });
                } else {
                  await deleteSupabaseFunction({
                    supabaseProjectId: ctx.supabaseProjectId,
                    functionName,
                    organizationSlug: ctx.supabaseOrganizationSlug ?? null,
                  });
                }
              } catch (error) {
                return `File deleted, but failed to reconcile Supabase function: ${error}`;
              }
            }
          }
        } else {
          logger.warn(`File to delete does not exist: ${fullFilePath}`);
        }

        if (didDelete) {
          queueCloudSandboxSnapshotSync({
            appId: ctx.appId,
            deletedPaths: [operationPath],
          });
        }

        return didDelete
          ? `Successfully deleted ${args.path}`
          : `File ${args.path} did not exist, so nothing was deleted.`;
      });
    },
  };
