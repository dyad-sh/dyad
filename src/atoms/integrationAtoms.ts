import { atom } from "jotai";
import type { IntegrationPromptPayload } from "@/ipc/types/integration";
import { userInputRequestsAtom } from "@/user_input/projection";

// UI-only provider choice shared by the chat card and Configure panel. Request
// lifecycle state remains exclusively owned by the user-input projection.
export const integrationProviderSelectionAtom = atom<
  Map<number, "supabase" | "neon">
>(new Map());

export const pendingIntegrationAtom = atom<
  Map<number, IntegrationPromptPayload>
>((get) => {
  const pending = new Map<number, IntegrationPromptPayload>();
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
      provider: selectedProviders.get(descriptor.chatId) ?? descriptor.provider,
    });
  }
  return pending;
});
