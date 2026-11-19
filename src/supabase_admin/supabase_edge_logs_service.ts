/**
 * Supabase Edge Function logs for an app's linked project, served from the
 * shared main-process cache. Background polling (the getEdgeLogs IPC) and the
 * agent's read_logs tool both read through here, so overlapping requests
 * share fetches and cached rows. See supabase_log_cache.ts for the caching
 * and freshness policy.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { ConsoleEntry } from "@/ipc/types";
import { hasSupabaseCredentialsForOrganization } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import {
  SupabaseLogCache,
  type SupabaseLogQueryResult,
  type SupabaseLogScope,
  type TimeRange,
} from "./supabase_log_cache";
import { getSupabaseProjectLogs } from "./supabase_management_client";
import { extractFunctionName } from "./supabase_utils";

export const supabaseFunctionLogCache = new SupabaseLogCache({
  fetchPage: async ({ scope, start, end, limit, signal }) => {
    const response = await getSupabaseProjectLogs(scope.projectRef, {
      organizationSlug: scope.organizationSlug,
      timestampStart: start,
      timestampEnd: end,
      limit,
      signal,
    });
    if (response.error) {
      const detail =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error);
      throw new DyadError(
        `Supabase returned an error for the logs query: ${detail}`,
        DyadErrorKind.External,
      );
    }
    return response.result;
  },
});

/** The Supabase project an app's Edge Function logs come from. */
export interface AppSupabaseLogTarget {
  appId: number;
  /** Project ref, or the branch's project ref when a branch is selected. */
  projectId: string;
  organizationSlug: string | null;
}

/**
 * Resolves the project/branch and organization from the app's association.
 * Null when the app has no Supabase project or Dyad holds no credentials
 * for its organization, in which case no Supabase logs are fetched.
 */
export function resolveAppSupabaseLogTarget(app: {
  id: number;
  supabaseProjectId: string | null;
  supabaseOrganizationSlug: string | null;
}): AppSupabaseLogTarget | null {
  if (!app.supabaseProjectId) return null;
  if (
    !hasSupabaseCredentialsForOrganization(
      readSettings(),
      app.supabaseOrganizationSlug,
    )
  ) {
    return null;
  }
  return {
    appId: app.id,
    projectId: app.supabaseProjectId,
    organizationSlug: app.supabaseOrganizationSlug ?? null,
  };
}

/** Whether the app is still linked to the target's project and organization. */
export async function isAppStillLinkedTo(
  target: AppSupabaseLogTarget,
): Promise<boolean> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, target.appId),
    columns: { supabaseProjectId: true, supabaseOrganizationSlug: true },
  });
  return (
    !!app &&
    app.supabaseProjectId === target.projectId &&
    (app.supabaseOrganizationSlug ?? null) === target.organizationSlug
  );
}

export interface AppEdgeFunctionLogsResult {
  /** Rows inside the requested window as console entries, oldest first. */
  entries: ConsoleEntry[];
  missingRanges: TimeRange[];
  truncated: boolean;
  error: unknown;
  /**
   * The app was relinked while the logs were fetched. Entries are empty:
   * the previous project's logs must not be attributed to this app.
   */
  associationChanged: boolean;
}

/** Fetches the target's Edge Function logs in [start, end). */
export async function getAppEdgeFunctionLogs({
  target,
  start,
  end,
  signal,
}: {
  target: AppSupabaseLogTarget;
  start: number;
  end: number;
  signal?: AbortSignal;
}): Promise<AppEdgeFunctionLogsResult> {
  const scope: SupabaseLogScope = {
    organizationSlug: target.organizationSlug,
    projectRef: target.projectId,
    source: "function_logs",
  };
  const result: SupabaseLogQueryResult = await supabaseFunctionLogCache.query({
    scope,
    start,
    end,
    signal,
  });
  if (!(await isAppStillLinkedTo(target))) {
    return {
      entries: [],
      missingRanges: [{ start, end }],
      truncated: false,
      error: null,
      associationChanged: true,
    };
  }
  return {
    entries: result.logs.map((entry) => ({
      level: entry.level,
      type: "edge-function" as const,
      message: entry.message,
      timestamp: entry.timestamp,
      sourceName: extractFunctionName(entry.message),
      appId: target.appId,
      providerLogId: entry.id,
    })),
    missingRanges: result.missingRanges,
    truncated: result.truncated,
    error: result.error,
    associationChanged: false,
  };
}

/** Drops cached logs fetched with an organization's credentials. */
export function clearSupabaseLogCacheForOrganization(
  organizationSlug: string,
): void {
  supabaseFunctionLogCache.clear(
    (scope) => scope.organizationSlug === organizationSlug,
  );
}
