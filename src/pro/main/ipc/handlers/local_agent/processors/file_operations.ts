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
import {
  describeSupabaseDeployScope,
  formatSupabaseDeployScopeTitleSuffix,
  type SupabaseDeployScope,
} from "../../../../../../supabase_admin/supabase_deploy_scope";
import { readSettings } from "../../../../../../main/settings";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type AgentContext,
} from "../tools/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  deleteSupabaseFunction,
  withSupabaseFunctionDeployment,
} from "@/supabase_admin/supabase_management_client";
import { isSupabaseFunctionSyncDeferred } from "@/supabase_admin/supabase_recording_deferred_sync";
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

export function renderSupabaseDeployStatus(
  progress: SupabaseDeployProgress,
  scope?: SupabaseDeployScope,
): string {
  const isComplete =
    progress.phase === "finished" || progress.phase === "failed";
  const title =
    (progress.phase === "finished"
      ? `Supabase functions deployed: ${progress.completed}/${progress.total} complete`
      : progress.phase === "failed"
        ? `Supabase functions failed to deploy: ${progress.completed}/${progress.total} complete`
        : `Deploying Supabase functions: ${progress.completed}/${progress.total} complete (${progress.active} active, ${progress.queued} queued)`) +
    formatSupabaseDeployScopeTitleSuffix(scope);
  const state =
    progress.phase === "failed"
      ? "aborted"
      : progress.phase === "finished"
        ? "finished"
        : "pending";
  const content = [
    ...(scope ? [describeSupabaseDeployScope(scope), ""] : []),
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
    | "abortSignal"
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
    return await withSupabaseFunctionDeployment(
      {
        appId: ctx.appId,
        supabaseProjectId,
        signal: ctx.abortSignal,
        operation: "reconcile Local Agent Supabase functions",
        sync: {
          organizationSlug: ctx.supabaseOrganizationSlug ?? null,
          functionNames: [
            ...ctx.pendingFunctionDeploys,
            ...(ctx.pendingFunctionDeletes ?? []),
          ],
          sharedModulesChanged: ctx.isSharedModulesChanged,
          sharedModulePaths: ctx.sharedServerModulePaths,
        },
      },
      async (operation, appPath) => {
        try {
          const deferred = await reconcileDeferredFunctionOperations({
            pendingDeploys: ctx.pendingFunctionDeploys,
            pendingDeletes: ctx.pendingFunctionDeletes ?? [],
            functionExists: (functionName) =>
              supabaseFunctionEntryExists(appPath, functionName),
          });
          const settings = readSettings();
          const preservedDeletes = settings.skipPruneEdgeFunctions
            ? deferred.deletes
            : [];
          const deleteErrors: string[] = [];
          let deletesProcessed = false;
          const deleteDeferredFunctions = async () => {
            // Check completion first: a late cancel after deletes already ran
            // must not turn a finished deployment into a reported failure.
            if (deletesProcessed) return;
            ctx.abortSignal?.throwIfAborted();
            deletesProcessed = true;
            operation.releaseResources(["repository", "provider"]);
            for (const functionName of settings.skipPruneEdgeFunctions
              ? []
              : deferred.deletes) {
              try {
                ctx.abortSignal?.throwIfAborted();
                await deleteSupabaseFunction({
                  supabaseProjectId,
                  functionName,
                  organizationSlug: ctx.supabaseOrganizationSlug ?? null,
                  signal: ctx.abortSignal,
                });
              } catch (error) {
                ctx.abortSignal?.throwIfAborted();
                // Deferred queues can contain a function that was created and removed
                // before root finalization, or one another path already removed.
                if (isSupabaseFunctionNotFoundError(error)) continue;
                deleteErrors.push(`${functionName}: ${error}`);
              }
            }
          };
          let deployErrors: string[] = [];
          let deployScope: SupabaseDeployScope | undefined;
          if (ctx.isSharedModulesChanged || deferred.deploys.length > 0) {
            try {
              deployErrors = await deployAffectedSupabaseFunctions({
                appPath,
                supabaseProjectId,
                supabaseOrganizationSlug: ctx.supabaseOrganizationSlug ?? null,
                skipPruneEdgeFunctions:
                  settings.skipPruneEdgeFunctions ?? false,
                sharedModulesChanged: ctx.isSharedModulesChanged,
                changedSharedModulePaths: ctx.sharedServerModulePaths,
                pendingFunctionDeploys: deferred.deploys,
                onSnapshotCaptured: deleteDeferredFunctions,
                signal: ctx.abortSignal,
                onScopeResolved: (scope) => {
                  deployScope = scope;
                },
                onProgress: (progress: SupabaseDeployProgress) => {
                  const statusXml = renderSupabaseDeployStatus(
                    progress,
                    deployScope,
                  );
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
            } catch (error) {
              ctx.abortSignal?.throwIfAborted();
              deployErrors.push(
                `Failed to prepare Supabase functions: ${error}`,
              );
            }
          }
          // Inventory/shared capture can fail before invoking the callback.
          // Confirmed removals must still run under deployment ownership.
          await deleteDeferredFunctions();

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
    if (isSupabaseFunctionSyncDeferred(error)) {
      return { success: true, warning: error.message };
    }
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
  ctx: Pick<
    AgentContext,
    "appId" | "appPath" | "fileMutationCount" | "supabaseProjectId"
  >,
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
        } else if ((ctx.fileMutationCount ?? 0) > 0) {
          // Another concurrent finalizer may already have checkpointed this
          // turn's shared-tree edits. Preserve an immutable review/restore
          // target instead of treating the clean checkpoint as hashless.
          try {
            commitHash = await getCurrentCommitHash({ path: ctx.appPath });
          } catch (error) {
            logger.warn("Failed to resolve the clean checkpoint HEAD", error);
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
    },
  );
}
