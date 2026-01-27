/**
 * IPC Handlers for Secrets Vault
 */

import { ipcMain } from "electron";
import {
  getSecretsVault,
  type SecretId,
  type SecretType,
  type SecretCategory,
  type SecretMetadata,
} from "../../lib/secrets_vault";

export function registerSecretsVaultHandlers(): void {
  const vault = getSecretsVault();

  // Initialize vault
  ipcMain.handle("secrets-vault:initialize", async () => {
    await vault.initialize();
    return { success: true };
  });

  // Check if vault exists
  ipcMain.handle("secrets-vault:check-exists", async () => {
    return vault.checkVaultExists();
  });

  // Create vault
  ipcMain.handle(
    "secrets-vault:create",
    async (_, params: { name: string; masterPassword: string }) => {
      return vault.createVault(params.name, params.masterPassword);
    }
  );

  // Unlock vault
  ipcMain.handle(
    "secrets-vault:unlock",
    async (_, params: { masterPassword: string }) => {
      return vault.unlockVault(params.masterPassword);
    }
  );

  // Lock vault
  ipcMain.handle("secrets-vault:lock", async () => {
    vault.lockVault();
    return { success: true };
  });

  // Delete vault
  ipcMain.handle("secrets-vault:delete", async () => {
    await vault.deleteVault();
    return { success: true };
  });

  // Change password
  ipcMain.handle(
    "secrets-vault:change-password",
    async (_, params: { currentPassword: string; newPassword: string }) => {
      return vault.changePassword(params.currentPassword, params.newPassword);
    }
  );

  // Get vault status
  ipcMain.handle("secrets-vault:get-status", async () => {
    return {
      hasVault: vault.hasVault(),
      isLocked: vault.isVaultLocked(),
      config: vault.getVaultConfig(),
    };
  });

  // Set auto-lock timeout
  ipcMain.handle(
    "secrets-vault:set-auto-lock",
    async (_, params: { minutes: number }) => {
      await vault.setAutoLockTimeout(params.minutes);
      return { success: true };
    }
  );

  // Create secret
  ipcMain.handle(
    "secrets-vault:create-secret",
    async (
      _,
      params: {
        name: string;
        type: SecretType;
        category: SecretCategory;
        value: string;
        description?: string;
        metadata?: Partial<SecretMetadata>;
        tags?: string[];
        expiresAt?: number;
      }
    ) => {
      return vault.createSecret(params);
    }
  );

  // Get secret
  ipcMain.handle(
    "secrets-vault:get-secret",
    async (_, params: { secretId: SecretId }) => {
      return vault.getSecret(params.secretId);
    }
  );

  // Update secret
  ipcMain.handle(
    "secrets-vault:update-secret",
    async (
      _,
      params: {
        secretId: SecretId;
        updates: Partial<{
          name: string;
          type: SecretType;
          category: SecretCategory;
          value: string;
          description: string;
          metadata: Partial<SecretMetadata>;
          tags: string[];
          expiresAt: number | null;
        }>;
      }
    ) => {
      return vault.updateSecret(params.secretId, params.updates);
    }
  );

  // Delete secret
  ipcMain.handle(
    "secrets-vault:delete-secret",
    async (_, params: { secretId: SecretId }) => {
      return vault.deleteSecret(params.secretId);
    }
  );

  // List secrets
  ipcMain.handle(
    "secrets-vault:list-secrets",
    async (
      _,
      params?: {
        type?: SecretType;
        category?: SecretCategory;
        tags?: string[];
        search?: string;
      }
    ) => {
      return vault.listSecrets(params);
    }
  );

  // Get stats
  ipcMain.handle("secrets-vault:get-stats", async () => {
    return vault.getStats();
  });

  // Create backup
  ipcMain.handle("secrets-vault:create-backup", async () => {
    return vault.createBackup();
  });

  // Restore backup
  ipcMain.handle(
    "secrets-vault:restore-backup",
    async (_, params: { backupPath: string }) => {
      return vault.restoreBackup(params.backupPath);
    }
  );

  // List backups
  ipcMain.handle("secrets-vault:list-backups", async () => {
    return vault.listBackups();
  });

  // Delete backup
  ipcMain.handle(
    "secrets-vault:delete-backup",
    async (_, params: { backupPath: string }) => {
      return vault.deleteBackup(params.backupPath);
    }
  );

  // Subscribe to events
  const subscriptions = new Map<string, () => void>();

  ipcMain.handle("secrets-vault:subscribe", (event) => {
    const webContentsId = event.sender.id.toString();

    // Cleanup existing subscription
    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
    }

    const unsubscribe = vault.subscribe((vaultEvent) => {
      try {
        event.sender.send("secrets-vault:event", vaultEvent);
      } catch {
        // Window closed
        unsubscribe();
        subscriptions.delete(webContentsId);
      }
    });

    subscriptions.set(webContentsId, unsubscribe);
    return { success: true };
  });

  ipcMain.handle("secrets-vault:unsubscribe", (event) => {
    const webContentsId = event.sender.id.toString();
    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
      subscriptions.delete(webContentsId);
    }
    return { success: true };
  });
}
