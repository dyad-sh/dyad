/**
 * Deployed Contracts React Hooks
 * TanStack Query hooks for managing deployed marketplace contracts and NFT-gated inference access.
 * 
 * These hooks provide:
 * - Contract fetching with caching
 * - NFT ownership queries
 * - Inference access verification
 * - Mutation hooks for minting/deploying
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DeployedContractClient } from "@/ipc/deployed_contract_client";
import type {
  DeployedContract,
  InferenceAccessNFT,
  InferenceAccessRequest,
  InferenceAccessVerification,
  ContractQuery,
  NFTAccessQuery,
  DeployContractRequest,
  DeployContractResult,
  MintInferenceNFTRequest,
  MintInferenceNFTResult,
  RequestDecryptionKeyParams,
  DecryptionKeyResponse,
  ContractAuditEntry,
  TokenId,
  ContractAddress,
} from "@/types/deployed_contract_types";
import type { WalletAddress, Cid } from "@/types/jcn_types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const contractQueryKeys = {
  all: ["contracts"] as const,
  deployed: (query?: ContractQuery) => ["contracts", "deployed", query] as const,
  inferenceNfts: (query?: NFTAccessQuery) => ["contracts", "inference-nfts", query] as const,
  ownedNfts: (wallet: WalletAddress) => ["contracts", "owned-nfts", wallet] as const,
  contractForAsset: (assetCid: Cid) => ["contracts", "asset", assetCid] as const,
  auditLogs: (contractAddress?: string, startDate?: string, endDate?: string) =>
    ["contracts", "audit-logs", contractAddress, startDate, endDate] as const,
} as const;

// =============================================================================
// FETCH DEPLOYED CONTRACTS
// =============================================================================

/**
 * Hook to fetch all deployed contracts from the marketplace
 */
