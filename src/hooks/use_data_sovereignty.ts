/**
 * Data Sovereignty React Hooks
 * 
 * Complete hooks for protecting, containing, and monetizing user data
 */

import { useCallback, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import type {
  ProtectedDataAsset,
  DataSovereigntyVault,
  DataMonetization,
  AntiHarvestingConfig,
  ProtectDataRequest,
  ProtectDataResult,
  RevokeAccessRequest,
  UpdateMonetizationRequest,
  VerifyAccessRequest,
  VerifyAccessResult,
  SovereigntyAnalytics,
  AccessLogEntry,
  BatchProtectRequest,
  BatchProtectResult,
  ProtectionLevel,
} from "@/types/data_sovereignty_types";

import type { WalletAddress } from "@/types/jcn_types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const sovereigntyKeys = {
  all: ["sovereignty"] as const,
  vault: (owner: WalletAddress) => [...sovereigntyKeys.all, "vault", owner] as const,
  assets: (owner: WalletAddress) => [...sovereigntyKeys.all, "assets", owner] as const,
  asset: (assetId: string) => [...sovereigntyKeys.all, "asset", assetId] as const,
  analytics: (owner: WalletAddress, period?: string) => 
    [...sovereigntyKeys.all, "analytics", owner, period] as const,
  accessLogs: (assetId: string) => 
    [...sovereigntyKeys.all, "access-logs", assetId] as const,
  blocklist: () => [...sovereigntyKeys.all, "blocklist"] as const,
} as const;

// =============================================================================
// IPC RENDERER ACCESS
// =============================================================================

type IpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

function getIpcRenderer(): IpcRenderer {
  const electron = (window as any).electron;
  if (!electron?.ipcRenderer) {
    throw new Error("IPC not available - are you running in Electron?");
  }
  return electron.ipcRenderer;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return getIpcRenderer().invoke(channel, ...args) as Promise<T>;
}

// =============================================================================
// VAULT HOOKS
// =============================================================================

/**
 * Hook to get the user's data sovereignty vault
 */
export function useDataVault(
  owner: WalletAddress,
  options?: Omit<UseQueryOptions<DataSovereigntyVault>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.vault(owner),
    queryFn: () => invoke<DataSovereigntyVault>("sovereignty:get-vault", owner),
    enabled: !!owner,
    ...options,
  });
}

/**
 * Hook to update vault settings
 */
export function useUpdateVault() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ vaultId, updates }: { vaultId: string; updates: Partial<DataSovereigntyVault> }) => {
      return invoke<DataSovereigntyVault>("sovereignty:update-vault", vaultId, updates);
    },
    onSuccess: (vault) => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.vault(vault.owner) });
    },
  });
}

// =============================================================================
// ASSET HOOKS
// =============================================================================

/**
 * Hook to list all protected assets for an owner
 */
export function useProtectedAssets(
  owner: WalletAddress,
  options?: Omit<UseQueryOptions<ProtectedDataAsset[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.assets(owner),
    queryFn: () => invoke<ProtectedDataAsset[]>("sovereignty:list-assets", owner),
    enabled: !!owner,
    ...options,
  });
}

/**
 * Hook to get a single protected asset
 */
export function useProtectedAsset(
  assetId: string,
  options?: Omit<UseQueryOptions<ProtectedDataAsset | null>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.asset(assetId),
    queryFn: () => invoke<ProtectedDataAsset | null>("sovereignty:get-asset", assetId),
    enabled: !!assetId,
    ...options,
  });
}

/**
 * Hook to protect data
 */
export function useProtectData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: ProtectDataRequest) =>
      invoke<ProtectDataResult>("sovereignty:protect", request),
    onSuccess: (result) => {
      if (result.success && result.asset) {
        queryClient.invalidateQueries({ 
          queryKey: sovereigntyKeys.assets(result.asset.owner) 
        });
        queryClient.invalidateQueries({ 
          queryKey: sovereigntyKeys.vault(result.asset.owner) 
        });
      }
    },
  });
}

/**
 * Hook to batch protect multiple files
 */
export function useBatchProtect() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: BatchProtectRequest) =>
      invoke<BatchProtectResult>("sovereignty:batch-protect", request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.all });
    },
  });
}

/**
 * Hook to delete a protected asset
 */
export function useDeleteAsset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (assetId: string) =>
      invoke<boolean>("sovereignty:delete-asset", assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.all });
    },
  });
}

// =============================================================================
// ACCESS CONTROL HOOKS
// =============================================================================

/**
 * Hook to verify access to an asset
 */
export function useVerifyAccess() {
  return useMutation({
    mutationFn: (request: VerifyAccessRequest) =>
      invoke<VerifyAccessResult>("sovereignty:verify-access", request),
  });
}

