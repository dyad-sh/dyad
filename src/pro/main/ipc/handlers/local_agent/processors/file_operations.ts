/**
 * Shared file operations for both XML-based (Build mode) and Tool-based (Local Agent) processing
 */

import log from "electron-log";
import {
  gitCommit,
  gitAddAll,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
import {
  deployAllSupabaseFunctions,
  deploySupabaseFunctions,
  getSupabaseFunctionsAffectedBySharedModules,
  type SupabaseDeployProgress,
} from "../../../../../../supabase_admin/supabase_utils";
import { readSettings } from "../../../../../../main/settings";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type AgentContext,
} from "../tools/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("file_operations");

export interface FileOperationResult {
  success: boolean;
  error?: string;
  warning?: string;
}

function renderSupabaseDeployStatus(progress: SupabaseDeployProgress): string {
  const isComplete =
    progress.phase === "finished" || progress.phase === "failed";
  const title =
    progress.phase === "finished"
      ? `Supabase functions deployed: ${progress.completed}/${progress.total} complete`
      : progress.phase === "failed"
        ? `Supabase functions failed to deploy: ${progress.completed}/${progress.total} complete`
        : `Deploying Supabase functions: ${progress.completed}/${progress.total} complete (${progress.active} active, ${progress.queued} queued)`;
  const state =
    progress.phase === "failed"
      ? "aborted"
      : progress.phase === "finished"
        ? "finished"
        : "in-progress";
  const content = [
    `${progress.succeeded} succeeded`,
    `${progress.failed} failed`,
    `${progress.active} active`,
    `${progress.queued} queued`,
  ];
  if (progress.functionName) {
    content.push(`Latest: ${progress.functionName}`);
  }

  return `<dyad-status title="${escapeXmlAttr(title)}" state="${state}">\n${escapeXmlContent(content.join("\n"))}${isComplete ? "\n</dyad-status>" : ""}`;
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
    | "sharedServerModulePaths"
    | "pendingFunctionDeploys"
    | "onXmlStream"
    | "onXmlComplete"
  >,
): Promise<FileOperationResult> {
  if (
    !ctx.supabaseProjectId ||
    (!ctx.isSharedModulesChanged && ctx.pendingFunctionDeploys.length === 0)
  ) {
    return { success: true };
  }

  try {
    const settings = readSettings();
    const deployArgs = {
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
      supabaseOrganizationSlug: ctx.supabaseOrganizationSlug ?? null,
      skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
      onProgress: (progress: SupabaseDeployProgress) => {
        const statusXml = renderSupabaseDeployStatus(progress);
        if (progress.phase === "finished" || progress.phase === "failed") {
          ctx.onXmlComplete(statusXml);
        } else {
          ctx.onXmlStream(statusXml);
        }
      },
    };

    let deployErrors: string[];
    if (ctx.isSharedModulesChanged) {
      const impact =
        ctx.sharedServerModulePaths.length > 0
          ? await getSupabaseFunctionsAffectedBySharedModules({
              appPath: ctx.appPath,
              changedSharedModulePaths: ctx.sharedServerModulePaths,
            })
          : ({
              kind: "all",
              reason: "changed_shared_paths_missing",
            } as const);

      if (impact.kind === "partial") {
        const functionNames = Array.from(
          new Set([...impact.functionNames, ...ctx.pendingFunctionDeploys]),
        );
        if (functionNames.length === 0) {
          logger.info(
            "Shared modules changed, no affected Supabase functions to redeploy",
          );
          return { success: true };
        }
        logger.info(
          `Shared modules changed, redeploying affected Supabase functions: ${functionNames.join(", ")}`,
        );
        deployErrors = await deploySupabaseFunctions({
          ...deployArgs,
          functionNames,
        });
      } else {
        logger.info(
          `Shared module dependency analysis fell back to all functions: ${impact.reason}`,
        );
        deployErrors = await deployAllSupabaseFunctions(deployArgs);
      }
    } else {
      const functionNames = Array.from(new Set(ctx.pendingFunctionDeploys));
      logger.info(
        `Redeploying pending Supabase functions: ${functionNames.join(", ")}`,
      );
      deployErrors = await deploySupabaseFunctions({
        ...deployArgs,
        functionNames,
      });
    }

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
    throw new DyadError(
      `Failed to commit changes: ${error}`,
      DyadErrorKind.External,
    );
  }
}
