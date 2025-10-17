import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  CreateCustomLanguageModelProviderParams,
  LanguageModelProvider,
} from "@/ipc/ipc_types";
import { showError } from "@/lib/toast";

/**
 * A hook for managing custom language model providers.
 * @returns {object} An object with functions to create, edit, and delete providers, and the loading and error states.
 * @property {(params: CreateCustomLanguageModelProviderParams) => Promise<LanguageModelProvider>} createProvider - A function to create a new provider.
 * @property {(params: CreateCustomLanguageModelProviderParams) => Promise<LanguageModelProvider>} editProvider - A function to edit an existing provider.
 * @property {(providerId: string) => Promise<void>} deleteProvider - A function to delete a provider.
 * @property {boolean} isCreating - Whether a provider is being created.
 * @property {boolean} isEditing - Whether a provider is being edited.
 * @property {boolean} isDeleting - Whether a provider is being deleted.
 * @property {Error | null} error - The error object if any of the mutations fail.
 */
export function useCustomLanguageModelProvider() {
  const queryClient = useQueryClient();
  const ipcClient = IpcClient.getInstance();

  const createProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      if (!params.id.trim()) {
        throw new Error("Provider ID is required");
      }
      if (!params.name.trim()) {
        throw new Error("Provider name is required");
      }
      if (!params.apiBaseUrl.trim()) {
        throw new Error("API base URL is required");
      }

      return ipcClient.createCustomLanguageModelProvider({
        id: params.id.trim(),
        name: params.name.trim(),
        apiBaseUrl: params.apiBaseUrl.trim(),
        envVarName: params.envVarName?.trim() || undefined,
      });
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["languageModelProviders"] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const editProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      if (!params.id.trim()) {
        throw new Error("Provider ID is required");
      }
      if (!params.name.trim()) {
        throw new Error("Provider name is required");
      }
      if (!params.apiBaseUrl.trim()) {
        throw new Error("API base URL is required");
      }

      return ipcClient.editCustomLanguageModelProvider({
        id: params.id.trim(),
        name: params.name.trim(),
        apiBaseUrl: params.apiBaseUrl.trim(),
        envVarName: params.envVarName?.trim() || undefined,
      });
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["languageModelProviders"] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (providerId: string): Promise<void> => {
      if (!providerId) {
        throw new Error("Provider ID is required");
      }

      return ipcClient.deleteCustomLanguageModelProvider(providerId);
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["languageModelProviders"] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const createProvider = async (
    params: CreateCustomLanguageModelProviderParams,
  ): Promise<LanguageModelProvider> => {
    return createProviderMutation.mutateAsync(params);
  };

  const editProvider = async (
    params: CreateCustomLanguageModelProviderParams,
  ): Promise<LanguageModelProvider> => {
    return editProviderMutation.mutateAsync(params);
  };

  const deleteProvider = async (providerId: string): Promise<void> => {
    return deleteProviderMutation.mutateAsync(providerId);
  };

  return {
    createProvider,
    editProvider,
    deleteProvider,
    isCreating: createProviderMutation.isPending,
    isEditing: editProviderMutation.isPending,
    isDeleting: deleteProviderMutation.isPending,
    error:
      createProviderMutation.error ||
      editProviderMutation.error ||
      deleteProviderMutation.error,
  };
}
