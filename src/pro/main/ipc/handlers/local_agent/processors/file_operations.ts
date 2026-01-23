/**
 * Shared file operations for both XML-based (Build mode) and Tool-based (Local Agent) processing
 */

import log from "electron-log";
import {
  gitCommit,
  gitAddAll,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
import { deployAllSupabaseFunctions } from "../../../../../../supabase_admin/supabase_utils";
import type { AgentContext } from "../tools/types";

const logger = log.scope("file_operations");

export interface FileOperationResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * Deploy all Supabase functions (after shared module changes)
 */
export async function deployAllFunctionsIfNeeded(
  ctx: Pick<
    AgentContext,
    | "appPath"
    | "supabaseProjectId"
    | "supabaseOrganizationSlug"
    | "isSharedModulesChanged"
  >,
): Promise<FileOperationResult> {
  if (!ctx.supabaseProjectId || !ctx.isSharedModulesChanged) {
    return { success: true };
  }

  try {
    logger.info("Shared modules changed, redeploying all Supabase functions");
    const deployErrors = await deployAllSupabaseFunctions({
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
      supabaseOrganizationSlug: ctx.supabaseOrganizationSlug ?? null,
    });

    if (deployErrors.length > 0) {
      return {
        success: true,
        warning: `Some Supabase functions failed to deploy: ${deployErrors.join(", ")}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to redeploy Supabase functions: ${error}`,
    };
  }
}

/**
 * Commit all changes
 */
export async function commitAllChanges(
  ctx: Pick<AgentContext, "appPath" | "supabaseProjectId">,
  chatSummary?: string,
): Promise<{
  commitHash?: string;
}> {
  try {
    // Check for uncommitted changes
    const uncommittedFiles = await getGitUncommittedFiles({
      path: ctx.appPath,
    });
    const message = chatSummary
      ? `[dyad] ${chatSummary}`
      : `[dyad] (${uncommittedFiles.length} files changed)`;
    let commitHash: string | undefined;

    if (uncommittedFiles.length > 0) {
      await gitAddAll({ path: ctx.appPath });
      try {
        commitHash = await gitCommit({
          path: ctx.appPath,
          message: message,
        });
      } catch (error) {
        logger.error(
          `Failed to commit extra files: ${uncommittedFiles.join(", ")}`,
          error,
        );
      }
    }

    return {
      commitHash,
    };
  } catch (error) {
    logger.error(`Failed to commit changes: ${error}`);
    throw new Error(`Failed to commit changes: ${error}`);
  }
}
