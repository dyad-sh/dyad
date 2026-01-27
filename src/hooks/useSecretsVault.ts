/**
 * Secrets Vault React Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useState } from "react";
import {
  SecretsVaultClient,
  type SecretId,
  type SecretType,
  type SecretCategory,
  type SecretMetadata,
  type VaultEvent,
} from "../ipc/secrets_vault_client";

const QUERY_KEYS = {
  status: ["secrets-vault", "status"],
  secrets: (filters?: any) => ["secrets-vault", "secrets", filters],
  secret: (id: SecretId) => ["secrets-vault", "secret", id],
  stats: ["secrets-vault", "stats"],
  backups: ["secrets-vault", "backups"],
};

// =============================================================================
// VAULT HOOKS
// =============================================================================

export function useSecretsVault() {
  const queryClient = useQueryClient();
  const [vaultEvent, setVaultEvent] = useState<VaultEvent | null>(null);

  // Subscribe to vault events
  useEffect(() => {
    SecretsVaultClient.initialize();
    SecretsVaultClient.subscribe();

    const unsubscribe = SecretsVaultClient.onEvent((event) => {
      setVaultEvent(event);
      
      // Invalidate relevant queries based on event type
      switch (event.type) {
        case "vault:created":
        case "vault:unlocked":
        case "vault:locked":
        case "vault:deleted":
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
          break;
        case "secret:created":
        case "secret:updated":
        case "secret:deleted":
          queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
          if (event.secretId) {
            queryClient.invalidateQueries({ queryKey: QUERY_KEYS.secret(event.secretId) });
          }
          break;
        case "backup:created":
        case "backup:restored":
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backups });
          break;
      }
    });

    return () => {
      unsubscribe();
      SecretsVaultClient.unsubscribe();
    };
  }, [queryClient]);

  return { vaultEvent };
}

export function useVaultStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.status,
    queryFn: () => SecretsVaultClient.getStatus(),
    refetchInterval: 30000, // Check status every 30s for auto-lock
  });
}

export function useCreateVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, masterPassword }: { name: string; masterPassword: string }) =>
      SecretsVaultClient.createVault(name, masterPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
    },
  });
}

export function useUnlockVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (masterPassword: string) => SecretsVaultClient.unlockVault(masterPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
    },
  });
}

export function useLockVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => SecretsVaultClient.lockVault(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
      queryClient.removeQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.removeQueries({ queryKey: ["secrets-vault", "secret"] });
    },
  });
}

export function useDeleteVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => SecretsVaultClient.deleteVault(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
      queryClient.removeQueries({ queryKey: ["secrets-vault"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      SecretsVaultClient.changePassword(currentPassword, newPassword),
  });
}

export function useSetAutoLockTimeout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (minutes: number) => SecretsVaultClient.setAutoLockTimeout(minutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.status });
    },
  });
}

// =============================================================================
// SECRET HOOKS
// =============================================================================

export function useSecrets(filters?: {
  type?: SecretType;
  category?: SecretCategory;
  tags?: string[];
  search?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.secrets(filters),
    queryFn: () => SecretsVaultClient.listSecrets(filters),
  });
}

export function useSecret(secretId: SecretId | null) {
  return useQuery({
    queryKey: QUERY_KEYS.secret(secretId!),
    queryFn: () => SecretsVaultClient.getSecret(secretId!),
    enabled: !!secretId,
  });
}

export function useCreateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      name: string;
      type: SecretType;
      category: SecretCategory;
      value: string;
      description?: string;
      metadata?: Partial<SecretMetadata>;
      tags?: string[];
      expiresAt?: number;
    }) => SecretsVaultClient.createSecret(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

export function useUpdateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      secretId,
      updates,
    }: {
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
    }) => SecretsVaultClient.updateSecret(secretId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.secret(variables.secretId) });
    },
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (secretId: SecretId) => SecretsVaultClient.deleteSecret(secretId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

export function useVaultStats() {
  return useQuery({
    queryKey: QUERY_KEYS.stats,
    queryFn: () => SecretsVaultClient.getStats(),
  });
}

// =============================================================================
// BACKUP HOOKS
// =============================================================================

export function useBackups() {
  return useQuery({
    queryKey: QUERY_KEYS.backups,
    queryFn: () => SecretsVaultClient.listBackups(),
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => SecretsVaultClient.createBackup(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backups });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (backupPath: string) => SecretsVaultClient.restoreBackup(backupPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (backupPath: string) => SecretsVaultClient.deleteBackup(backupPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backups });
    },
  });
}

// =============================================================================
// COMBINED HOOK
// =============================================================================

export function useSecretsVaultManager() {
  const { vaultEvent } = useSecretsVault();
  const { data: status, isLoading: statusLoading } = useVaultStatus();
  const { data: stats } = useVaultStats();
  
  const createVault = useCreateVault();
  const unlockVault = useUnlockVault();
  const lockVault = useLockVault();
  const deleteVault = useDeleteVault();
  const changePassword = useChangePassword();
  const setAutoLockTimeout = useSetAutoLockTimeout();
  
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();
  
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const deleteBackup = useDeleteBackup();

  return {
    // State
    vaultEvent,
    status,
    stats,
    isLoading: statusLoading,
    hasVault: status?.hasVault ?? false,
    isLocked: status?.isLocked ?? true,
    config: status?.config ?? null,

    // Vault operations
    createVault: createVault.mutateAsync,
    unlockVault: unlockVault.mutateAsync,
    lockVault: lockVault.mutateAsync,
    deleteVault: deleteVault.mutateAsync,
    changePassword: changePassword.mutateAsync,
    setAutoLockTimeout: setAutoLockTimeout.mutateAsync,

    // Secret operations
    createSecret: createSecret.mutateAsync,
    updateSecret: updateSecret.mutateAsync,
    deleteSecret: deleteSecret.mutateAsync,

    // Backup operations
    createBackup: createBackup.mutateAsync,
    restoreBackup: restoreBackup.mutateAsync,
    deleteBackup: deleteBackup.mutateAsync,

    // Mutation states
    isCreatingVault: createVault.isPending,
    isUnlocking: unlockVault.isPending,
    isLocking: lockVault.isPending,
    isCreatingSecret: createSecret.isPending,
    isUpdatingSecret: updateSecret.isPending,
    isDeletingSecret: deleteSecret.isPending,
    isCreatingBackup: createBackup.isPending,
    isRestoringBackup: restoreBackup.isPending,
  };
}
