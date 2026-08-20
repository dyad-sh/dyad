import { atom } from "jotai";

// UI-only provider choice shared by the chat card and Configure panel. Request
// lifecycle state remains exclusively owned by the user-input read model.
export const integrationProviderSelectionAtom = atom<
  Map<string, "supabase" | "neon">
>(new Map());
