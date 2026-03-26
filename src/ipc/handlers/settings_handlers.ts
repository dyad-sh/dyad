import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { readCurrentUserSettings, writeCurrentUserSettings } from "../../main/web-settings";

export function registerSettingsHandlers() {
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return readCurrentUserSettings();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    await writeCurrentUserSettings(settings);
    return readCurrentUserSettings();
  });
}
