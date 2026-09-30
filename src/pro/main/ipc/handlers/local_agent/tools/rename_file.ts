import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { gitAdd, gitRemove } from "@/ipc/utils/git_utils";
import {
  deploySupabaseFunction,
  deleteSupabaseFunction,
} from "../../../../../../supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "../../../../../../supabase_admin/supabase_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { getFileWriteKey, withLocks } from "@/ipc/utils/lock_utils";
import {
  deferFunctionSyncIfRecording,
  RECORDING_DEFERRED_FUNCTION_SYNC_NOTE,
} from "./supabase_function_sync";

const logger = log.scope("rename_file");

const renameFileSchema = z.object({
  from: z.string().describe("The current file path"),
  to: z.string().describe("The new file path"),
});

export const renameFileTool: ToolDefinition<z.infer<typeof renameFileSchema>> =
  {
    name: "rename_file",
    description: "Rename or move a file in the codebase",
    inputSchema: renameFileSchema,
    defaultConsent: "always",
    modifiesState: true,

    getConsentPreview: (args) => `Rename ${args.from} to ${args.to}`,

    buildXml: (args, _isComplete) => {
      if (!args.from || !args.to) return undefined;
      return `<dyad-rename from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}"></dyad-rename>`;
    },

    shouldTrackMutation: (_args, result) =>
      result.startsWith("Successfully renamed") ||
      result.startsWith("File renamed,"),

    execute: async (args, ctx: AgentContext) => {
      const fromOperationPath = await assertMutationPathAllowed({
        appPath: ctx.appPath,
        relativePath: args.from,
        followFinalSymlink: false,
      });
      const toOperationPath = await assertMutationPathAllowed({
        appPath: ctx.appPath,
        relativePath: args.to,
        followFinalSymlink: false,
      });
      const fromFullPath = safeJoin(ctx.appPath, fromOperationPath);
      const toFullPath = safeJoin(ctx.appPath, toOperationPath);
      let functionToDelete: string | undefined;
      let functionToDeploy: string | undefined;
      const didRename = await withLocks(
        [
          await getFileWriteKey(fromFullPath),
          await getFileWriteKey(toFullPath),
        ],
        async () => {
          const renamed =
            path.normalize(fromFullPath) !== path.normalize(toFullPath) &&
            fs.existsSync(fromFullPath);

          if (renamed) {
            // Track if this involves shared modules
            if (
              isSharedServerModule(fromOperationPath) ||
              isSharedServerModule(toOperationPath)
            ) {
              ctx.isSharedModulesChanged = true;
              if (isSharedServerModule(fromOperationPath)) {
                ctx.sharedServerModulePaths.push(fromOperationPath);
                ctx.onSharedServerModuleChange?.(fromOperationPath);
              }
              if (isSharedServerModule(toOperationPath)) {
                ctx.sharedServerModulePaths.push(toOperationPath);
                ctx.onSharedServerModuleChange?.(toOperationPath);
              }
            }

            // Ensure target directory exists
            const dirPath = path.dirname(toFullPath);
            fs.mkdirSync(dirPath, { recursive: true });

            fs.renameSync(fromFullPath, toFullPath);
            logger.log(
              `Successfully renamed file: ${fromFullPath} -> ${toFullPath}`,
            );

            // Update git
            await gitAdd({ path: ctx.appPath, filepath: toOperationPath });
            try {
              await gitRemove({
                path: ctx.appPath,
                filepath: fromOperationPath,
              });
            } catch (error) {
              logger.warn(`Failed to git remove old file ${args.from}:`, error);
            }

            // Supabase side effects run after the file locks are released.
            if (ctx.supabaseProjectId) {
              if (isServerFunction(fromOperationPath)) {
                const functionName =
                  extractFunctionNameFromPath(fromOperationPath);
                if (ctx.allowDeploySideEffects === false) {
                  ctx.onDeferredFunctionDelete?.(functionName);
                } else {
                  functionToDelete = functionName;
                }
              }
              if (isServerFunction(toOperationPath)) {
                const functionName =
                  extractFunctionNameFromPath(toOperationPath);
                if (ctx.allowDeploySideEffects === false) {
                  ctx.onDeferredFunctionDeploy?.(functionName);
                } else if (!ctx.isSharedModulesChanged) {
                  functionToDeploy = functionName;
                } else {
                  ctx.pendingFunctionDeploys.push(functionName);
                }
              }
            }
          } else {
            logger.warn(
              `Source file for rename does not exist: ${fromFullPath}`,
            );
          }

          if (renamed) {
            queueCloudSandboxSnapshotSync({
              appId: ctx.appId,
              changedPaths: [toOperationPath],
              deletedPaths: [fromOperationPath],
            });
          }

          return renamed;
        },
      );

      if (!didRename) {
        return `Source file ${args.from} did not exist or already matched ${args.to}, so nothing was renamed.`;
      }

      // Deployment admission can queue behind another chat's batch upload, so
      // it must not hold the file locks other writers of these paths need.
      const successMessage = `Successfully renamed ${args.from} to ${args.to}`;
      let deferredWhileRecording = false;
      if (functionToDelete && ctx.supabaseProjectId) {
        try {
          await deleteSupabaseFunction({
            appId: ctx.appId,
            supabaseProjectId: ctx.supabaseProjectId,
            functionName: functionToDelete,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            signal: ctx.abortSignal,
          });
        } catch (error) {
          if (deferFunctionSyncIfRecording(ctx, functionToDelete, "delete")) {
            deferredWhileRecording = true;
          } else {
            logger.warn(
              `Failed to delete old Supabase function: ${args.from}`,
              error,
            );
          }
        }
      }
      if (functionToDeploy && ctx.supabaseProjectId) {
        try {
          await deploySupabaseFunction({
            appId: ctx.appId,
            supabaseProjectId: ctx.supabaseProjectId,
            functionName: functionToDeploy,
            appPath: ctx.appPath,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            signal: ctx.abortSignal,
          });
        } catch (error) {
          if (!deferFunctionSyncIfRecording(ctx, functionToDeploy, "deploy")) {
            return `File renamed, but failed to deploy Supabase function: ${error}`;
          }
          deferredWhileRecording = true;
        }
      }
      return deferredWhileRecording
        ? `${successMessage}. ${RECORDING_DEFERRED_FUNCTION_SYNC_NOTE}`
        : successMessage;
    },
  };
