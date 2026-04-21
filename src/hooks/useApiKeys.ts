/**
 * React hooks for the API Keys Manager
 *
 * Wraps the secrets-vault IPC calls for provider-based API key management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SecretsVaultClient,
  type ProviderKeyStatus,
  type ProviderTemplate,
} from "../ipc/secrets_vault_client";

const QUERY_KEYS = {
  providerStatus: ["secrets-vault", "provider-status"],
  providerRegistry: ["secrets-vault", "provider-registry"],
};

/**
 * Get the configuration status of all known API key providers.
 * Shows which providers are configured and where their keys live.
 */
export function useProviderStatus() {
  return useQuery<ProviderKeyStatus[]>({
    queryKey: QUERY_KEYS.providerStatus,
    queryFn: () => SecretsVaultClient.getProviderStatus(),
    refetchInterval: 15_000,
  });
}

/**
 * Get the full provider registry with templates for the UI.
 */
export function useProviderRegistry() {
  return useQuery<ProviderTemplate[]>({
    queryKey: QUERY_KEYS.providerRegistry,
    queryFn: () => SecretsVaultClient.getProviderRegistry(),
    staleTime: 60_000 * 10,
  });
}

/**
 * Quick-store an API key for a known provider.
 * Creates or updates the vault entry with pre-filled metadata.
 */
export function useStoreApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
      SecretsVaultClient.quickStoreApiKey(providerId, apiKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providerStatus });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "stats"] });
      toast.success(`API key saved for ${variables.providerId}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to save API key: ${error.message}`);
    },
  });
}

/**
 * Remove an API key for a known provider.
 */
export function useRemoveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (providerId: string) =>
      SecretsVaultClient.removeApiKey(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providerStatus });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "stats"] });
      toast.success("API key removed");
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove API key: ${error.message}`);
    },
  });
}

/**
 * Import API keys from user-settings.json and .env into the vault.
 */
export function useSyncFromSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => SecretsVaultClient.syncFromSettings(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providerStatus });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "secrets"] });
      queryClient.invalidateQueries({ queryKey: ["secrets-vault", "stats"] });
      if (result.importedCount > 0) {
        toast.success(`Imported ${result.importedCount} API key${result.importedCount > 1 ? "s" : ""} into the vault`);
      } else {
        toast.info("No new API keys to import");
      }
    },
    onError: (error: Error) => {
      toast.error(`Import failed: ${error.message}`);
    },
  });
}
