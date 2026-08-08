const HIDDEN_SETTINGS_PROVIDER_IDS = new Set(["auto", "phantom"]);

/**
 * Internal routing providers remain supported by the runtime, but should not
 * appear as user-configurable providers or role choices in Settings.
 */
export function isProviderVisibleInSettings(providerId: string): boolean {
  return !HIDDEN_SETTINGS_PROVIDER_IDS.has(providerId);
}
