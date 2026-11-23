import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { reconcileSupabaseFunctions } from "@/supabase_admin/supabase_function_reconcile";
import { isSupabaseFunctionSyncDeferred } from "@/supabase_admin/supabase_recording_deferred_sync";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "@/supabase_admin/supabase_utils";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";

const logger = log.scope("workspace_supabase_sync");

/** The edge functions and shared modules a set of changed files touches. */
export interface SupabaseFunctionChanges {
  functionNames: string[];
  sharedModulePaths: string[];
}

/**
 * The edge functions and `_shared` modules among `appRelativePaths`, or
 * null when there are none.
 */
export function findSupabaseFunctionChanges(
  appRelativePaths: Iterable<string>,
): SupabaseFunctionChanges | null {
  const functionNames = new Set<string>();
  const sharedModulePaths = new Set<string>();
  for (const raw of appRelativePaths) {
    const file = raw.replace(/\\/g, "/");
    if (isSharedServerModule(file)) {
      sharedModulePaths.add(file);
    } else if (isServerFunction(file)) {
      try {
        functionNames.add(extractFunctionNameFromPath(file));
      } catch {
        // Another reserved folder under supabase/functions (`_`-prefixed).
      }
    }
  }
  return functionNames.size > 0 || sharedModulePaths.size > 0
    ? {
        functionNames: [...functionNames].sort(),
        sharedModulePaths: [...sharedModulePaths].sort(),
      }
    : null;
}

/** Whether the app deploys edge functions to a Supabase project. */
export async function appUsesSupabase(appId: number): Promise<boolean> {
  const app = await db.query.apps.findFirst({
    columns: { supabaseProjectId: true },
    where: eq(apps.id, appId),
  });
  return Boolean(app?.supabaseProjectId);
}

export type SupabaseResyncReason = "merged" | "worktree-deleted";

const pendingResyncs = new Set<Promise<void>>();

/**
 * A worktree turn deploys its own version of an edge function to the app's
 * one Supabase project right away, so the chat's preview can call it. Once
 * that work merges, or its worktree is deleted with the work unmerged, make
 * those functions match the app's main folder again: deploy what the folder
 * has and delete what it lacks (unless the user keeps extra functions). It
 * never prunes other functions: another chat's worktree may have deployed
 * one the main folder does not have yet.
 *
 * Starts in the background: call it after releasing every claim, like any
 * other redeploy. A failure reaches the user as a toast.
 */
export function resyncSupabaseFunctionsFromApp({
  appId,
  changes,
  reason,
}: {
  appId: number;
  changes: SupabaseFunctionChanges;
  reason: SupabaseResyncReason;
}): void {
  const task = resync(appId, changes, reason).finally(() =>
    pendingResyncs.delete(task),
  );
  pendingResyncs.add(task);
}

/** Resolves once every resync started so far has settled. */
export async function waitForSupabaseFunctionResyncs(): Promise<void> {
  await Promise.allSettled(pendingResyncs);
}

async function resync(
  appId: number,
  changes: SupabaseFunctionChanges,
  reason: SupabaseResyncReason,
): Promise<void> {
  try {
    const app = await db.query.apps.findFirst({
      columns: {
        path: true,
        supabaseProjectId: true,
        supabaseOrganizationSlug: true,
      },
      where: eq(apps.id, appId),
    });
    if (!app?.supabaseProjectId) return;
    logger.info(
      `Redeploying Supabase functions from app ${appId}'s main folder (${reason}): ${[...changes.functionNames, ...changes.sharedModulePaths].join(", ")}`,
    );
    const errors = await reconcileSupabaseFunctions({
      appId,
      appPath: getDyadAppPath(app.path),
      supabaseProjectId: app.supabaseProjectId,
      organizationSlug: app.supabaseOrganizationSlug ?? null,
      skipPruneEdgeFunctions: readSettings().skipPruneEdgeFunctions ?? false,
      pruneDanglingFunctions: false,
      functionNames: changes.functionNames,
      sharedModulesChanged: changes.sharedModulePaths.length > 0,
      sharedModulePaths: changes.sharedModulePaths,
    });
    if (errors.length > 0) {
      reportFailure(appId, reason, errors.join(", "));
    }
  } catch (error) {
    if (isSupabaseFunctionSyncDeferred(error)) {
      // Registered to run once the app's recording ends.
      logger.info(
        `Deferred redeploying Supabase functions for app ${appId} until its recording ends`,
      );
      return;
    }
    reportFailure(appId, reason, String(error));
  }
}

function reportFailure(
  appId: number,
  reason: SupabaseResyncReason,
  detail: string,
): void {
  logger.warn(
    `Redeploying Supabase functions for app ${appId} (${reason}) failed: ${detail}`,
  );
  try {
    const target = windowRegistry.routePresentation({
      effect: "ordinary",
      entity: { kind: "app", id: appId },
    });
    if (!target) return;
    const what =
      reason === "merged"
        ? "the Supabase functions a chat's merged work changed"
        : "the Supabase functions a deleted worktree had changed";
    windowRegistry.endpointForSession(target)?.send("toast:error", {
      message: `Dyad couldn't redeploy ${what} from the app's main folder: ${detail}. The deployed functions may not match the app's code. Use "Redeploy edge functions" in the Supabase panel to sync them.`,
      persist: true,
      toastId: `supabase-worktree-resync-${appId}`,
    });
  } catch (error) {
    logger.warn(
      `Failed to report a Supabase function redeploy failure for app ${appId}`,
      error,
    );
  }
}
