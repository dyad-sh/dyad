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
import {
  resolveApiKey,
  getAllProviderStatus,
  PROVIDER_REGISTRY,
  getProviderTemplate,
} from "../../lib/api_key_resolver";
import { readSettings } from "../../main/settings";

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

  // ═══════════════════════════════════════════════════════════════════════════
  // API KEY MANAGEMENT — user-friendly key resolution + provider templates
  // ═══════════════════════════════════════════════════════════════════════════

  // Get a secret by its human-readable name (first match)
  ipcMain.handle(
    "secrets-vault:get-by-name",
    async (_, params: { name: string }) => {
      if (!params.name) throw new Error("Secret name is required");
      const secrets = await vault.listSecrets({ search: params.name });
      if (secrets.length === 0) return null;
      return vault.getSecret(secrets[0].id);
    }
  );

  // Resolve an API key by provider id (vault → settings → env)
  ipcMain.handle(
    "secrets-vault:resolve-api-key",
    async (_, params: { providerId: string }) => {
      if (!params.providerId) throw new Error("Provider ID is required");
      return resolveApiKey(params.providerId);
    }
  );

  // Get configuration status for all known providers
  ipcMain.handle("secrets-vault:get-provider-status", async () => {
    return getAllProviderStatus();
  });

  // Get the full provider registry (templates for the UI)
  ipcMain.handle("secrets-vault:get-provider-registry", async () => {
    return PROVIDER_REGISTRY;
  });

  // Quick-store an API key for a known provider with pre-filled metadata
  ipcMain.handle(
    "secrets-vault:quick-store-api-key",
    async (
      _,
      params: { providerId: string; apiKey: string }
    ) => {
      if (!params.providerId || !params.apiKey) {
        throw new Error("Provider ID and API key are required");
      }
      const template = getProviderTemplate(params.providerId);
      if (!template) {
        throw new Error(`Unknown provider: ${params.providerId}`);
      }

      // Check if a key for this provider already exists in the vault
      const existing = await vault.listSecrets({
        type: "api_key",
        tags: [params.providerId],
      });

      if (existing.length > 0) {
        // Update existing secret
        return vault.updateSecret(existing[0].id, {
          value: params.apiKey,
        });
      }

      // Create new secret with pre-filled template data
      return vault.createSecret({
        name: `${template.label} API Key`,
        type: "api_key",
        category: template.category,
        value: params.apiKey,
        description: template.description,
        metadata: {
          service: template.label,
          url: template.helpUrl,
        },
        tags: [params.providerId],
      });
    }
  );

  // Remove an API key for a known provider
  ipcMain.handle(
    "secrets-vault:remove-api-key",
    async (_, params: { providerId: string }) => {
      if (!params.providerId) throw new Error("Provider ID is required");
      const existing = await vault.listSecrets({
        type: "api_key",
        tags: [params.providerId],
      });
      if (existing.length === 0) return false;
      return vault.deleteSecret(existing[0].id);
    }
  );

  // Sync API keys from user-settings.json into the vault
  ipcMain.handle("secrets-vault:sync-from-settings", async () => {
    const settings = readSettings();
    let importedCount = 0;

    for (const template of PROVIDER_REGISTRY) {
      // Check if already in vault
      const existing = await vault.listSecrets({
        type: "api_key",
        tags: [template.id],
      });
      if (existing.length > 0) continue;

      // Try to find key in settings
      let keyValue: string | undefined;
      const provSetting = settings.providerSettings[template.id];
      if (provSetting?.apiKey?.value) {
        keyValue = provSetting.apiKey.value;
      } else if (template.id === "github" && settings.githubAccessToken?.value) {
        keyValue = settings.githubAccessToken.value;
      } else if (
        template.id === "huggingface" &&
        settings.huggingFaceToken?.value
      ) {
        keyValue = settings.huggingFaceToken.value;
      } else if (template.id === "vercel" && settings.vercelAccessToken?.value) {
        keyValue = settings.vercelAccessToken.value;
      }

      // Fall back to env
      if (!keyValue && template.envVar) {
        keyValue = process.env[template.envVar];
      }

      if (keyValue) {
        await vault.createSecret({
          name: `${template.label} API Key`,
          type: "api_key",
          category: template.category,
          value: keyValue,
          description: `Imported from ${provSetting ? "settings" : "environment"}`,
          metadata: {
            service: template.label,
            url: template.helpUrl,
          },
          tags: [template.id],
        });
        importedCount++;
      }
    }

    return { importedCount };
  });

  // Get vault context for AI/runtime — returns provider names with stored keys
  ipcMain.handle("secrets-vault:get-context", async () => {
    if (vault.isVaultLocked()) return { providers: [] };
    const secrets = await vault.listSecrets({ type: "api_key" });
    return {
      providers: secrets.map((s) => ({
        name: s.name,
        service: s.metadata.service,
        tags: s.tags,
        category: s.category,
      })),
    };
  });

  // Resolve env vars — returns a map of env var name → value from vault
  ipcMain.handle("secrets-vault:resolve-env-vars", async () => {
    if (vault.isVaultLocked()) return {};
    const envMap: Record<string, string> = {};
    for (const template of PROVIDER_REGISTRY) {
      const resolved = await resolveApiKey(template.id);
      if (resolved) {
        envMap[template.envVar] = resolved.value;
      }
    }
    return envMap;
  });
}
