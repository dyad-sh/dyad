import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import {
  bulkUpdateFunctions,
  captureSupabaseFunction,
  captureSupabaseSharedFiles,
  deleteSupabaseFunction,
  deploySupabaseFunction,
  listSupabaseFunctions,
  withSupabaseFunctionDeployment,
  type DeployedFunctionResponse,
  type SupabaseFunctionSnapshot,
} from "./supabase_management_client";
import { SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY } from "./supabase_deploy_queue";
import type { DeferredSupabaseFunctionSync } from "./supabase_recording_deferred_sync";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { runSupabaseDependencyAnalysis } from "@/ipc/processors/supabase_dependency_analysis";
import type { SupabaseFunctionImpact } from "../../shared/supabase_dependency_analysis_types";

import {
  describeSupabaseFallbackReason,
  type SupabaseDeployScope,
} from "./supabase_deploy_scope";

export type { SupabaseFunctionImpact } from "../../shared/supabase_dependency_analysis_types";

const logger = log.scope("supabase_utils");

export interface SupabaseDeployProgress {
  phase: "deploying" | "finished" | "failed";
  total: number;
  active: number;
  queued: number;
  completed: number;
  succeeded: number;
  failed: number;
  functionName?: string;
}

export interface SupabaseDeploySummary {
  functionCount: number;
  prunedFunctionNames: string[];
}

export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: Array<PromiseSettledResult<R> | undefined> = Array.from({
    length: items.length,
  });
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await mapper(items[currentIndex], currentIndex),
        };
      } catch (reason) {
        results[currentIndex] = {
          status: "rejected",
          reason,
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.map((result) => result!);
}

/**
 * Extracts function name from Supabase edge function log event_message
 * Example: "[todo-activity] fetched 0 recent todos\n" -> "todo-activity"
 * @param eventMessage - The event_message string from the log
 * @returns The function name or undefined if not found
 */
export function extractFunctionName(eventMessage: string): string | undefined {
  const match = eventMessage.match(/^\[([^\]]+)\]/);
  return match ? match[1] : undefined;
}

/**
 * Checks if a file path is a Supabase edge function
 * (i.e., inside supabase/functions/ but NOT in _shared/)
 */
export function isServerFunction(filePath: string): boolean {
  return (
    filePath.startsWith("supabase/functions/") &&
    !filePath.startsWith("supabase/functions/_shared/")
  );
}

/**
 * Checks if a file path is a shared module in supabase/functions/_shared/
 */
export function isSharedServerModule(filePath: string): boolean {
  return filePath.startsWith("supabase/functions/_shared/");
}

