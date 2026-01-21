import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { writeSettings, readSettings } from "../../main/settings";

export function registerSettingsHandlers() {
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    const settings = readSettings();
    return settings;
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    writeSettings(settings);
    return readSettings();
  });
}
