import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import {
  writeSettings,
  readSettings,
  applyRemoteSettingsDefaultsIfNeeded,
} from "../../main/settings";

export function registerSettingsHandlers() {
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return applyRemoteSettingsDefaultsIfNeeded();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    writeSettings(settings);
    return readSettings();
  });
}