/**
 * Hook to grant access to a wallet
 */
export function useGrantAccess() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ assetId, wallet }: { assetId: string; wallet: WalletAddress }) =>
      invoke<{ success: boolean; error?: string }>("sovereignty:grant-access", assetId, wallet),
    onSuccess: (_, { assetId }) => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.asset(assetId) });
    },
  });
}

/**
 * Hook to revoke access
 */
export function useRevokeAccess() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: RevokeAccessRequest) =>
      invoke<{ success: boolean; error?: string }>("sovereignty:revoke-access", request),
    onSuccess: (_, request) => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.asset(request.assetId) });
    },
  });
}

// =============================================================================
// MONETIZATION HOOKS
// =============================================================================

/**
 * Hook to enable monetization on an asset
 */
export function useEnableMonetization() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ assetId, config }: { assetId: string; config: Partial<DataMonetization> }) =>
      invoke<{ success: boolean; asset?: ProtectedDataAsset; error?: string }>("sovereignty:enable-monetization", assetId, config),
    onSuccess: (result) => {
      if (result.success && result.asset) {
        queryClient.invalidateQueries({ queryKey: sovereigntyKeys.asset(result.asset.id) });
        queryClient.invalidateQueries({ queryKey: sovereigntyKeys.assets(result.asset.owner) });
      }
    },
  });
}

/**
 * Hook to update monetization settings
 */
export function useUpdateMonetization() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: UpdateMonetizationRequest) =>
      invoke<{ success: boolean; asset?: ProtectedDataAsset; error?: string }>("sovereignty:update-monetization", request),
    onSuccess: (result) => {
      if (result.success && result.asset) {
        queryClient.invalidateQueries({ queryKey: sovereigntyKeys.asset(result.asset.id) });
      }
    },
  });
}

// =============================================================================
// ANTI-HARVESTING HOOKS
// =============================================================================

/**
 * Hook to update anti-harvesting settings
 */
export function useUpdateAntiHarvesting() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ vaultId, config }: { vaultId: string; config: Partial<AntiHarvestingConfig> }) =>
      invoke<AntiHarvestingConfig>("sovereignty:update-anti-harvesting", vaultId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.all });
    },
  });
}

/**
 * Hook to report a harvester
 */
export function useReportHarvester() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ identifier, reason }: { identifier: string; reason: string }) =>
      invoke<boolean>("sovereignty:report-harvester", identifier, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sovereigntyKeys.blocklist() });
    },
  });
}

/**
 * Hook to get blocked harvesters
 */
export function useBlockedHarvesters(
  options?: Omit<UseQueryOptions<string[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.blocklist(),
    queryFn: () => invoke<string[]>("sovereignty:get-blocklist"),
    ...options,
  });
}

// =============================================================================
// ANALYTICS HOOKS
// =============================================================================

/**
 * Hook to get sovereignty analytics
 */
export function useSovereigntyAnalytics(
  owner: WalletAddress,
  period?: "day" | "week" | "month" | "year" | "all",
  options?: Omit<UseQueryOptions<SovereigntyAnalytics>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.analytics(owner, period),
    queryFn: () => invoke<SovereigntyAnalytics>("sovereignty:get-analytics", owner, period),
    enabled: !!owner,
    refetchInterval: 60000, // Refresh every minute
    ...options,
  });
}

/**
 * Hook to get access logs for an asset
 */
export function useAccessLogs(
  assetId: string,
  limit?: number,
  options?: Omit<UseQueryOptions<AccessLogEntry[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: sovereigntyKeys.accessLogs(assetId),
    queryFn: () => invoke<AccessLogEntry[]>("sovereignty:get-access-logs", assetId, limit),
    enabled: !!assetId,
    ...options,
  });
}

// =============================================================================
// COMBINED WORKFLOW HOOKS
// =============================================================================

/**
 * Hook for the complete protection workflow
 */
