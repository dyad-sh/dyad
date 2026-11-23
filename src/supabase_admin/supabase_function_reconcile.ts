import { isSupabaseFunctionSyncDeferred } from "./supabase_recording_deferred_sync";

export interface SupabaseFunctionReconcileTarget {
  appId: number;
  /** The folder whose functions should be live: the app's own folder. */
  appPath: string;
  supabaseProjectId: string;
  organizationSlug: string | null;
  /**
   * The user's "keep extra functions" setting. When false, a named function
   * the folder no longer has is deleted from the project.
   */
  skipPruneEdgeFunctions: boolean;
  /**
   * Whether the deploy may also prune every deployed function the folder
   * lacks (subject to `skipPruneEdgeFunctions`), not just the named ones.
   * Off when other chats' worktrees may have deployed functions the app's
   * folder does not have yet.
   */
  pruneDanglingFunctions: boolean;
  functionNames: readonly string[];
  sharedModulesChanged: boolean;
  sharedModulePaths: readonly string[];
}

/**
 * Makes the named functions' deployments match `appPath`: deploys each one
 * the folder has, plus the ones its changed shared modules affect, and
 * deletes the rest unless the user keeps extra functions. Returns the
 * errors; throws `SupabaseFunctionSyncDeferredError` when a recording holds
 * the app (the sync is registered to run after it).
 */
export async function reconcileSupabaseFunctions(
  target: SupabaseFunctionReconcileTarget,
): Promise<string[]> {
  // Imported lazily, like the recording sync that also calls this: both
  // Supabase modules import the management client, which imports that one.
  const [utils, client] = await Promise.all([
    import("./supabase_utils"),
    import("./supabase_management_client"),
  ]);
  const deploys: string[] = [];
  const errors: string[] = [];
  for (const functionName of target.functionNames) {
    if (await utils.supabaseFunctionEntryExists(target.appPath, functionName)) {
      deploys.push(functionName);
    } else if (!target.skipPruneEdgeFunctions) {
      try {
        await client.deleteSupabaseFunction({
          appId: target.appId,
          supabaseProjectId: target.supabaseProjectId,
          functionName,
          organizationSlug: target.organizationSlug,
        });
      } catch (error) {
        if (isSupabaseFunctionSyncDeferred(error)) continue;
        if ((error as { response?: Response })?.response?.status !== 404) {
          errors.push(`delete ${functionName}: ${error}`);
        }
      }
    }
  }
  if (deploys.length > 0 || target.sharedModulesChanged) {
    errors.push(
      ...(await utils.deployAffectedSupabaseFunctions({
        appId: target.appId,
        appPath: target.appPath,
        supabaseProjectId: target.supabaseProjectId,
        supabaseOrganizationSlug: target.organizationSlug,
        skipPruneEdgeFunctions:
          target.skipPruneEdgeFunctions || !target.pruneDanglingFunctions,
        sharedModulesChanged: target.sharedModulesChanged,
        changedSharedModulePaths: [...target.sharedModulePaths],
        pendingFunctionDeploys: deploys,
      })),
    );
  }
  return errors;
}
