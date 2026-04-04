/**
 * Marketplace Browse Hooks — TanStack Query integration for the marketplace explorer.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { IpcClient } from "../ipc/ipc_client";
import type {
  MarketplaceBrowseParams,
  MarketplaceBrowseResult,
  MarketplaceAssetDetail,
  InstallAssetRequest,
  InstallAssetResult,
} from "@/types/publish_types";
import { showError } from "@/lib/toast";

const client = IpcClient.getInstance();

// ============================================================================
// Query Keys
// ============================================================================

export const marketplaceKeys = {
  all: ["marketplace"] as const,
  browse: (params?: MarketplaceBrowseParams) =>
    [...marketplaceKeys.all, "browse", params] as const,
  detail: (assetId: string) =>
    [...marketplaceKeys.all, "detail", assetId] as const,
  featured: () => [...marketplaceKeys.all, "featured"] as const,
  categories: () => [...marketplaceKeys.all, "categories"] as const,
};

// ============================================================================
// Hooks
// ============================================================================

export function useMarketplaceBrowse(params?: MarketplaceBrowseParams) {
  return useQuery({
    queryKey: marketplaceKeys.browse(params),
    queryFn: () => client.marketplaceBrowse(params ?? {}),
    staleTime: 60_000,
  });
}

export function useMarketplaceAssetDetail(assetId: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.detail(assetId ?? ""),
    queryFn: () => client.marketplaceAssetDetail(assetId!),
    enabled: !!assetId,
  });
}

export function useMarketplaceFeatured() {
  return useQuery({
    queryKey: marketplaceKeys.featured(),
    queryFn: () => client.marketplaceFeatured(),
    staleTime: 300_000,
  });
}

export function useMarketplaceCategories() {
  return useQuery({
    queryKey: marketplaceKeys.categories(),
    queryFn: () => client.marketplaceCategories(),
    staleTime: 300_000,
  });
}

export function useInstallAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: InstallAssetRequest) =>
      client.marketplaceInstallAsset(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["creator"] });
    },
    onError: (error) => {
      showError(error instanceof Error ? error : new Error(String(error)));
    },
  });
}
