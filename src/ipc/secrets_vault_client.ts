/**
 * Secrets Vault IPC Client
 * Renderer-side API for secrets vault operations
 */

import type {
  SecretId,
  SecretType,
  SecretCategory,
  SecretMetadata,
  VaultConfig,
  Secret,
  VaultStats,
  VaultBackup,
  VaultEvent,
} from "../lib/secrets_vault";

function getIpcRenderer() {
  return (window as any).electron?.ipcRenderer;
}

export const SecretsVaultClient = {
  // Vault management
  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:initialize");
  },

  async checkExists(): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:check-exists");
  },

  async createVault(name: string, masterPassword: string): Promise<VaultConfig> {
    return getIpcRenderer()?.invoke("secrets-vault:create", { name, masterPassword });
  },

  async unlockVault(masterPassword: string): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:unlock", { masterPassword });
  },

  async lockVault(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:lock");
  },

  async deleteVault(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:delete");
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:change-password", {
      currentPassword,
      newPassword,
    });
  },

  async getStatus(): Promise<{
    hasVault: boolean;
    isLocked: boolean;
    config: VaultConfig | null;
  }> {
    return getIpcRenderer()?.invoke("secrets-vault:get-status");
  },

  async setAutoLockTimeout(minutes: number): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:set-auto-lock", { minutes });
  },

  // Secret management
  async createSecret(params: {
    name: string;
    type: SecretType;
    category: SecretCategory;
    value: string;
    description?: string;
    metadata?: Partial<SecretMetadata>;
    tags?: string[];
    expiresAt?: number;
  }): Promise<Secret> {
    return getIpcRenderer()?.invoke("secrets-vault:create-secret", params);
  },

  async getSecret(secretId: SecretId): Promise<Secret | null> {
    return getIpcRenderer()?.invoke("secrets-vault:get-secret", { secretId });
  },

  async updateSecret(
    secretId: SecretId,
    updates: Partial<{
      name: string;
      type: SecretType;
      category: SecretCategory;
      value: string;
      description: string;
      metadata: Partial<SecretMetadata>;
      tags: string[];
      expiresAt: number | null;
    }>
  ): Promise<Secret | null> {
    return getIpcRenderer()?.invoke("secrets-vault:update-secret", { secretId, updates });
  },

  async deleteSecret(secretId: SecretId): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:delete-secret", { secretId });
  },

  async listSecrets(filters?: {
    type?: SecretType;
    category?: SecretCategory;
    tags?: string[];
    search?: string;
  }): Promise<Array<Omit<Secret, "value">>> {
    return getIpcRenderer()?.invoke("secrets-vault:list-secrets", filters);
  },

  async getStats(): Promise<VaultStats> {
    return getIpcRenderer()?.invoke("secrets-vault:get-stats");
  },

  // Backup management
  async createBackup(): Promise<VaultBackup> {
    return getIpcRenderer()?.invoke("secrets-vault:create-backup");
  },

  async restoreBackup(backupPath: string): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:restore-backup", { backupPath });
  },

  async listBackups(): Promise<VaultBackup[]> {
    return getIpcRenderer()?.invoke("secrets-vault:list-backups");
  },

  async deleteBackup(backupPath: string): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:delete-backup", { backupPath });
  },

  // Event subscription
  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:subscribe");
  },

  async unsubscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("secrets-vault:unsubscribe");
  },

  onEvent(callback: (event: VaultEvent) => void): () => void {
    const handler = (_: any, event: VaultEvent) => callback(event);
    getIpcRenderer()?.on("secrets-vault:event", handler);
    return () => getIpcRenderer()?.off("secrets-vault:event", handler);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // API KEY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getByName(name: string): Promise<Secret | null> {
    return getIpcRenderer()?.invoke("secrets-vault:get-by-name", { name });
  },

  async resolveApiKey(
    providerId: string
  ): Promise<{ value: string; source: "vault" | "settings" | "env"; providerId: string } | null> {
    return getIpcRenderer()?.invoke("secrets-vault:resolve-api-key", { providerId });
  },

  async getProviderStatus(): Promise<ProviderKeyStatus[]> {
    return getIpcRenderer()?.invoke("secrets-vault:get-provider-status") ?? [];
  },

  async getProviderRegistry(): Promise<ProviderTemplate[]> {
    return getIpcRenderer()?.invoke("secrets-vault:get-provider-registry") ?? [];
  },

  async quickStoreApiKey(providerId: string, apiKey: string): Promise<Secret> {
    return getIpcRenderer()?.invoke("secrets-vault:quick-store-api-key", { providerId, apiKey });
  },

  async removeApiKey(providerId: string): Promise<boolean> {
    return getIpcRenderer()?.invoke("secrets-vault:remove-api-key", { providerId });
  },

  async syncFromSettings(): Promise<{ importedCount: number }> {
    return getIpcRenderer()?.invoke("secrets-vault:sync-from-settings");
  },

  async getContext(): Promise<{
    providers: Array<{
      name: string;
      service: string | undefined;
      tags: string[];
      category: string;
    }>;
  }> {
    return getIpcRenderer()?.invoke("secrets-vault:get-context") ?? { providers: [] };
  },

  async resolveEnvVars(): Promise<Record<string, string>> {
    return getIpcRenderer()?.invoke("secrets-vault:resolve-env-vars") ?? {};
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProviderKeyStatus {
  providerId: string;
  label: string;
  icon: string;
  description: string;
  helpUrl: string;
  category: string;
  configured: boolean;
  source: "vault" | "settings" | "env" | "none";
  vaultProtected: boolean;
  maskedKey: string | null;
}

export interface ProviderTemplate {
  id: string;
  label: string;
  description: string;
  helpUrl: string;
  envVar: string;
  category: string;
  icon: string;
  placeholder: string;
}

export type { SecretId, SecretType, SecretCategory, SecretMetadata, VaultConfig, Secret, VaultStats, VaultBackup, VaultEvent };
