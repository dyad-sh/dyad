import log from "electron-log";

import { readSettings, writeSettings } from "../../main/settings";
import type { UserSettings } from "../../lib/schemas";
import { readVaultEnv, settingsPatchFromEnv, writeVaultEnv } from "./vault_env";

const logger = log.scope("vault_secrets_sync");

function configuredVaultPath(settings: UserSettings): string | undefined {
  const vaultPath = settings.storage?.localVaultPath?.trim();
  return vaultPath || undefined;
}

/**
 * Mirrors the API keys in settings out to the vault's `.env`.
 *
 * Failures are logged and swallowed: an unplugged drive must not stop the user
 * saving their settings. Never logs a key or the vault path.
 */
export async function syncSecretsToVault(
  settings: UserSettings,
): Promise<void> {
  const vaultPath = configuredVaultPath(settings);
  if (!vaultPath) return;
  try {
    const { count } = await writeVaultEnv(vaultPath, settings);
    logger.log(`Mirrored ${count} API key(s) to the vault .env`);
  } catch (error) {
    logger.warn(
      `Could not write the vault .env: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
  }
}

/**
 * Fills in any API key the vault knows and settings does not.
 *
 * Run at startup and whenever a vault is selected, so a reinstall or a move to
 * another machine picks the keys back up instead of asking for them again.
 * Keys already present in settings are left alone.
 */
export async function restoreSecretsFromVault(): Promise<number> {
  const settings = readSettings();
  const vaultPath = configuredVaultPath(settings);
  if (!vaultPath) return 0;

  let restored = 0;
  try {
    const env = await readVaultEnv(vaultPath);
    const patch =
      Object.keys(env).length > 0 ? settingsPatchFromEnv(settings, env) : null;

    if (patch) {
      writeSettings(patch);
      restored = Object.keys(patch).length;
      logger.log(`Restored ${restored} API key group(s) from the vault .env`);
    }
  } catch (error) {
    logger.warn(
      `Could not read the vault .env: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
    return 0;
  }

  // Mirror straight back out, so a vault that has never been written gets the
  // keys this install already holds without waiting for a settings change.
  await syncSecretsToVault(readSettings());
  return restored;
}
