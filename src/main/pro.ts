import { readSettings, writeSettings } from "./settings";

/**
 * Handles the return from the Dyad Pro authentication flow.
 * It saves the API key and enables Dyad Pro in the settings.
 * @param {object} params - The parameters for handling the Dyad Pro return.
 * @param {string} params.apiKey - The API key returned from the authentication flow.
 */
export function handleDyadProReturn({ apiKey }: { apiKey: string }) {
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
    enableDyadPro: true,
  });
}
