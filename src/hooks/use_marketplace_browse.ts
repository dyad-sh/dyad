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
  InstallAssetRequest,
  DropPurchaseRecord,
  DropOwnershipRecord,
  JoyStoreRecord,
  MyDropsParams,
  MyClaimsParams,
  OwnershipParams,
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
  myDrops: (params?: MyDropsParams) =>
    [...marketplaceKeys.all, "my-drops", params] as const,
  myClaims: (params?: MyClaimsParams) =>
    [...marketplaceKeys.all, "my-claims", params] as const,
  ownership: (params?: OwnershipParams) =>
    [...marketplaceKeys.all, "ownership", params] as const,
  myStores: (wallet?: string) =>
    [...marketplaceKeys.all, "my-stores", wallet ?? null] as const,
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

// ──────────────────────────────────────────────────────────────────────────
// Wallet-scoped read hooks
//
// All four route through the DropERC1155 + Stores Goldsky subgraphs via
// `marketplace:my-*` IPC handlers. They are no-op (`enabled: false`) when
// no wallet is connected so the renderer can call them unconditionally.
// ──────────────────────────────────────────────────────────────────────────

/** Drops authored by `wallet`. Returns an empty browse result while disabled. */
export function useMyDrops(
  wallet: string | null | undefined,
  options?: Omit<MyDropsParams, "wallet">,
) {
  const params: MyDropsParams | null = wallet ? { wallet, ...options } : null;
  return useQuery({
    queryKey: marketplaceKeys.myDrops(params ?? undefined),
    queryFn: () => client.marketplaceMyDrops(params!),
    enabled: !!wallet,
    staleTime: 60_000,
  });
}

/** Raw on-chain claim() events for `wallet`. */
export function useMyClaims(
  wallet: string | null | undefined,
  options?: Omit<MyClaimsParams, "wallet">,
) {
  const params: MyClaimsParams | null = wallet ? { wallet, ...options } : null;
  return useQuery<DropPurchaseRecord[]>({
    queryKey: marketplaceKeys.myClaims(params ?? undefined),
    queryFn: () => client.marketplaceMyClaims(params!),
    enabled: !!wallet,
    staleTime: 60_000,
  });
}

/** Aggregate ownership of a tokenId for `wallet`, or null if never claimed. */
export function useOwnership(
  tokenId: string | number | null | undefined,
  wallet: string | null | undefined,
) {
  const params: OwnershipParams | null =
    tokenId !== null && tokenId !== undefined && wallet
      ? { tokenId, wallet }
      : null;
  return useQuery<DropOwnershipRecord | null>({
    queryKey: marketplaceKeys.ownership(params ?? undefined),
    queryFn: () => client.marketplaceOwnership(params!),
    enabled: !!params,
    staleTime: 30_000,
  });
}

/** Stores associated with `wallet` via .joy domain ownership. */
export function useMyStores(
  wallet: string | null | undefined,
  first?: number,
) {
  return useQuery<JoyStoreRecord[]>({
    queryKey: marketplaceKeys.myStores(wallet ?? undefined),
    queryFn: () => client.marketplaceMyStores({ wallet: wallet!, first }),
    enabled: !!wallet,
    staleTime: 5 * 60_000,
  });
}
