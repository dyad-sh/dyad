import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ensureSupabaseAuthRedirectUrls } from "@/supabase_admin/supabase_management_client";
import { getAppPreviewHostname } from "../../../shared/preview_hostname";
import { abortable } from "../utils/abortable";

export const SUPABASE_PREVIEW_REGISTRATION_TIMEOUT_MS = 10_000;

/** Caller holds provider admission through startup or project association. */
export async function ensureSupabasePreviewRedirects({
  appId,
  origin,
  signal,
}: {
  appId: number;
  origin: string;
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
  const registrationSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(SUPABASE_PREVIEW_REGISTRATION_TIMEOUT_MS),
  ]);
  await abortable(
    (async () => {
      registrationSignal.throwIfAborted();
      const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
      registrationSignal.throwIfAborted();
      if (!app?.supabaseProjectId) return;
      await ensureSupabaseAuthRedirectUrls({
        // A selected Supabase branch has its own project ref and Auth config.
        projectId: app.supabaseProjectId,
        organizationSlug: app.supabaseOrganizationSlug,
        // The bare origin is not matched by /** (which requires a slash).
        redirectUrls: [origin, `${origin}/**`],
        signal: registrationSignal,
      });
    })(),
    registrationSignal,
  );
}
