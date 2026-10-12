import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { ensureSupabaseAuthRedirectUrls } from "@/supabase_admin/supabase_management_client";
import { assertAppPreviewOrigin } from "./preview_origin";
import { abortable } from "../utils/abortable";

export interface SupabasePreviewTarget {
  projectId: string;
  organizationSlug: string | null;
}

/** Single DB snapshot; startup must yield to newer provider reconciliation. */
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
  assertAppPreviewOrigin(appId, origin);
  signal.throwIfAborted();
  // Localhost remains available even when the preview uses an app-specific
  // domain. Cover both bare-origin redirects and arbitrarily nested callbacks.
  const redirectUrls = ["http://localhost:*", "http://localhost:*/**"];
  if (new URL(origin).hostname !== "localhost") {
    redirectUrls.push(origin, `${origin}/**`);
  }
  await abortable(
    ensureSupabaseAuthRedirectUrls({
      // A selected Supabase branch has its own project ref and Auth config.
      projectId: target.projectId,
      organizationSlug: target.organizationSlug,
      redirectUrls,
      signal,
    }),
    signal,
  );
}
