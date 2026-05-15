import { atom } from "jotai";
import type { IntegrationPromptPayload } from "@/ipc/types/integration";

export const pendingIntegrationAtom = atom<
  Map<number, IntegrationPromptPayload>
>(new Map());

// Tracks chats whose integration was just completed and need to auto-send the
// "Continue. I have completed the X integration." message once the current
// stream ends. Written by the Configure panel's Continue button; consumed by
// the in-chat DyadAddIntegration card's auto-send effect.
export const pendingContinuationProviderAtom = atom<
  Map<number, "supabase" | "neon">
>(new Map());
