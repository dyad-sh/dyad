import { readSettings, writeSettings } from "./settings";

/**
 * Handle deep link return with API key.
 * Saves the API key for the JoyCreate engine gateway.
 * All features are free - the API key just enables engine routing.
 */
export function handleJoyProReturn({ apiKey }: { apiKey: string }) {
  const settings = readSettings();
  writeSettings({
    providerSettings: {
      ...settings.providerSettings,
      auto: {
        ...settings.providerSettings.auto,
        apiKey: {
          value: apiKey,
        },
      },
    },
  });
}