export function useDeployedContracts(query?: ContractQuery) {
  return useQuery({
    queryKey: contractQueryKeys.deployed(query),
    queryFn: () => DeployedContractClient.fetchDeployedContracts(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch contracts filtered by type
 */
export function useContractsByType(type: DeployedContract["type"]) {
  return useQuery({
    queryKey: contractQueryKeys.deployed({ type: [type] }),
    queryFn: () => DeployedContractClient.getContractsByType(type),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch active inference access contracts
 */
export function useActiveInferenceContracts() {
  return useQuery({
    queryKey: contractQueryKeys.deployed({ type: ["inference_access"], status: ["deployed", "verified"] }),
    queryFn: () => DeployedContractClient.getActiveInferenceContracts(),
    staleTime: 5 * 60 * 1000,
  });
}

// =============================================================================
// FETCH INFERENCE ACCESS NFTS
// =============================================================================

/**
 * Hook to fetch inference access NFTs
 */
export function useInferenceAccessNFTs(query?: NFTAccessQuery) {
  return useQuery({
    queryKey: contractQueryKeys.inferenceNfts(query),
    queryFn: () => DeployedContractClient.fetchInferenceNFTs(query),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch NFTs owned by a specific wallet
 */
export function useOwnedInferenceNFTs(walletAddress?: WalletAddress) {
  return useQuery({
    queryKey: contractQueryKeys.ownedNfts(walletAddress || ""),
    queryFn: () => DeployedContractClient.getOwnedNFTs(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to get the contract for a specific asset
 */
export function useContractForAsset(assetCid?: Cid) {
  return useQuery({
    queryKey: contractQueryKeys.contractForAsset(assetCid || ""),
    queryFn: () => DeployedContractClient.getContractForAsset(assetCid!),
    enabled: !!assetCid,
    staleTime: 5 * 60 * 1000,
  });
}

// =============================================================================
// INFERENCE ACCESS VERIFICATION
// =============================================================================

/**
 * Hook to verify inference access (mutation-style for on-demand verification)
 */
export function useVerifyInferenceAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: InferenceAccessRequest) =>
      DeployedContractClient.verifyInferenceAccess(request),
    onSuccess: (result, request) => {
      if (result.granted) {
        toast.success("Inference access verified", {
          description: `Session valid until ${new Date(result.sessionExpiresAt).toLocaleTimeString()}`,
        });
      } else {
        toast.error("Access denied", {
          description: result.denialReason,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Verification failed", {
        description: error.message,
      });
    },
  });
}

/**
 * Hook to check if a wallet can access an asset
 */
export function useCanAccess(
  wallet?: WalletAddress,
  assetCid?: Cid,
  signer?: { signMessage: (message: string) => Promise<string> }
) {
  return useQuery({
    queryKey: ["contracts", "can-access", wallet, assetCid],
    queryFn: async () => {
      if (!wallet || !assetCid || !signer) {
        return { canAccess: false, reason: "Missing parameters" };
      }
      return DeployedContractClient.canAccess(wallet, assetCid, signer);
    },
    enabled: !!wallet && !!assetCid && !!signer,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// =============================================================================
// DECRYPTION KEY REQUEST
// =============================================================================

/**
 * Hook to request a decryption key for protected data
 */
export function useRequestDecryptionKey() {
  return useMutation({
    mutationFn: (params: RequestDecryptionKeyParams) =>
      DeployedContractClient.requestDecryptionKey(params),
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Decryption key retrieved", {
          description: `Valid until ${result.validUntil ? new Date(result.validUntil).toLocaleTimeString() : "session end"}`,
        });
      } else {
        toast.error("Failed to get decryption key", {
          description: result.error,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Decryption request failed", {
        description: error.message,
      });
    },
  });
}

// =============================================================================
// CONTRACT DEPLOYMENT
// =============================================================================

/**
 * Hook to deploy a new inference access contract
 */
export function useDeployContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: DeployContractRequest) =>
      DeployedContractClient.deployContract(request),
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Contract deployed!", {
          description: `Address: ${result.contract?.address.slice(0, 10)}...`,
        });
        // Invalidate contracts cache
        queryClient.invalidateQueries({ queryKey: contractQueryKeys.all });
      } else {
        toast.error("Deployment failed", {
          description: result.error,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Contract deployment failed", {
        description: error.message,
      });
    },
  });
}

// =============================================================================
// NFT MINTING
// =============================================================================

/**
 * Hook to mint a new inference access NFT
 */
export function useMintInferenceNFT() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: MintInferenceNFTRequest) =>
      DeployedContractClient.mintAccessNFT(request),
    onSuccess: (result, request) => {
      if (result.success) {
        toast.success("NFT minted!", {
          description: `Token ID: ${result.tokenId}`,
        });
        // Invalidate relevant caches
        queryClient.invalidateQueries({
          queryKey: contractQueryKeys.inferenceNfts(),
        });
        queryClient.invalidateQueries({
          queryKey: contractQueryKeys.ownedNfts(request.recipient),
        });
      } else {
        toast.error("Minting failed", {
          description: result.error,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("NFT minting failed", {
        description: error.message,
      });
    },
  });
}

// =============================================================================
// USAGE TRACKING
// =============================================================================

/**
 * Hook to record inference usage
 */
export function useRecordUsage() {
  return useMutation({
    mutationFn: ({
      tokenId,
      contractAddress,
      usage,
    }: {
      tokenId: TokenId;
      contractAddress: ContractAddress;
      usage: { inputTokens: number; outputTokens: number; computeMs: number };
    }) => DeployedContractClient.recordUsage(tokenId, contractAddress, usage),
    onError: (error: Error) => {
      console.error("Failed to record usage:", error);
      // Don't show toast for usage recording failures - it's background operation
    },
  });
}

// =============================================================================
// AUDIT LOGS
// =============================================================================

/**
 * Hook to fetch audit logs
 */
export function useAuditLogs(
  contractAddress?: string,
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: contractQueryKeys.auditLogs(contractAddress, startDate, endDate),
    queryFn: () =>
      DeployedContractClient.getAuditLogs(contractAddress, startDate, endDate),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Hook to configure the contract client
 */
export function useConfigureContractClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      apiKey,
      publisherId,
    }: {
      apiKey: string;
      publisherId?: string;
    }) => DeployedContractClient.configure(apiKey, publisherId),
    onSuccess: () => {
      toast.success("Contract client configured");
      // Invalidate all contract queries to refetch with new credentials
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.all });
    },
    onError: (error: Error) => {
      toast.error("Configuration failed", {
        description: error.message,
      });
    },
  });
}

// =============================================================================
// HELPER HOOKS
// =============================================================================

/**
 * Combined hook for inference access flow:
 * 1. Check if contract exists for asset
 * 2. Check if wallet owns access NFT
 * 3. Provide verification mutation
 */
export function useInferenceAccessFlow(
  wallet?: WalletAddress,
  assetCid?: Cid
) {
  const contractQuery = useContractForAsset(assetCid);
  const ownedNftsQuery = useOwnedInferenceNFTs(wallet);
  const verifyMutation = useVerifyInferenceAccess();

  // Find matching NFT for this asset
  const accessNft = ownedNftsQuery.data?.find(
    (nft) => nft.assetCid === assetCid
  );

  const hasAccess = !!accessNft && accessNft.isActive;

  return {
    // Queries
    contract: contractQuery.data,
    contractLoading: contractQuery.isLoading,
    contractError: contractQuery.error,

    // Owned NFTs
    ownedNfts: ownedNftsQuery.data,
    ownedNftsLoading: ownedNftsQuery.isLoading,

    // Access state
    accessNft,
    hasAccess,

    // Verification
    verify: verifyMutation.mutate,
    verifying: verifyMutation.isPending,
    verificationResult: verifyMutation.data,

    // Combined loading state
    isLoading: contractQuery.isLoading || ownedNftsQuery.isLoading,
  };
}
