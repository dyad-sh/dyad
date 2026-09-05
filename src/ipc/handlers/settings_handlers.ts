import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { writeSettings, readEffectiveSettings } from "../../main/settings";
import { validateProviderApiKey } from "../services/provider_api_key_validation_service";
import {
  connectCodexSubscription,
  disconnectCodexSubscription,
  getCodexSubscriptionStatus,
} from "../services/codex_subscription_auth";
import {
  flushSubscriptionUsage,
  getSubscriptionUsageStatus,
} from "../services/codex_subscription_usage";

export function registerSettingsHandlers() {
  createTypedHandler(
    settingsContracts.getCodexSubscriptionStatus,
    async () => ({
      ...getCodexSubscriptionStatus(),
      ...getSubscriptionUsageStatus(),
    }),
  );
  createTypedHandler(settingsContracts.connectCodexSubscription, async () =>
    connectCodexSubscription(),
  );
  createTypedHandler(settingsContracts.disconnectCodexSubscription, async () =>
    disconnectCodexSubscription(),
  );
  createTypedHandler(settingsContracts.retryCodexSubscriptionUsage, async () =>
    flushSubscriptionUsage(),
  );
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return readEffectiveSettings();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    writeSettings(settings);
    return readEffectiveSettings();
  });

  createTypedHandler(
    settingsContracts.validateProviderApiKey,
    async (_, params) => {
      return validateProviderApiKey(params);
    },
  );
}
