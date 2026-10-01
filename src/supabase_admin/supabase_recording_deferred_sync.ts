import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";

const logger = log.scope("supabase_recording_deferred_sync");

/** What a refused deployment would have synced. */
export interface DeferredSupabaseFunctionSync {
  supabaseProjectId: string;
  organizationSlug: string | null;
  /** Functions to reconcile; `undefined` means every local function. */
  functionNames?: readonly string[];
  sharedModulesChanged?: boolean;
  sharedModulePaths?: readonly string[];
}

interface PendingSync {
  supabaseProjectId: string;
  organizationSlug: string | null;
  allFunctions: boolean;
  functionNames: Set<string>;
  sharedModulesChanged: boolean;
  sharedModulePaths: Set<string>;
}

const pendingByApp = new Map<number, PendingSync>();

/**
 * Thrown instead of deploying while a recording holds the app's
 * `supabase-functions` claim. The work is not lost: it is registered here and
 * reconciled once the recording's claims are released.
 */
export class SupabaseFunctionSyncDeferredError extends DyadError {
  constructor() {
    super(
      "A recording session is active, so Dyad will deploy this Supabase function change after the recording ends.",
      DyadErrorKind.Precondition,
    );
    this.name = "SupabaseFunctionSyncDeferredError";
  }
}

export function isSupabaseFunctionSyncDeferred(
  error: unknown,
): error is SupabaseFunctionSyncDeferredError {
  return error instanceof SupabaseFunctionSyncDeferredError;
}

/**
 * Register a function sync to run after the app's active recording ends.
 * Returns false when no recording session is active. Must be called in the
 * same synchronous step as the deployment admission it replaces.
 */
export function deferSupabaseFunctionSyncForRecording(
  appId: number,
  sync: DeferredSupabaseFunctionSync,
): boolean {
  const recording = activeRecordings.get(appId);
  if (!recording) return false;

  let pending = pendingByApp.get(appId);
  if (pending && pending.supabaseProjectId !== sync.supabaseProjectId) {
    // The project changed mid-recording; the earlier target is stale.
    pending = undefined;
  }
  if (!pending) {
    pending = {
      supabaseProjectId: sync.supabaseProjectId,
      organizationSlug: sync.organizationSlug,
      allFunctions: false,
      functionNames: new Set(),
      sharedModulesChanged: false,
      sharedModulePaths: new Set(),
    };
    pendingByApp.set(appId, pending);
    // `done` settles after the session releases its coordinator claims.
    void recording.done.then(() => flushDeferredSupabaseFunctionSync(appId));
  }
  if (sync.functionNames === undefined) {
    pending.allFunctions = true;
  } else {
    for (const name of sync.functionNames) pending.functionNames.add(name);
  }
  if (sync.sharedModulesChanged) pending.sharedModulesChanged = true;
  for (const modulePath of sync.sharedModulePaths ?? []) {
    pending.sharedModulePaths.add(modulePath);
  }
  logger.info(
    `Deferred Supabase function sync for app ${appId} until its recording ends`,
  );
  return true;
}

/** Reconcile what recordings deferred: deploy what exists, delete the rest. */
export async function flushDeferredSupabaseFunctionSync(
  appId: number,
): Promise<void> {
  const pending = pendingByApp.get(appId);
  if (!pending) return;
  pendingByApp.delete(appId);
  try {
    // Imported lazily: both Supabase modules import the management client,
    // which imports this one, and the database stays out of its load path.
    const [utils, client, { db }, { apps }, { eq }] = await Promise.all([
      import("./supabase_utils"),
      import("./supabase_management_client"),
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);
    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app || app.supabaseProjectId !== pending.supabaseProjectId) {
      logger.info(
        `Skipping deferred Supabase function sync for app ${appId}: its project changed`,
      );
      return;
    }
    const appPath = getDyadAppPath(app.path);
    const skipPruneEdgeFunctions =
      readSettings().skipPruneEdgeFunctions ?? false;
    const target = {
      appId,
      appPath,
      supabaseProjectId: pending.supabaseProjectId,
      supabaseOrganizationSlug: pending.organizationSlug,
      skipPruneEdgeFunctions,
    };
    let errors: string[];
    if (pending.allFunctions) {
      errors = await utils.deployAllSupabaseFunctions(target);
    } else {
      const deploys: string[] = [];
      errors = [];
      for (const functionName of pending.functionNames) {
        if (await utils.supabaseFunctionEntryExists(appPath, functionName)) {
          deploys.push(functionName);
        } else if (!skipPruneEdgeFunctions) {
          try {
            await client.deleteSupabaseFunction({
              appId,
              supabaseProjectId: pending.supabaseProjectId,
              functionName,
              organizationSlug: pending.organizationSlug,
            });
          } catch (error) {
            if (isSupabaseFunctionSyncDeferred(error)) continue;
            if ((error as { response?: Response })?.response?.status !== 404) {
              errors.push(`delete ${functionName}: ${error}`);
            }
          }
        }
      }
      if (deploys.length > 0 || pending.sharedModulesChanged) {
        errors.push(
          ...(await utils.deployAffectedSupabaseFunctions({
            ...target,
            sharedModulesChanged: pending.sharedModulesChanged,
            changedSharedModulePaths: [...pending.sharedModulePaths],
            pendingFunctionDeploys: deploys,
          })),
        );
      }
    }
    if (errors.length > 0) {
      logger.warn(
        `Deferred Supabase function sync for app ${appId} had errors: ${errors.join(", ")}`,
      );
      await reportDeferredSyncFailure(appId, errors.join(", "));
    }
  } catch (error) {
    // A newer recording defers again through the same admission path.
    if (isSupabaseFunctionSyncDeferred(error)) return;
    logger.error(
      `Deferred Supabase function sync failed for app ${appId}`,
      error,
    );
    await reportDeferredSyncFailure(appId, String(error));
  }
}

/**
 * The user was told this deploy would happen after the recording, so a
 * failure must reach them rather than only the logs.
 */
async function reportDeferredSyncFailure(
  appId: number,
  detail: string,
): Promise<void> {
  try {
    const { windowRegistry } =
      await import("@/window_infrastructure/main/window_registry");
    const target = windowRegistry.routePresentation({
      effect: "ordinary",
      entity: { kind: "app", id: appId },
    });
    if (!target) return;
    windowRegistry.endpointForSession(target)?.send("toast:error", {
      message: `Dyad couldn't deploy the Supabase function changes made during the recording: ${detail}. Use "Redeploy edge functions" in the Supabase panel to sync them.`,
      persist: true,
      toastId: `supabase-deferred-sync-${appId}`,
    });
  } catch (error) {
    logger.warn(
      `Failed to report deferred Supabase function sync failure for app ${appId}`,
      error,
    );
  }
}

export function resetDeferredSupabaseFunctionSyncForTests() {
  pendingByApp.clear();
}
