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

      // Track if this involves shared modules
      if (
        isSharedServerModule(fromOperationPath) ||
        isSharedServerModule(toOperationPath)
      ) {
        ctx.isSharedModulesChanged = true;
        if (isSharedServerModule(fromOperationPath)) {
          ctx.sharedServerModulePaths.push(fromOperationPath);
        }
        if (isSharedServerModule(toOperationPath)) {
          ctx.sharedServerModulePaths.push(toOperationPath);
        }
      }

      // Ensure target directory exists
      const dirPath = path.dirname(toFullPath);
      fs.mkdirSync(dirPath, { recursive: true });

      if (fs.existsSync(fromFullPath)) {
        fs.renameSync(fromFullPath, toFullPath);
        logger.log(
          `Successfully renamed file: ${fromFullPath} -> ${toFullPath}`,
        );

        // Update git
        await gitAdd({ path: ctx.appPath, filepath: toOperationPath });
        try {
          await gitRemove({ path: ctx.appPath, filepath: fromOperationPath });
        } catch (error) {
          logger.warn(`Failed to git remove old file ${args.from}:`, error);
        }

        // Handle Supabase functions
        if (ctx.supabaseProjectId) {
          if (isServerFunction(fromOperationPath)) {
            try {
              await deleteSupabaseFunction({
                supabaseProjectId: ctx.supabaseProjectId,
                functionName: extractFunctionNameFromPath(fromOperationPath),
                organizationSlug: ctx.supabaseOrganizationSlug ?? null,
              });
            } catch (error) {
              logger.warn(
                `Failed to delete old Supabase function: ${args.from}`,
                error,
              );
            }
          }
          if (isServerFunction(toOperationPath)) {
            if (!ctx.isSharedModulesChanged) {
              try {
                const functionName =
                  extractFunctionNameFromPath(toOperationPath);
                await deploySupabaseFunction({
                  supabaseProjectId: ctx.supabaseProjectId,
                  functionName,
                  appPath: ctx.appPath,
                  organizationSlug: ctx.supabaseOrganizationSlug ?? null,
                });
              } catch (error) {
                return `File renamed, but failed to deploy Supabase function: ${error}`;
              }
            } else {
              try {
                ctx.pendingFunctionDeploys.push(
                  extractFunctionNameFromPath(toOperationPath),
                );
              } catch (error) {
                logger.warn(
                  `File renamed, but failed to identify Supabase function name: ${args.to}`,
                  error,
                );
              }
            }
          }
        }
      } else {
        logger.warn(`Source file for rename does not exist: ${fromFullPath}`);
      }

      queueCloudSandboxSnapshotSync({
        appId: ctx.appId,
        changedPaths: [toOperationPath],
        deletedPaths: [fromOperationPath],
      });

      return `Successfully renamed ${args.from} to ${args.to}`;
    },
  };
