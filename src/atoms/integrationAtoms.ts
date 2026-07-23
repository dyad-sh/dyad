import { atom } from "jotai";
import { userInputRequestsAtom } from "@/user_input/projection";

interface PendingIntegration {
  chatId: number;
  requestId: string;
  provider?: "supabase" | "neon";
}

// UI-only provider choice shared by the chat card and Configure panel. Request
// lifecycle state remains exclusively owned by the user-input projection.
export const integrationProviderSelectionAtom = atom<
  Map<string, "supabase" | "neon">
>(new Map());

export const pendingIntegrationAtom = atom<Map<number, PendingIntegration>>(
  (get) => {
    const pending = new Map<number, PendingIntegration>();
    const selectedProviders = get(integrationProviderSelectionAtom);
    for (const request of get(userInputRequestsAtom).values()) {
      if (request.status !== "awaiting") continue;
      const descriptor = request.descriptor;
      if (descriptor.kind !== "integration") {
        continue;
      }
      pending.set(descriptor.chatId, {
        chatId: descriptor.chatId,
        requestId: descriptor.requestId,
        provider:
          selectedProviders.get(descriptor.requestId) ?? descriptor.provider,
      });
    }
    return pending;
  },
);
