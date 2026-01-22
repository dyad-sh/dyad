/**
 * Vault IPC Handlers
 * Handles IPC communication for Vault v2 backup/restore operations
 */

import log from "electron-log";
import { app } from "electron";
import { createLoggedHandler } from "./safe_handle";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { readSettings, writeSettings } from "../../main/settings";
import { VaultClient, type VaultBackup } from "../../vault/vault_client";
import {
  validateVaultConfig,
  maskKey,
  DEFAULT_VAULT_URL,
  DEFAULT_VAULT_ANON_KEY,
} from "../../vault/vault_config";

const logger = log.scope("vault_handlers");
const handle = createLoggedHandler(logger);

/**
 * Get vault configuration from settings with fallback to env vars
 */
function getVaultConfig(): { url: string; anonKey: string } {
  const settings = readSettings();
  return {
    url: settings.vault?.supabaseUrl || DEFAULT_VAULT_URL,
    anonKey: settings.vault?.supabaseAnonKey?.value || DEFAULT_VAULT_ANON_KEY,
  };
}

/**
 * Get access token from settings for Vault authentication
 * Uses the first available Supabase organization token
 */
async function getVaultAccessToken(): Promise<string | null> {
  const settings = readSettings();
  const organizations = settings.supabase?.organizations;

  if (!organizations) {
    return null;
  }

  // Get the first organization's access token
  const orgSlugs = Object.keys(organizations);
  if (orgSlugs.length === 0) {
    return null;
  }

  const firstOrg = organizations[orgSlugs[0]];
  return firstOrg?.accessToken?.value || null;
}

/**
 * Create a VaultClient instance with current configuration
 */
function createVaultClient(): VaultClient {
  const config = getVaultConfig();
  return new VaultClient({
    supabaseUrl: config.url,
    supabaseAnonKey: config.anonKey,
    getAccessToken: getVaultAccessToken,
  });
}

// IPC Types for Vault operations
export interface VaultStatusResponse {
  isAuthenticated: boolean;
  organizationName?: string;
}

export interface VaultBackupParams {
  appId: number;
  notes?: string;
}

export interface VaultRestoreParams {
  backupId: string;
  targetPath: string;
}

export interface VaultProgressEvent {
  stage: string;
  progress: number;
}

export interface VaultSettingsResponse {
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
}

export interface VaultTestConnectionResult {
  success: boolean;
  status: "connected" | "needs_login" | "invalid_url" | "invalid_key" | "error";
  message: string;
}

export interface VaultDiagnostics {
  timestamp: string;
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
  isAuthenticated: boolean;
  organizationName: string | null;
  lastError: string | null;
}

