/**
 * Deployed Contract Client
 * Renderer-side API for managing deployed marketplace contracts and NFT-gated inference access.
 * 
 * Features:
 * - Fetch all deployed contracts from marketplace
 * - Verify NFT ownership for inference access
 * - Request decryption keys for protected data
 * - Deploy new inference access contracts
 * - Mint and manage inference access NFTs
 */

import type { IpcRenderer } from "electron";
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
  ContractAddress,
  TokenId,
} from "@/types/deployed_contract_types";
import type { WalletAddress, Cid } from "@/types/jcn_types";

// =============================================================================
// IPC RENDERER ACCESS
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC not available - are you running in Electron?");
    }
  }
  return ipcRenderer;
}

// =============================================================================
// CLIENT API
// =============================================================================

export const DeployedContractClient = {
  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  /**
   * Configure the contract client with API credentials
   */
  async configure(
    apiKey: string,
    publisherId?: string
  ): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("contracts:configure", apiKey, publisherId);
  },

  // ===========================================================================
  // FETCH CONTRACTS
  // ===========================================================================

  /**
   * Fetch all deployed contracts from the marketplace
   * @param query Optional query filters
   */
  async fetchDeployedContracts(
    query?: ContractQuery
  ): Promise<DeployedContract[]> {
    return getIpcRenderer().invoke("contracts:fetch-deployed", query);
  },

  /**
   * Fetch inference access NFTs
   * @param query Optional query filters
   */
  async fetchInferenceNFTs(
    query?: NFTAccessQuery
  ): Promise<InferenceAccessNFT[]> {
    return getIpcRenderer().invoke("contracts:fetch-inference-nfts", query);
  },

  /**
   * Get all inference access NFTs owned by a wallet
   */
  async getOwnedNFTs(walletAddress: WalletAddress): Promise<InferenceAccessNFT[]> {
    return getIpcRenderer().invoke("contracts:get-owned-nfts", walletAddress);
  },

  /**
   * Get the inference access contract for a specific asset
   */
  async getContractForAsset(assetCid: Cid): Promise<DeployedContract | null> {
    return getIpcRenderer().invoke("contracts:get-for-asset", assetCid);
  },

  // ===========================================================================
  // INFERENCE ACCESS VERIFICATION
  // ===========================================================================

  /**
   * Verify that a wallet has inference access to an asset via NFT ownership.
   * This is the core access control function - call before running inference.
   * 
   * @param request The access request with wallet, asset, and signature
   * @returns Verification result with session info if granted
   */
  async verifyInferenceAccess(
    request: InferenceAccessRequest
  ): Promise<InferenceAccessVerification> {
    return getIpcRenderer().invoke("contracts:verify-access", request);
  },

  /**
   * Helper to create a signed access request
   * @param wallet Connected wallet
   * @param assetCid Asset to access
   * @param contractAddress NFT contract address
   * @param signer Ethers signer
   */
  async createAccessRequest(
    wallet: WalletAddress,
    assetCid: Cid,
    contractAddress: ContractAddress,
    signer: { signMessage: (message: string) => Promise<string> },
    options?: {
      tokenId?: TokenId;
      requestType?: "inference" | "batch" | "stream" | "embed";
      agentId?: string;
    }
  ): Promise<InferenceAccessRequest> {
    const timestamp = Date.now();
    const message = `JoyCreate Inference Access Request\n\nAsset: ${assetCid}\nContract: ${contractAddress}\nTimestamp: ${timestamp}\n\nI confirm I am the owner of the NFT granting access to this asset.`;
    
    const signature = await signer.signMessage(message);
    
    return {
      requesterWallet: wallet,
      assetCid,
      contractAddress,
      tokenId: options?.tokenId,
      signature,
      signedMessage: message,
      requestType: options?.requestType || "inference",
      agentId: options?.agentId,
    };
  },

  // ===========================================================================
  // ENCRYPTED DATA ACCESS
  // ===========================================================================

  /**
   * Request a decryption key for protected data.
   * Requires NFT ownership verification.
   */
  async requestDecryptionKey(
    params: RequestDecryptionKeyParams
  ): Promise<DecryptionKeyResponse> {
    return getIpcRenderer().invoke("contracts:request-decryption-key", params);
  },

  /**
   * Helper to create a decryption key request with signature
   */
  async createDecryptionRequest(
    tokenId: TokenId,
    contractAddress: ContractAddress,
    wallet: WalletAddress,
    signer: { signMessage: (message: string) => Promise<string> },
    accessPurpose: "inference" | "fine_tuning" | "evaluation" | "training",
    agentId?: string
  ): Promise<RequestDecryptionKeyParams> {
    const timestamp = Date.now();
    const message = `JoyCreate Decryption Key Request\n\nToken: ${tokenId}\nContract: ${contractAddress}\nPurpose: ${accessPurpose}\nTimestamp: ${timestamp}\n\nI confirm I am the NFT owner and authorize this decryption.`;
    
    const signature = await signer.signMessage(message);
    
    return {
      tokenId,
      contractAddress,
      requesterWallet: wallet,
      ownershipProof: signature,
      signedMessage: message,
      accessPurpose,
      agentId,
    };
  },

  // ===========================================================================
  // CONTRACT DEPLOYMENT
  // ===========================================================================

  /**
   * Deploy a new inference access contract
   */
  async deployContract(
    request: DeployContractRequest
  ): Promise<DeployContractResult> {
    return getIpcRenderer().invoke("contracts:deploy", request);
  },

  // ===========================================================================
  // NFT MINTING
  // ===========================================================================

  /**
   * Mint a new inference access NFT
   */
  async mintAccessNFT(
    request: MintInferenceNFTRequest
  ): Promise<MintInferenceNFTResult> {
    return getIpcRenderer().invoke("contracts:mint-access-nft", request);
  },

  // ===========================================================================
  // USAGE TRACKING
  // ===========================================================================

  /**
   * Record inference usage for an NFT (called after inference completes)
   */
  async recordUsage(
    tokenId: TokenId,
    contractAddress: ContractAddress,
    usage: {
      inputTokens: number;
      outputTokens: number;
      computeMs: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    return getIpcRenderer().invoke(
      "contracts:record-usage",
      tokenId,
      contractAddress,
      usage
    );
  },

  // ===========================================================================
  // AUDIT LOGS
  // ===========================================================================

  /**
   * Get audit logs for contract activity
   */
  async getAuditLogs(
    contractAddress?: string,
    startDate?: string,
    endDate?: string
  ): Promise<ContractAuditEntry[]> {
    return getIpcRenderer().invoke(
      "contracts:get-audit-logs",
      contractAddress,
      startDate,
      endDate
    );
  },

  // ===========================================================================
  // HELPER UTILITIES
  // ===========================================================================

  /**
   * Check if a wallet can access an asset (convenience wrapper)
   */
  async canAccess(
    wallet: WalletAddress,
    assetCid: Cid,
    signer: { signMessage: (message: string) => Promise<string> }
  ): Promise<{ canAccess: boolean; reason?: string; nft?: InferenceAccessNFT }> {
    // First check if there's a contract for this asset
    const contract = await this.getContractForAsset(assetCid);
    if (!contract) {
      return { canAccess: false, reason: "No access contract found for this asset" };
    }

    // Check if wallet owns any access NFTs
    const ownedNFTs = await this.getOwnedNFTs(wallet);
    const accessNFT = ownedNFTs.find(nft => nft.assetCid === assetCid);
    
    if (!accessNFT) {
      return { canAccess: false, reason: "No access NFT found for this asset" };
    }

    // Create and verify access request
    const request = await this.createAccessRequest(
      wallet,
      assetCid,
      contract.address,
      signer,
      { tokenId: accessNFT.tokenId }
    );

    const verification = await this.verifyInferenceAccess(request);
    
    return {
      canAccess: verification.granted,
      reason: verification.denialReason,
      nft: accessNFT,
    };
  },

  /**
   * Get all contracts by type
   */
  async getContractsByType(
    type: DeployedContract["type"]
  ): Promise<DeployedContract[]> {
    return this.fetchDeployedContracts({ type: [type] });
  },

  /**
   * Get all active inference contracts
   */
  async getActiveInferenceContracts(): Promise<DeployedContract[]> {
    return this.fetchDeployedContracts({
      type: ["inference_access"],
      status: ["deployed", "verified"],
    });
  },
};

export default DeployedContractClient;