export function useProtectionWorkflow() {
  const protectData = useProtectData();
  const enableMonetization = useEnableMonetization();
  const [status, setStatus] = useState<"idle" | "protecting" | "monetizing" | "complete" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  
  const protect = useCallback(async (
    request: ProtectDataRequest & {
      enableMonetization?: boolean;
      monetizationConfig?: Partial<DataMonetization>;
    }
  ) => {
    setStatus("protecting");
    setError(null);
    
    try {
      // Step 1: Protect the data
      const protectResult = await protectData.mutateAsync(request);
      
      if (!protectResult.success || !protectResult.asset) {
        setError(protectResult.error || "Failed to protect data");
        setStatus("error");
        return null;
      }
      
      // Step 2: Enable monetization if requested
      if (request.enableMonetization) {
        setStatus("monetizing");
        const monetizationResult = await enableMonetization.mutateAsync({
          assetId: protectResult.asset.id,
          config: request.monetizationConfig || {},
        });
        
        if (!monetizationResult.success) {
          setError(monetizationResult.error || "Failed to enable monetization");
          setStatus("error");
          return protectResult.asset; // Return asset even if monetization failed
        }
        
        setStatus("complete");
        return monetizationResult.asset;
      }
      
      setStatus("complete");
      return protectResult.asset;
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
      return null;
    }
  }, [protectData, enableMonetization]);
  
  return {
    protect,
    status,
    error,
    isLoading: status === "protecting" || status === "monetizing",
    reset: () => {
      setStatus("idle");
      setError(null);
    },
  };
}

/**
 * Hook for complete data sovereignty dashboard
 */
export function useDataSovereigntyDashboard(owner: WalletAddress) {
  const { data: vault, isLoading: vaultLoading } = useDataVault(owner);
  const { data: assets, isLoading: assetsLoading } = useProtectedAssets(owner);
  const { data: analytics, isLoading: analyticsLoading } = useSovereigntyAnalytics(owner, "month");
  
  // Derived statistics
  const unprotectedAssets = assets?.filter(a => a.protectionLevel === "unprotected") || [];
  const encryptedAssets = assets?.filter(a => a.protectionLevel === "encrypted") || [];
  const sealedAssets = assets?.filter(a => a.protectionLevel === "sealed") || [];
  const sovereignAssets = assets?.filter(a => a.protectionLevel === "sovereign") || [];
  const monetizedAssets = assets?.filter(a => a.protectionLevel === "monetized") || [];
  
  const totalSizeBytes = assets?.reduce((sum, a) => sum + a.originalSizeBytes, 0) || 0;
  const protectedSizeBytes = assets
    ?.filter(a => a.protectionLevel !== "unprotected")
    .reduce((sum, a) => sum + a.originalSizeBytes, 0) || 0;
  
  return {
    vault,
    assets: assets || [],
    analytics,
    isLoading: vaultLoading || assetsLoading || analyticsLoading,
    
    // Counts by protection level
    counts: {
      total: assets?.length || 0,
      unprotected: unprotectedAssets.length,
      encrypted: encryptedAssets.length,
      sealed: sealedAssets.length,
      sovereign: sovereignAssets.length,
      monetized: monetizedAssets.length,
    },
    
    // Size statistics
    sizes: {
      totalBytes: totalSizeBytes,
      protectedBytes: protectedSizeBytes,
      protectionPercent: totalSizeBytes > 0 
        ? Math.round((protectedSizeBytes / totalSizeBytes) * 100) 
        : 0,
    },
    
    // Revenue
    revenue: {
      total: analytics?.totalRevenue || 0,
      byCurrency: analytics?.revenueByCurrency || {},
      topAssets: analytics?.topAssetsByRevenue || [],
    },
    
    // Access stats
    access: {
      total: analytics?.totalAccesses || 0,
      granted: analytics?.accessesGranted || 0,
      denied: analytics?.accessesDenied || 0,
      harvestingBlocked: analytics?.harvestingBlocked || 0,
    },
  };
}

/**
 * Hook to quickly protect and monetize a file
 */
export function useQuickProtectAndMonetize() {
  const workflow = useProtectionWorkflow();
  
  return useCallback(async (
    filePath: string,
    options: {
      name?: string;
      price: number;
      currency?: "USDC" | "MATIC" | "ETH" | "JOY";
      royaltyPercent?: number;
      allowedUses?: string[];
      listOnMarketplace?: boolean;
    }
  ) => {
    return workflow.protect({
      assetIdOrPath: filePath,
      targetLevel: "monetized",
      encryption: {
        algorithm: "aes-256-gcm",
        keyStorage: "local-vault",
      },
      accessControl: {
        nftGated: true,
        requireSignature: true,
        meteringEnabled: true,
      },
      enableMonetization: true,
      monetizationConfig: {
        enabled: true,
        price: options.price,
        currency: options.currency || "USDC",
        royaltyPercent: options.royaltyPercent || 10,
        pricingModel: "one-time",
        license: {
          type: "commercial",
          allowedUses: (options.allowedUses || ["inference"]) as any[],
          prohibitedUses: ["resale", "scraping"],
          attributionRequired: true,
          commercialUse: true,
          canSublicense: false,
          canModify: false,
          canRedistribute: false,
        },
      },
      listOnMarketplace: options.listOnMarketplace,
    });
  }, [workflow]);
}
