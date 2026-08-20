import { atom } from "jotai";

// UI-only provider choice shared by the chat card and Configure panel. Request
// lifecycle state remains exclusively owned by the user-input read model.
export const integrationProviderSelectionAtom = atom<
  Map<string, "supabase" | "neon">
>(new Map());

// Request-scoped UI history: once setup begins, Skip stays unavailable even if
// the card remounts or the user returns to provider selection while connector
// work may still be settling.
export const startedIntegrationSetupRequestIdsAtom = atom<Set<string>>(
  new Set<string>(),
);
