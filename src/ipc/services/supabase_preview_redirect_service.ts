import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ensureSupabaseAuthRedirectUrls } from "@/supabase_admin/supabase_management_client";
import { getAppPreviewHostname } from "../../../shared/preview_hostname";
import { abortable } from "../utils/abortable";

export interface SupabasePreviewTarget {
  projectId: string;
  organizationSlug: string | null;
}

/** Caller holds provider admission through startup or project association. */
export async function resolveSupabasePreviewTarget(
  appId: number,
): Promise<SupabasePreviewTarget | null> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app?.supabaseProjectId) return null;
  return {
    projectId: app.supabaseProjectId,
    organizationSlug: app.supabaseOrganizationSlug,
  };
}

/** The runtime owns cancellation after capturing the provider association. */
export async function ensureSupabasePreviewRedirects({
  appId,
  origin,
  target,
  signal,
}: {
  appId: number;
  origin: string;
  target: SupabasePreviewTarget;
  signal: AbortSignal;
}): Promise<void> {
  const url = URL.parse(origin);
  if (
    !url ||
    url.protocol !== "http:" ||
    url.hostname !== getAppPreviewHostname(appId) ||
    !url.port ||
    url.origin !== origin
  ) {
    throw new DyadError("Invalid app preview origin", DyadErrorKind.Validation);
  }
  signal.throwIfAborted();
  await abortable(
    ensureSupabaseAuthRedirectUrls({
      // A selected Supabase branch has its own project ref and Auth config.
      projectId: target.projectId,
      organizationSlug: target.organizationSlug,
      // The bare origin is not matched by /** (which requires a slash).
      redirectUrls: [origin, `${origin}/**`],
      signal,
    }),
    signal,
  );
}
