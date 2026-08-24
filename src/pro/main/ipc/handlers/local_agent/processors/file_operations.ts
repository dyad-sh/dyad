/**
 * Shared file operations for both XML-based (Build mode) and Tool-based (Local Agent) processing
 */

import log from "electron-log";
import {
  gitCommit,
  gitAddAll,
  getCurrentCommitHash,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
import {
  deployAffectedSupabaseFunctions,
  supabaseFunctionEntryExists,
  type SupabaseDeployProgress,
} from "../../../../../../supabase_admin/supabase_utils";
import { readSettings } from "../../../../../../main/settings";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type AgentContext,
} from "../tools/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { deleteSupabaseFunction } from "@/supabase_admin/supabase_management_client";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";

const logger = log.scope("file_operations");

export interface FileOperationResult {
  success: boolean;
  error?: string;
  warning?: string;
}

export { supabaseFunctionEntryExists } from "../../../../../../supabase_admin/supabase_utils";

export function isSupabaseFunctionNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: unknown } }).response?.status === 404
  );
}

export async function reconcileDeferredFunctionOperations(params: {
  pendingDeploys: string[];
  pendingDeletes: string[];
  functionExists: (functionName: string) => boolean | Promise<boolean>;
}): Promise<{ deploys: string[]; deletes: string[] }> {
  const deploys = new Set<string>();
  const deletes = new Set<string>();
  const affectedFunctions = new Set([
    ...params.pendingDeploys,
    ...params.pendingDeletes,
  ]);
  for (const functionName of affectedFunctions) {
    if (await params.functionExists(functionName)) {
      // The final local function exists, so deploy its final contents.
      deploys.add(functionName);
    } else {
      // The final local function is absent, so do not deploy a stale version.
      deletes.add(functionName);
    }
  }
  return { deploys: [...deploys], deletes: [...deletes] };
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
    | "appId"
    | "appPath"
    | "supabaseProjectId"
    | "supabaseOrganizationSlug"
    | "isSharedModulesChanged"
    | "sharedServerModulePaths"
    | "pendingFunctionDeploys"
    | "pendingFunctionDeletes"
    | "onXmlStream"
    | "onXmlComplete"
  >,
): Promise<FileOperationResult> {
  if (
    !ctx.supabaseProjectId ||
    (!ctx.isSharedModulesChanged &&
      ctx.pendingFunctionDeploys.length === 0 &&
      (ctx.pendingFunctionDeletes?.length ?? 0) === 0)
  ) {
    return { success: true };
  }
  const supabaseProjectId = ctx.supabaseProjectId;

  try {
    return await appOperationCoordinator.run(
      {
        appId: ctx.appId,
        operation: "reconcile Local Agent Supabase functions",
        resources: [readAppResource("app-path"), "provider"],
        refuseWhenRecording: "deploy Supabase functions",
      },
      async () => {
        try {
          const deferred = await reconcileDeferredFunctionOperations({
            pendingDeploys: ctx.pendingFunctionDeploys,
            pendingDeletes: ctx.pendingFunctionDeletes ?? [],
            functionExists: (functionName) =>
              supabaseFunctionEntryExists(ctx.appPath, functionName),
          });
          const settings = readSettings();
          const preservedDeletes = settings.skipPruneEdgeFunctions
            ? deferred.deletes
            : [];
          const deleteErrors: string[] = [];
          for (const functionName of settings.skipPruneEdgeFunctions
            ? []
            : deferred.deletes) {
            try {
              await deleteSupabaseFunction({
                supabaseProjectId,
                functionName,
                organizationSlug: ctx.supabaseOrganizationSlug ?? null,
              });
            } catch (error) {
              // Deferred queues can contain a function that was created and removed
              // before root finalization, or one another path already removed.
              if (isSupabaseFunctionNotFoundError(error)) continue;
              deleteErrors.push(`${functionName}: ${error}`);
            }
          }
          let deployErrors: string[] = [];
          if (ctx.isSharedModulesChanged || deferred.deploys.length > 0) {
            deployErrors = await deployAffectedSupabaseFunctions({
              appPath: ctx.appPath,
              supabaseProjectId,
              supabaseOrganizationSlug: ctx.supabaseOrganizationSlug ?? null,
              skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
              sharedModulesChanged: ctx.isSharedModulesChanged,
              changedSharedModulePaths: ctx.sharedServerModulePaths,
              pendingFunctionDeploys: deferred.deploys,
              onProgress: (progress: SupabaseDeployProgress) => {
                const statusXml = renderSupabaseDeployStatus(progress);
                if (
                  progress.phase === "finished" ||
                  progress.phase === "failed"
                ) {
                  ctx.onXmlComplete(statusXml);
                } else {
                  ctx.onXmlStream(statusXml);
                }
              },
            });
          }

          if (
            preservedDeletes.length > 0 ||
            deleteErrors.length > 0 ||
            deployErrors.length > 0
          ) {
            const warnings: string[] = [];
            if (preservedDeletes.length > 0) {
              warnings.push(
                `Kept remote Supabase function(s) ${preservedDeletes.join(", ")} because "Keep extra Supabase edge functions" is enabled.`,
              );
            }
            if (deleteErrors.length > 0 || deployErrors.length > 0) {
              warnings.push(
                deleteErrors.length === 0
                  ? `Some Supabase functions failed to deploy: ${deployErrors.join(", ")}`
                  : `Some Supabase function operations failed: ${[
                      ...deleteErrors.map((error) => `delete ${error}`),
                      ...deployErrors,
                    ].join(", ")}`,
              );
            }
            return {
              success: true,
              warning: warnings.join(" "),
            };
          }

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `Failed to redeploy Supabase functions: ${error}`,
          };
        }
      },
    );
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
  ctx: Pick<AgentContext, "appId" | "appPath" | "supabaseProjectId">,
  chatSummary?: string,
): Promise<{
  commitHash?: string;
}> {
  return appOperationCoordinator.run(
    {
      appId: ctx.appId,
      operation: "commit current Local Agent app changes",
      resources: [readAppResource("app-path"), "repository"],
      refuseWhenRecording: "create a Local Agent checkpoint",
    },
    async () => {
      try {
        // Check for uncommitted changes
        const uncommittedFiles = await getGitUncommittedFiles({
          path: ctx.appPath,
        });
        const trimmedChatSummary = chatSummary?.trim();
        const message =
          trimmedChatSummary || `(${uncommittedFiles.length} files changed)`;
        let commitHash: string | undefined;

        if (uncommittedFiles.length > 0) {
          await gitAddAll({ path: ctx.appPath });
          try {
            commitHash = await gitCommit({
              path: ctx.appPath,
              message: message,
              // Low-level gitCommit is hook-free. Local Agent verification is
              // owned by run_pre_commit so a failing hook cannot prevent versioning.
            });
          } catch (error) {
            logger.error(
              `Failed to commit extra files: ${uncommittedFiles.join(", ")}`,
              error,
            );
          }
        } else {
          // Another concurrent finalizer may already have checkpointed this
          // turn's shared-tree edits. Preserve an immutable review/restore
          // target instead of treating the clean checkpoint as hashless.
          commitHash = await getCurrentCommitHash({ path: ctx.appPath });
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
    },
  );
}
