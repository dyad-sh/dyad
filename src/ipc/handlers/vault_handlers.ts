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
import { readSettings } from "../../main/settings";
import { VaultClient, type VaultBackup } from "../../vault/vault_client";

const logger = log.scope("vault_handlers");
const handle = createLoggedHandler(logger);

// Vault configuration - set via environment or use ABBA AI Vault project
// Production URL: https://shyspsgqbhiuntdjgfro.supabase.co
const VAULT_SUPABASE_URL =
  process.env.VAULT_SUPABASE_URL || "https://shyspsgqbhiuntdjgfro.supabase.co";
const VAULT_SUPABASE_ANON_KEY =
  process.env.VAULT_SUPABASE_ANON_KEY || ""; // Set via environment or Supabase Dashboard

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
  return new VaultClient({
    supabaseUrl: VAULT_SUPABASE_URL,
    supabaseAnonKey: VAULT_SUPABASE_ANON_KEY,
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
    }
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
    }
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
    }
  );

  /**
   * Get vault configuration (for debugging/setup)
   */
  handle(
    "vault:get-config",
    async (): Promise<{ url: string; configured: boolean }> => {
      return {
        url: VAULT_SUPABASE_URL,
        configured:
          VAULT_SUPABASE_URL !== "https://your-vault-project.supabase.co",
      };
    }
  );
}