export async function supabaseFunctionEntryExists(
  appPath: string,
  functionName: string,
): Promise<boolean> {
  try {
    await fs.access(
      path.join(appPath, "supabase", "functions", functionName, "index.ts"),
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Extracts the function name from a Supabase function file path.
 * Handles nested paths like "supabase/functions/hello/lib/utils.ts" → "hello"
 *
 * @param filePath - A path like "supabase/functions/{functionName}/..."
 * @returns The function name
 * @throws Error if the path is not a valid function path
 */
export function extractFunctionNameFromPath(filePath: string): string {
  // Normalize path separators to forward slashes
  const normalized = filePath.replace(/\\/g, "/");

  // Match the pattern: supabase/functions/{functionName}/...
  // The function name is the segment immediately after "supabase/functions/"
  const match = normalized.match(/^supabase\/functions\/([^/]+)/);

  if (!match) {
    throw new DyadError(
      `Invalid Supabase function path: ${filePath}. Expected format: supabase/functions/{functionName}/...`,
      DyadErrorKind.Validation,
    );
  }

  const functionName = match[1];

  // Exclude _shared and other special directories
  if (functionName.startsWith("_")) {
    throw new DyadError(
      `Invalid Supabase function path: ${filePath}. Function names starting with "_" are reserved for special directories.`,
      DyadErrorKind.Validation,
    );
  }

  return functionName;
}

async function getValidSupabaseFunctionNames(
  functionsDir: string,
): Promise<string[]> {
  const entries = await fs.readdir(functionsDir, { withFileTypes: true });
  const validFunctions: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const indexPath = path.join(functionsDir, entry.name, "index.ts");
    try {
      await fs.access(indexPath);
      validFunctions.push(entry.name);
    } catch {
      logger.warn(`Skipping ${entry.name}: index.ts not found at ${indexPath}`);
    }
  }

  return validFunctions;
}

export async function getSupabaseFunctionsAffectedBySharedModules({
  appPath,
  changedSharedModulePaths,
}: {
  appPath: string;
  changedSharedModulePaths: string[];
}): Promise<SupabaseFunctionImpact> {
  try {
    return await runSupabaseDependencyAnalysis({
      appPath,
      changedSharedModulePaths,
    });
  } catch (error) {
    logger.warn(
      "Supabase dependency analysis failed; deploying all functions",
      error,
    );
    return {
      kind: "all",
      reason: {
        code: "dependency_analysis_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

interface AppScopedDeployArgs {
  appId?: number;
  appPath: string;
  supabaseProjectId: string;
  onSnapshotCaptured?: () => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * With an `appId`, admits the deploy under the app's function-deployment
 * ownership, resolves the current app path, and releases the repository and
 * provider preparation claims once the batch snapshot is captured.
 */
function withAppDeploymentOwnership<Args extends AppScopedDeployArgs, Result>(
  { appId, ...args }: Args,
  sync: Omit<DeferredSupabaseFunctionSync, "supabaseProjectId">,
  deploy: (args: Omit<Args, "appId">) => Promise<Result>,
): Promise<Result> {
  if (appId === undefined) return deploy(args);
  return withSupabaseFunctionDeployment(
    {
      appId,
      supabaseProjectId: args.supabaseProjectId,
      signal: args.signal,
      sync,
    },
    (operation, appPath) =>
      deploy({
        ...args,
        appPath,
        onSnapshotCaptured: async () => {
          operation.releaseResources(["repository", "provider"]);
          await args.onSnapshotCaptured?.();
        },
      }),
  );
}

interface DeployAffectedSupabaseFunctionsArgs extends AppScopedDeployArgs {
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  sharedModulesChanged: boolean;
  changedSharedModulePaths: string[];
  pendingFunctionDeploys: string[];
  onProgress?: (progress: SupabaseDeployProgress) => void;
  /** Called with the chosen function set before any function deploys. */
  onScopeResolved?: (scope: SupabaseDeployScope) => void;
}

/**
 * Deploys the right Supabase function set after shared module changes and/or
 * deferred direct function deploys.
 */
export function deployAffectedSupabaseFunctions(
  args: DeployAffectedSupabaseFunctionsArgs,
): Promise<string[]> {
  return withAppDeploymentOwnership(
    args,
    {
      organizationSlug: args.supabaseOrganizationSlug,
      functionNames: args.pendingFunctionDeploys,
      sharedModulesChanged: args.sharedModulesChanged,
      sharedModulePaths: args.changedSharedModulePaths,
    },
    deployAffectedUnscoped,
  );
}

async function deployAffectedUnscoped({
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  skipPruneEdgeFunctions,
  sharedModulesChanged,
  changedSharedModulePaths,
  pendingFunctionDeploys,
  onProgress,
  onScopeResolved,
  onSnapshotCaptured,
  signal,
}: Omit<DeployAffectedSupabaseFunctionsArgs, "appId">): Promise<string[]> {
  const deployArgs = {
    appPath,
    supabaseProjectId,
    supabaseOrganizationSlug,
    skipPruneEdgeFunctions,
    onProgress,
    onSnapshotCaptured,
    signal,
  };

  if (sharedModulesChanged) {
    const impact =
      changedSharedModulePaths.length > 0
        ? await getSupabaseFunctionsAffectedBySharedModules({
            appPath,
            changedSharedModulePaths,
          })
        : ({
            kind: "all",
            reason: { code: "changed_shared_paths_missing" },
          } as const);

    if (impact.kind === "partial") {
      const functionNames = Array.from(
        new Set([...impact.functionNames, ...pendingFunctionDeploys]),
      );
      logger.info(
        functionNames.length > 0
          ? `Shared modules changed, redeploying affected Supabase functions: ${functionNames.join(", ")}`
          : "Shared modules changed, no affected Supabase functions to bundle",
      );
      onScopeResolved?.({
        kind: "affected",
        changedSharedModulePaths: Array.from(new Set(changedSharedModulePaths)),
        affectedFunctionNames: impact.functionNames,
        editedFunctionNames: Array.from(new Set(pendingFunctionDeploys)),
      });
      return deploySupabaseFunctionsUnscoped({
        ...deployArgs,
        functionNames,
      });
    }

    logger.info(
      `Shared module dependency analysis fell back to all functions (${impact.reason.code}): ${describeSupabaseFallbackReason(impact.reason)}`,
    );
    onScopeResolved?.({ kind: "all", reason: impact.reason });
    return deploySupabaseFunctionsUnscoped(deployArgs);
  }

  const functionNames = Array.from(new Set(pendingFunctionDeploys));
  logger.info(
    `Redeploying pending Supabase functions: ${functionNames.join(", ")}`,
  );
  onScopeResolved?.({ kind: "edited", functionNames });
  return deploySupabaseFunctionsUnscoped({
    ...deployArgs,
    functionNames,
  });
}

interface DeploySupabaseFunctionsArgs extends AppScopedDeployArgs {
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  functionNames?: string[];
  onProgress?: (progress: SupabaseDeployProgress) => void;
  onSummary?: (summary: SupabaseDeploySummary) => void;
}

/**
 * Deploys all Supabase edge functions found in the app's supabase/functions directory
 * @param appPath - The absolute path to the app directory
 * @param supabaseProjectId - The Supabase project ID
 * @param supabaseOrganizationSlug - The Supabase organization slug
 * @param skipPruneEdgeFunctions - If false, delete any deployed edge functions that are not in the codebase
 * @returns An array of error messages for functions that failed to deploy (empty if all succeeded)
 */
export function deploySupabaseFunctions(
  args: DeploySupabaseFunctionsArgs,
): Promise<string[]> {
  return withAppDeploymentOwnership(
    args,
    {
      organizationSlug: args.supabaseOrganizationSlug,
      functionNames: args.functionNames,
    },
    deploySupabaseFunctionsUnscoped,
  );
}

async function deploySupabaseFunctionsUnscoped({
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  skipPruneEdgeFunctions,
  functionNames,
  onProgress,
  onSnapshotCaptured,
  signal,
  onSummary,
}: Omit<DeploySupabaseFunctionsArgs, "appId">): Promise<string[]> {
  signal?.throwIfAborted();
  const functionsDir = path.join(appPath, "supabase", "functions");
  const prunedFunctionNames: string[] = [];
  let functionCount = 0;
  let reportFailure: (() => void) | undefined;
  const finish = (errors: string[]) => {
    onSummary?.({ functionCount, prunedFunctionNames });
    return errors;
  };

  try {
    await fs.access(functionsDir);
  } catch {
    logger.info(`No supabase/functions directory found at ${functionsDir}`);
    await onSnapshotCaptured?.();
    return finish([]);
  }

  const errors: string[] = [];

  try {
    const allValidFunctions = await getValidSupabaseFunctionNames(functionsDir);
    const allValidFunctionNames = new Set(allValidFunctions);
    const requestedFunctionNames = functionNames
      ? Array.from(new Set(functionNames))
      : undefined;
    const missingRequestedFunctionNames: string[] = [];
    const validFunctions = requestedFunctionNames
      ? requestedFunctionNames.filter((functionName) => {
          if (allValidFunctionNames.has(functionName)) {
            return true;
          }
          missingRequestedFunctionNames.push(functionName);
          logger.warn(
            `Skipping ${functionName}: index.ts not found in local functions directory`,
          );
          return false;
        })
      : allValidFunctions;
    functionCount = validFunctions.length;
    if (missingRequestedFunctionNames.length > 0) {
      const errorMessage = `Requested Supabase functions do not exist locally or are missing index.ts: ${missingRequestedFunctionNames.join(", ")}`;
      logger.error(errorMessage);
      errors.push(errorMessage);
    }

    logger.info(
      `Found ${validFunctions.length} functions to deploy in ${functionsDir}`,
    );

    if (validFunctions.length === 0) {
      logger.info("No valid functions to deploy");
      signal?.throwIfAborted();
      if (errors.length > 0) {
        await onSnapshotCaptured?.();
        return finish(errors);
      }
      // An empty complete local set is not enough evidence that every remote
      // function should be deleted. The project may have been connected with
      // remote-only production functions, or the last local function may have
      // just been removed. Manual whole-set sync therefore falls back to a
      // deploy-only no-op instead of pruning the entire remote project.
      if (allValidFunctions.length === 0) {
        await onSnapshotCaptured?.();
        return finish([]);
      }
    }

    logger.info(
      `Bundling ${validFunctions.length} functions with concurrency ${SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY}...`,
    );

    const totalFunctions = validFunctions.length;
    let activeFunctions = 0;
    let completedFunctions = 0;
    let succeededFunctions = 0;
    let failedFunctions = 0;

    function emitProgress(
      phase: SupabaseDeployProgress["phase"],
      functionName?: string,
    ) {
      onProgress?.({
        phase,
        total: totalFunctions,
        active: activeFunctions,
        queued: totalFunctions - activeFunctions - completedFunctions,
        completed: completedFunctions,
        succeeded: succeededFunctions,
        failed: failedFunctions,
        functionName,
      });
    }
    reportFailure = () => emitProgress("failed");

    if (validFunctions.length > 0) {
      emitProgress("deploying");
    }

    const sharedFiles =
      validFunctions.length > 0
        ? await captureSupabaseSharedFiles(appPath)
        : [];
    // Entries are cleared once bundled so a large batch does not keep every
    // captured file alive through activation and pruning.
    const snapshots: Array<
      PromiseSettledResult<SupabaseFunctionSnapshot> | undefined
    > = await mapSettledWithConcurrency(
      validFunctions,
      SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY,
      async (functionName) => {
        signal?.throwIfAborted();
        return captureSupabaseFunction({ appPath, functionName, sharedFiles });
      },
    );
    signal?.throwIfAborted();
    await onSnapshotCaptured?.();
    signal?.throwIfAborted();

    const deployResults = await mapSettledWithConcurrency(
      validFunctions,
      SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY,
      async (functionName, index) => {
        activeFunctions++;
        emitProgress("deploying", functionName);
        logger.info(`Bundling function: ${functionName}`);
        try {
          signal?.throwIfAborted();
          const snapshot = snapshots[index]!;
          snapshots[index] = undefined;
          if (snapshot.status === "rejected") throw snapshot.reason;
          const result = await deploySupabaseFunction({
            supabaseProjectId,
            organizationSlug: supabaseOrganizationSlug,
            functionName,
            appPath,
            bundleOnly: true,
            snapshot: snapshot.value,
            signal,
          });
          succeededFunctions++;
          logger.info(`Successfully bundled function: ${functionName}`);
          return result;
        } catch (error) {
          failedFunctions++;
          throw error;
        } finally {
          activeFunctions--;
          completedFunctions++;
          emitProgress("deploying", functionName);
        }
      },
    );

    signal?.throwIfAborted();

    // Collect successful results and errors
    const successfulDeploys: DeployedFunctionResponse[] = [];
    for (let i = 0; i < deployResults.length; i++) {
      const result = deployResults[i];
      const functionName = validFunctions[i];

      if (result.status === "fulfilled") {
        successfulDeploys.push(result.value);
      } else {
        const errorMessage = `Failed to bundle ${functionName}: ${result.reason?.message || result.reason}`;
        logger.error(errorMessage, result.reason);
        errors.push(errorMessage);
      }
    }

    const activationSucceeded = successfulDeploys.length > 0;

    // Bulk update all successfully bundled functions to activate them
    if (successfulDeploys.length > 0) {
      logger.info(
        `Activating ${successfulDeploys.length} functions via bulk update...`,
      );
      try {
        await bulkUpdateFunctions({
          supabaseProjectId,
          functions: successfulDeploys,
          signal,
          organizationSlug: supabaseOrganizationSlug,
        });
        logger.info(
          `Successfully activated ${successfulDeploys.length} functions`,
        );
      } catch (error: any) {
        signal?.throwIfAborted();
        const errorMessage = `Failed to bulk update functions: ${error.message}`;
        logger.error(errorMessage, error);
        errors.push(errorMessage);
      }
    }

    // Prune dangling edge functions (deployed but not in codebase)
    if (!skipPruneEdgeFunctions) {
      try {
        logger.info("Checking for dangling edge functions to prune...");
        const deployedFunctions = await listSupabaseFunctions({
          supabaseProjectId,
          organizationSlug: supabaseOrganizationSlug,
          signal,
        });

        const localFunctionNames = new Set(allValidFunctions);
        const danglingFunctions = deployedFunctions.filter(
          (fn) => !localFunctionNames.has(fn.slug),
        );

        if (danglingFunctions.length > 0) {
          logger.info(
            `Found ${danglingFunctions.length} dangling edge functions to prune: ${danglingFunctions.map((fn) => fn.slug).join(", ")}`,
          );

          for (const fn of danglingFunctions) {
            try {
              await deleteSupabaseFunction({
                supabaseProjectId,
                functionName: fn.slug,
                organizationSlug: supabaseOrganizationSlug,
                signal,
              });
              prunedFunctionNames.push(fn.slug);
              logger.info(`Pruned dangling edge function: ${fn.slug}`);
            } catch (deleteError: any) {
              signal?.throwIfAborted();
              const errorMessage = `Failed to prune edge function ${fn.slug}: ${deleteError.message}`;
              logger.error(errorMessage, deleteError);
              errors.push(errorMessage);
            }
          }
        } else {
          logger.info("No dangling edge functions found");
        }
      } catch (pruneError: any) {
        signal?.throwIfAborted();
        const errorMessage = `Failed to check for dangling edge functions: ${pruneError.message}`;
        logger.error(errorMessage, pruneError);
        errors.push(errorMessage);
      }
    }

    if (validFunctions.length > 0) {
      emitProgress(
        errors.length === 0 && activationSucceeded ? "finished" : "failed",
      );
    }
  } catch (error: any) {
    reportFailure?.();
    signal?.throwIfAborted();
    const errorMessage = `Error reading functions directory: ${error.message}`;
    logger.error(errorMessage, error);
    errors.push(errorMessage);
  }

  return finish(errors);
}

/**
 * Deploys all Supabase edge functions found in the app's supabase/functions directory
 * @param appPath - The absolute path to the app directory
 * @param supabaseProjectId - The Supabase project ID
 * @param supabaseOrganizationSlug - The Supabase organization slug
 * @param skipPruneEdgeFunctions - If false, delete any deployed edge functions that are not in the codebase
 * @returns An array of error messages for functions that failed to deploy (empty if all succeeded)
 */
export async function deployAllSupabaseFunctions(args: {
  appId?: number;
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  onProgress?: (progress: SupabaseDeployProgress) => void;
  onSnapshotCaptured?: () => void | Promise<void>;
  signal?: AbortSignal;
  onSummary?: (summary: SupabaseDeploySummary) => void;
}): Promise<string[]> {
  return deploySupabaseFunctions(args);
}
