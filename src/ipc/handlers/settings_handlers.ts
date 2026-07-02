import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { writeSettings, readEffectiveSettings } from "../../main/settings";
import { validateProviderApiKey } from "../services/provider_api_key_validation_service";

export function registerSettingsHandlers() {
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
