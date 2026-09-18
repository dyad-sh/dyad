import { isDyadProEnabled, type UserSettings } from "@/lib/schemas";

/** Use the resolved turn mode, not the user's default mode, for chat requests. */
export function shouldBillSubscription(settings: UserSettings): boolean {
  return (
    isDyadProEnabled(settings) &&
    settings.selectedChatMode !== "build" &&
    settings.selectedChatMode !== "ask" &&
    settings.selectedChatMode !== "plan"
  );
}

// Existing Codex callers share the same policy as other subscription backends.
export const shouldBillChatGPTSubscription = shouldBillSubscription;

/** Capture from accepted turn settings; null prevents later live-settings reads. */
export function subscriptionBillingKey(settings: UserSettings): string | null {
  return shouldBillSubscription(settings)
    ? (settings.providerSettings?.auto?.apiKey?.value ?? null)
    : null;
}
