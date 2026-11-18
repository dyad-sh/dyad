import { atom } from "jotai";
import type { EdgeLogPollCursor } from "@/lib/supabase_edge_log_poll";

/**
 * Background Edge Function log polling progress, keyed by
 * `edgeLogPollKey({ appId, projectId, organizationSlug })`. Lives in an atom
 * so the preview console does not receive the same logs again when the
 * preview panel remounts.
 */
export const edgeLogPollCursorsAtom = atom<Record<string, EdgeLogPollCursor>>(
  {},
);

/**
 * Apps whose legacy-Supabase-key banner the user has dismissed, by app id.
 *
 * Deliberately in-memory rather than in settings: dismissing is "not now", not
 * "never" — the app keeps working right up until Supabase disables legacy keys,
 * so the warning comes back next launch. Keyed per app because the banner is
 * about one app's generated client, and dismissing it for one app says nothing
 * about another.
 */
export const dismissedLegacySupabaseKeyAppIdsAtom = atom<ReadonlySet<number>>(
  new Set<number>(),
);
