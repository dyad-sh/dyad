import { atom } from "jotai";

// Define atom for tracking the last log timestamp per project (for incremental log loading)
export const lastLogTimestampAtom = atom<Record<string, number>>({});

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