export function registerVaultHandlers() {
  /**
   * Get vault authentication status
   */
  handle("vault:get-status", async (): Promise<VaultStatusResponse> => {
    const token = await getVaultAccessToken();
    const settings = readSettings();
    const organizations = settings.supabase?.organizations;

    if (!token || !organizations) {
      return { isAuthenticated: false };
    }

    const orgSlugs = Object.keys(organizations);
    return {
      isAuthenticated: true,
      organizationName: orgSlugs[0] || undefined,
    };
  });

  /**
   * List all backups for the current user
   */
  handle("vault:list-backups", async (): Promise<VaultBackup[]> => {
    const client = createVaultClient();
    return client.listBackups();
  });

  /**
   * Create a backup for an app
   */
  handle(
    "vault:create-backup",
    async (_, params: VaultBackupParams): Promise<VaultBackup> => {
      const { appId, notes } = params;

      // Get app details from database
      const appData = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!appData) {
        throw new Error(`App not found: ${appId}`);
      }

      const client = createVaultClient();
      const appVersion = app.getVersion();

      logger.info(`Creating backup for app: ${appData.name} (${appId})`);

      const backup = await client.createBackup({
        projectName: appData.name,
        projectPath: appData.path,
        appVersion,
        notes,
        onProgress: (stage, progress) => {
          logger.debug(`Backup progress: ${stage} (${progress}%)`);
        },
      });

      logger.info(`Backup created: ${backup.id}`);
      return backup;
    },
  );

  /**
   * Restore a backup to a target path
   */
  handle(
    "vault:restore-backup",
    async (_, params: VaultRestoreParams): Promise<void> => {
      const { backupId, targetPath } = params;

      const client = createVaultClient();

      logger.info(`Restoring backup: ${backupId} to ${targetPath}`);

      await client.restoreBackup({
        backupId,
        targetPath,
        onProgress: (stage, progress) => {
          logger.debug(`Restore progress: ${stage} (${progress}%)`);
        },
      });

      logger.info("Backup restored successfully");
    },
  );

  /**
   * Delete a backup
   */
  handle(
    "vault:delete-backup",
    async (_, { backupId }: { backupId: string }): Promise<void> => {
      const client = createVaultClient();

      logger.info(`Deleting backup: ${backupId}`);
      await client.deleteBackup(backupId);
      logger.info("Backup deleted");
    },
  );

  /**
   * Get vault configuration (for debugging/setup)
   */
  handle(
    "vault:get-config",
    async (): Promise<{ url: string; configured: boolean }> => {
      const config = getVaultConfig();
      return {
        url: config.url,
        configured: config.anonKey.length > 0,
      };
    },
  );

  /**
   * Get vault settings for the settings UI
   */
  handle("vault:get-settings", async (): Promise<VaultSettingsResponse> => {
    const config = getVaultConfig();
    return {
      supabaseUrl: config.url,
      hasAnonKey: config.anonKey.length > 0,
      maskedAnonKey: maskKey(config.anonKey),
    };
  });

  /**
   * Save vault settings
   */
  handle(
    "vault:save-settings",
    async (
      _,
      params: { supabaseUrl: string; supabaseAnonKey: string },
    ): Promise<{ success: boolean; error?: string }> => {
      const { supabaseUrl, supabaseAnonKey } = params;

      // Validate configuration
      const validation = validateVaultConfig(supabaseUrl, supabaseAnonKey);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // Save to settings
      writeSettings({
        vault: {
          supabaseUrl: supabaseUrl.trim(),
          supabaseAnonKey: { value: supabaseAnonKey.trim() },
        },
      });

      logger.info(
        `Vault settings saved: URL=${supabaseUrl}, key=${maskKey(supabaseAnonKey)}`,
      );
      return { success: true };
    },
  );

  /**
   * Test vault connection
   * Attempts to call list-backups with limit=1 to verify connectivity
   */
  handle(
    "vault:test-connection",
    async (): Promise<VaultTestConnectionResult> => {
      const config = getVaultConfig();

      // Check if configured
      if (!config.anonKey) {
        return {
          success: false,
          status: "invalid_key",
          message: "Publishable key is not configured",
        };
      }

      // Check if user is authenticated
      const token = await getVaultAccessToken();
      if (!token) {
        return {
          success: false,
          status: "needs_login",
          message: "Sign in to Supabase to use Vault",
        };
      }

      try {
        const client = createVaultClient();
        // Try to list backups (validates URL, key, and auth)
        await client.listBackups();

        return {
          success: true,
          status: "connected",
          message: "Successfully connected to Vault",
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        logger.error(
          `Vault connection test failed: ${errorMessage}, URL=${config.url}, key=${maskKey(config.anonKey)}`,
        );

        // Categorize errors
        if (
          errorMessage.includes("401") ||
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("Invalid or expired token")
        ) {
          return {
            success: false,
            status: "needs_login",
            message: "Session expired. Please sign in to Supabase again.",
          };
        }

        if (
          errorMessage.includes("403") ||
          errorMessage.includes("forbidden")
        ) {
          return {
            success: false,
            status: "invalid_key",
            message: "Access denied. Check your publishable key.",
          };
        }

        if (
          errorMessage.includes("fetch") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.includes("Failed to fetch")
        ) {
          return {
            success: false,
            status: "invalid_url",
            message: "Cannot reach server. Check URL and internet connection.",
          };
        }

        return {
          success: false,
          status: "error",
          message: errorMessage,
        };
      }
    },
  );

  /**
   * Get vault diagnostics for support
   * Returns sanitized info (no full keys)
   */
  handle("vault:get-diagnostics", async (): Promise<VaultDiagnostics> => {
    const config = getVaultConfig();
    const token = await getVaultAccessToken();
    const settings = readSettings();
    const organizations = settings.supabase?.organizations;
    const orgSlugs = organizations ? Object.keys(organizations) : [];

    return {
      timestamp: new Date().toISOString(),
      supabaseUrl: config.url,
      hasAnonKey: config.anonKey.length > 0,
      maskedAnonKey: maskKey(config.anonKey),
      isAuthenticated: !!token,
      organizationName: orgSlugs[0] || null,
      lastError: null, // Could be enhanced to track last error
    };
  });
}
