import { expect, it } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { subscriptionBillingKey } from "./subscription_billing";
it.each(["build", "ask", "plan", "local-agent"] as const)(
  "captures the shared subscription billing key for %s",
  (selectedChatMode) => {
    for (const enableDyadPro of [true, false]) {
      const settings = {
        selectedChatMode,
        enableDyadPro,
        providerSettings: { auto: { apiKey: { value: "accepted-test-key" } } },
      } as unknown as UserSettings;
      expect(subscriptionBillingKey(settings)).toBe(
        enableDyadPro && selectedChatMode === "local-agent"
          ? "accepted-test-key"
          : null,
      );
    }
  },
);
