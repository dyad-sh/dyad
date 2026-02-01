/**
 * Deployed Contract IPC Handlers
 * Manages deployed marketplace contracts and NFT-gated inference access.
 * 
 * Features:
 * - Fetch deployed contracts from marketplace
 * - Verify NFT ownership for inference access
 * - Manage encrypted data decryption
 * - Track usage and audit access
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import { ethers } from "ethers";
import log from "electron-log";

import {
  CONTRACT_ADDRESSES,
  CONTRACT_ABIS,
  POLYGON_MAINNET,
  JOYMARKETPLACE_API,
} from "@/config/joymarketplace";

import type {
  DeployedContract,
  InferenceAccessNFT,
  InferenceLicense,
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
  ContractType,
  ContractStatus,
  DataProtectionSettings,
  InferenceUsageLimits,
  InferenceUsageStats,
  ContractAddress,
  TokenId,
} from "@/types/deployed_contract_types";

import type { BlockchainNetwork, NFTLicenseType } from "@/types/nft_types";
import type { WalletAddress, Cid } from "@/types/jcn_types";

const logger = log.scope("deployed_contract_handlers");

// =============================================================================
// CONFIGURATION
// =============================================================================

interface ContractConfig {
  apiKey?: string;
  publisherId?: string;
  defaultNetwork: BlockchainNetwork;
  rpcUrls: Record<BlockchainNetwork, string>;
}

let contractConfig: ContractConfig = {
  defaultNetwork: "polygon",
  rpcUrls: {
    polygon: POLYGON_MAINNET.rpcUrl,
    ethereum: "https://eth.llamarpc.com",
    base: "https://mainnet.base.org",
    arbitrum: "https://arb1.arbitrum.io/rpc",
    solana: "https://api.mainnet-beta.solana.com",
    "joy-chain": "https://rpc.joychain.io",
  },
};

// Provider cache
const providers: Map<BlockchainNetwork, ethers.JsonRpcProvider> = new Map();

function getProvider(network: BlockchainNetwork): ethers.JsonRpcProvider {
  let provider = providers.get(network);
  if (!provider) {
    const rpcUrl = contractConfig.rpcUrls[network];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for network: ${network}`);
    }
    provider = new ethers.JsonRpcProvider(rpcUrl);
    providers.set(network, provider);
  }
  return provider;
}

// =============================================================================
// DATA DIRECTORIES
// =============================================================================

function getContractDataDir(): string {
  return path.join(app.getPath("userData"), "deployed_contracts");
}

function getAuditLogDir(): string {
  return path.join(app.getPath("userData"), "contract_audit_logs");
}

async function ensureDirectories(): Promise<void> {
  await fs.ensureDir(getContractDataDir());
  await fs.ensureDir(getAuditLogDir());
}

// =============================================================================
// CONTRACT CACHE
// =============================================================================

interface ContractCache {
  contracts: DeployedContract[];
  nfts: InferenceAccessNFT[];
  lastFetched: number;
  ttlMs: number;
}

const contractCache: ContractCache = {
  contracts: [],
  nfts: [],
  lastFetched: 0,
  ttlMs: 5 * 60 * 1000, // 5 minutes
};

function isCacheValid(): boolean {
  return Date.now() - contractCache.lastFetched < contractCache.ttlMs;
}

// =============================================================================
// FETCH DEPLOYED CONTRACTS FROM MARKETPLACE
// =============================================================================

async function fetchDeployedContracts(
  query?: ContractQuery
): Promise<DeployedContract[]> {
  await ensureDirectories();
  
  // Check cache first
  if (isCacheValid() && contractCache.contracts.length > 0 && !query) {
    logger.debug("Returning cached contracts");
    return contractCache.contracts;
  }
  
  try {
    // Fetch from JoyMarketplace API
    const url = new URL(`${JOYMARKETPLACE_API.baseUrl}/contracts`);
    
    if (query) {
      if (query.type) url.searchParams.set("type", query.type.join(","));
      if (query.network) url.searchParams.set("network", query.network.join(","));
      if (query.status) url.searchParams.set("status", query.status.join(","));
      if (query.owner) url.searchParams.set("owner", query.owner);
      if (query.storeId) url.searchParams.set("storeId", query.storeId);
      if (query.search) url.searchParams.set("search", query.search);
      if (query.offset) url.searchParams.set("offset", String(query.offset));
      if (query.limit) url.searchParams.set("limit", String(query.limit));
    }
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (contractConfig.apiKey) {
      headers["Authorization"] = `Bearer ${contractConfig.apiKey}`;
    }
    
    const response = await fetch(url.toString(), { headers });
    
    if (!response.ok) {
      // If API fails, try loading from local cache file
      logger.warn(`API fetch failed: ${response.status}, falling back to local cache`);
      return loadContractsFromDisk();
    }
    
    const data = await response.json();
    const contracts: DeployedContract[] = data.contracts || [];
    
    // Update cache
    contractCache.contracts = contracts;
    contractCache.lastFetched = Date.now();
    
    // Persist to disk
    await saveContractsToDisk(contracts);
    
    logger.info(`Fetched ${contracts.length} deployed contracts from marketplace`);
    return contracts;
    
  } catch (error) {
    logger.error("Failed to fetch deployed contracts:", error);
    // Fall back to local cache
    return loadContractsFromDisk();
  }
}

async function loadContractsFromDisk(): Promise<DeployedContract[]> {
  const cacheFile = path.join(getContractDataDir(), "contracts_cache.json");
  try {
    if (await fs.pathExists(cacheFile)) {
      return await fs.readJson(cacheFile);
    }
  } catch (error) {
    logger.error("Failed to load contracts from disk:", error);
  }
  return [];
}

async function saveContractsToDisk(contracts: DeployedContract[]): Promise<void> {
  const cacheFile = path.join(getContractDataDir(), "contracts_cache.json");
  try {
    await fs.writeJson(cacheFile, contracts, { spaces: 2 });
  } catch (error) {
    logger.error("Failed to save contracts to disk:", error);
  }
}

// =============================================================================
// FETCH INFERENCE ACCESS NFTS
// =============================================================================

async function fetchInferenceAccessNFTs(
  query?: NFTAccessQuery
): Promise<InferenceAccessNFT[]> {
  await ensureDirectories();
  
  try {
    const url = new URL(`${JOYMARKETPLACE_API.baseUrl}/inference-nfts`);
    
    if (query) {
      if (query.owner) url.searchParams.set("owner", query.owner);
      if (query.assetCid) url.searchParams.set("assetCid", query.assetCid);
      if (query.contractAddress) url.searchParams.set("contract", query.contractAddress);
      if (query.network) url.searchParams.set("network", query.network.join(","));
      if (query.activeOnly) url.searchParams.set("activeOnly", "true");
      if (query.offset) url.searchParams.set("offset", String(query.offset));
      if (query.limit) url.searchParams.set("limit", String(query.limit));
    }
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (contractConfig.apiKey) {
      headers["Authorization"] = `Bearer ${contractConfig.apiKey}`;
    }
    
    const response = await fetch(url.toString(), { headers });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const nfts: InferenceAccessNFT[] = data.nfts || [];
    
    // Update cache
    contractCache.nfts = nfts;
    
    logger.info(`Fetched ${nfts.length} inference access NFTs`);
    return nfts;
    
  } catch (error) {
    logger.error("Failed to fetch inference access NFTs:", error);
    return [];
  }
}

// =============================================================================
// VERIFY NFT OWNERSHIP FOR INFERENCE ACCESS
// =============================================================================

async function verifyInferenceAccess(
  request: InferenceAccessRequest
): Promise<InferenceAccessVerification> {
  const sessionId = crypto.randomUUID();
  const verifiedAt = new Date().toISOString();
  
  try {
    // 1. Verify signature
    const recoveredAddress = ethers.verifyMessage(
      request.signedMessage,
      request.signature
    );
    
    if (recoveredAddress.toLowerCase() !== request.requesterWallet.toLowerCase()) {
      return {
        granted: false,
        denialReason: "Invalid signature - address mismatch",
        sessionId,
        sessionExpiresAt: verifiedAt,
        verifiedAt,
      };
    }
    
    // 2. Check on-chain ownership
    const provider = getProvider("polygon"); // Default to Polygon
    
    const nftContract = new ethers.Contract(
      request.contractAddress,
      [
        "function ownerOf(uint256 tokenId) view returns (address)",
        "function tokenURI(uint256 tokenId) view returns (string)",
        "function balanceOf(address owner) view returns (uint256)",
      ],
      provider
    );
    
    let isOwner = false;
    let tokenId = request.tokenId;
    
    if (tokenId) {
      // Verify specific token ownership
      try {
        const owner = await nftContract.ownerOf(tokenId);
        isOwner = owner.toLowerCase() === request.requesterWallet.toLowerCase();
      } catch {
        isOwner = false;
      }
    } else {
      // Check if wallet owns any token from this contract
      try {
        const balance = await nftContract.balanceOf(request.requesterWallet);
        isOwner = balance > 0n;
      } catch {
        isOwner = false;
      }
    }
    
    if (!isOwner) {
      await logAuditEntry({
        id: crypto.randomUUID(),
        timestamp: verifiedAt,
        contractAddress: request.contractAddress,
        tokenId,
        action: "access",
        actor: request.requesterWallet,
        details: {
          granted: false,
          reason: "Not NFT owner",
          requestType: request.requestType,
        },
        sessionId,
      });
      
      return {
        granted: false,
        denialReason: "Wallet does not own access NFT for this asset",
        sessionId,
        sessionExpiresAt: verifiedAt,
        verifiedAt,
      };
    }
    
    // 3. Fetch NFT metadata and license
    const nft = await fetchNFTDetails(request.contractAddress, tokenId || "0");
    
    if (!nft) {
      return {
        granted: false,
        denialReason: "Unable to fetch NFT details",
        sessionId,
        sessionExpiresAt: verifiedAt,
        verifiedAt,
      };
    }
    
    // 4. Check if NFT is active (not expired/revoked)
    if (!nft.isActive) {
      return {
        granted: false,
        denialReason: "NFT access has been revoked or expired",
        sessionId,
        sessionExpiresAt: verifiedAt,
        verifiedAt,
      };
    }
    
    // 5. Check usage limits
    const usageCheck = checkUsageLimits(nft.usageLimits, nft.currentUsage);
    if (!usageCheck.allowed) {
      return {
        granted: false,
        denialReason: usageCheck.reason,
        sessionId,
        sessionExpiresAt: verifiedAt,
        verifiedAt,
      };
    }
    
    // 6. Check agent access if applicable
    if (request.agentId) {
      const agentCheck = checkAgentAccess(
        nft.dataProtection.agentAccessPolicy,
        request.agentId
      );
      if (!agentCheck.allowed) {
        return {
          granted: false,
          denialReason: agentCheck.reason,
          sessionId,
          sessionExpiresAt: verifiedAt,
          verifiedAt,
        };
      }
    }
    
    // 7. Access granted!
    const sessionExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour session
    
    await logAuditEntry({
      id: crypto.randomUUID(),
      timestamp: verifiedAt,
      contractAddress: request.contractAddress,
      tokenId,
      action: "access",
      actor: request.requesterWallet,
      details: {
        granted: true,
        requestType: request.requestType,
        agentId: request.agentId,
      },
      sessionId,
    });
    
    return {
      granted: true,
      tokenId,
      license: nft.license,
      remainingUsage: {
        inferences: nft.usageLimits.maxInferences
          ? nft.usageLimits.maxInferences - nft.currentUsage.totalInferences
          : undefined,
        tokens: nft.usageLimits.maxTokens
          ? nft.usageLimits.maxTokens - nft.currentUsage.totalTokens
          : undefined,
      },
      sessionExpiresAt: sessionExpiry,
      sessionId,
      verifiedAt,
    };
    
  } catch (error) {
    logger.error("Failed to verify inference access:", error);
    return {
      granted: false,
      denialReason: `Verification error: ${error instanceof Error ? error.message : "Unknown error"}`,
      sessionId,
      sessionExpiresAt: verifiedAt,
      verifiedAt,
    };
  }
}

async function fetchNFTDetails(
  contractAddress: string,
  tokenId: string
): Promise<InferenceAccessNFT | null> {
  try {
    const url = `${JOYMARKETPLACE_API.baseUrl}/inference-nfts/${contractAddress}/${tokenId}`;
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (contractConfig.apiKey) {
      headers["Authorization"] = `Bearer ${contractConfig.apiKey}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    logger.error("Failed to fetch NFT details:", error);
    return null;
  }
}

function checkUsageLimits(
  limits: InferenceUsageLimits,
  usage: InferenceUsageStats
): { allowed: boolean; reason?: string } {
  if (limits.maxInferences && usage.totalInferences >= limits.maxInferences) {
    return { allowed: false, reason: "Maximum inference limit reached" };
  }
  
  if (limits.maxTokens && usage.totalTokens >= limits.maxTokens) {
    return { allowed: false, reason: "Maximum token limit reached" };
  }
  
  if (limits.maxRequestsPerDay && usage.requestsToday >= limits.maxRequestsPerDay) {
    return { allowed: false, reason: "Daily request limit reached" };
  }
  
  if (limits.maxRequestsPerHour && usage.requestsThisHour >= limits.maxRequestsPerHour) {
    return { allowed: false, reason: "Hourly request limit reached" };
  }
  
  return { allowed: true };
}

function checkAgentAccess(
  policy: DataProtectionSettings["agentAccessPolicy"],
  agentId: string
): { allowed: boolean; reason?: string } {
  if (!policy.allowAutonomousAgents) {
    return { allowed: false, reason: "Autonomous agent access is disabled" };
  }
  
  if (policy.blockedAgents.includes(agentId as WalletAddress)) {
    return { allowed: false, reason: "Agent is blocked from accessing this resource" };
  }
  
  if (policy.requireHumanApproval) {
    // TODO: Implement approval queue
    return { allowed: false, reason: "Human approval required for agent access" };
  }
  
  return { allowed: true };
}

// =============================================================================
// DECRYPTION KEY REQUEST
// =============================================================================

async function requestDecryptionKey(
  params: RequestDecryptionKeyParams
): Promise<DecryptionKeyResponse> {
  try {
    // 1. Verify ownership proof
    const recoveredAddress = ethers.verifyMessage(
      params.signedMessage,
      params.ownershipProof
    );
    
    if (recoveredAddress.toLowerCase() !== params.requesterWallet.toLowerCase()) {
      return {
        success: false,
        error: "Invalid ownership proof",
        errorCode: "INVALID_PROOF",
      };
    }
    
    // 2. Verify on-chain ownership
    const provider = getProvider("polygon");
    
    const nftContract = new ethers.Contract(
      params.contractAddress,
      ["function ownerOf(uint256 tokenId) view returns (address)"],
      provider
    );
    
    let isOwner = false;
    try {
      const owner = await nftContract.ownerOf(params.tokenId);
      isOwner = owner.toLowerCase() === params.requesterWallet.toLowerCase();
    } catch {
      isOwner = false;
    }
    
    if (!isOwner) {
      return {
        success: false,
        error: "Not the NFT owner",
        errorCode: "UNAUTHORIZED",
      };
    }
    
    // 3. Request decryption key from key escrow
    const url = `${JOYMARKETPLACE_API.baseUrl}/decryption-key`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(contractConfig.apiKey && {
          Authorization: `Bearer ${contractConfig.apiKey}`,
        }),
      },
      body: JSON.stringify({
        tokenId: params.tokenId,
        contractAddress: params.contractAddress,
        requesterWallet: params.requesterWallet,
        ownershipProof: params.ownershipProof,
        accessPurpose: params.accessPurpose,
        agentId: params.agentId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.message || "Failed to retrieve decryption key",
        errorCode: error.code || "UNAUTHORIZED",
      };
    }
    
    const data = await response.json();
    
    // Log audit entry
    await logAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      contractAddress: params.contractAddress,
      tokenId: params.tokenId,
      action: "decrypt",
      actor: params.requesterWallet,
      details: {
        purpose: params.accessPurpose,
        agentId: params.agentId,
      },
      sessionId: data.sessionId,
    });
    
    return {
      success: true,
      encryptedKey: data.encryptedKey,
      validUntil: data.validUntil,
      sessionId: data.sessionId,
    };
    
  } catch (error) {
    logger.error("Failed to request decryption key:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// DEPLOY CONTRACT
// =============================================================================

async function deployInferenceContract(
  request: DeployContractRequest
): Promise<DeployContractResult> {
  try {
    const url = `${JOYMARKETPLACE_API.baseUrl}/contracts/deploy`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(contractConfig.apiKey && {
          Authorization: `Bearer ${contractConfig.apiKey}`,
        }),
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.message || `Deployment failed: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    // Invalidate cache
    contractCache.lastFetched = 0;
    
    return {
      success: true,
      contract: data.contract,
      transactionHash: data.transactionHash,
      gasUsed: data.gasUsed,
    };
    
  } catch (error) {
    logger.error("Failed to deploy contract:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// MINT INFERENCE ACCESS NFT
// =============================================================================

async function mintInferenceAccessNFT(
  request: MintInferenceNFTRequest
): Promise<MintInferenceNFTResult> {
  try {
    // Calculate data hash
    const dataHash = crypto
      .createHash("sha256")
      .update(request.assetCid)
      .digest("hex");
    
    // Build complete license
    const licenseId = crypto
      .createHash("sha256")
      .update(JSON.stringify(request.license))
      .digest("hex");
    
    const url = `${JOYMARKETPLACE_API.baseUrl}/inference-nfts/mint`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(contractConfig.apiKey && {
          Authorization: `Bearer ${contractConfig.apiKey}`,
        }),
      },
      body: JSON.stringify({
        ...request,
        dataHash,
        licenseId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.message || `Minting failed: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    // Log audit entry
    await logAuditEntry({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      contractAddress: request.contractAddress,
      tokenId: data.tokenId,
      action: "mint",
      actor: request.recipient,
      details: {
        assetCid: request.assetCid,
        assetName: request.assetName,
        licenseType: request.licenseType,
        price: request.price,
      },
      transactionHash: data.transactionHash,
    });
    
    return {
      success: true,
      nft: data.nft,
      transactionHash: data.transactionHash,
      tokenId: data.tokenId,
      metadataUri: data.metadataUri,
    };
    
  } catch (error) {
    logger.error("Failed to mint inference access NFT:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

async function logAuditEntry(entry: ContractAuditEntry): Promise<void> {
  try {
    const logFile = path.join(
      getAuditLogDir(),
      `audit_${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    
    await fs.appendFile(logFile, JSON.stringify(entry) + "\n");
  } catch (error) {
    logger.error("Failed to log audit entry:", error);
  }
}

async function getAuditLogs(
  contractAddress?: string,
  startDate?: string,
  endDate?: string
): Promise<ContractAuditEntry[]> {
  const entries: ContractAuditEntry[] = [];
  
  try {
    const auditDir = getAuditLogDir();
    const files = await fs.readdir(auditDir);
    
    for (const file of files) {
      if (!file.startsWith("audit_") || !file.endsWith(".jsonl")) continue;
      
      const fileDate = file.slice(6, 16); // Extract date from filename
      if (startDate && fileDate < startDate) continue;
      if (endDate && fileDate > endDate) continue;
      
      const content = await fs.readFile(path.join(auditDir, file), "utf-8");
      const lines = content.trim().split("\n");
      
      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as ContractAuditEntry;
          if (contractAddress && entry.contractAddress !== contractAddress) continue;
          entries.push(entry);
        } catch {
          // Skip malformed entries
        }
      }
    }
  } catch (error) {
    logger.error("Failed to read audit logs:", error);
  }
  
  return entries.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// =============================================================================
// OWNED NFTS BY WALLET
// =============================================================================

async function getOwnedInferenceNFTs(
  walletAddress: WalletAddress
): Promise<InferenceAccessNFT[]> {
  return fetchInferenceAccessNFTs({
    owner: walletAddress,
    activeOnly: true,
  });
}

// =============================================================================
// CONTRACT BY ASSET CID
// =============================================================================

async function getContractForAsset(
  assetCid: Cid
): Promise<DeployedContract | null> {
  const contracts = await fetchDeployedContracts({
    type: ["inference_access"],
    status: ["deployed", "verified"],
  });
  
  return contracts.find(c => c.assetCid === assetCid) || null;
}

// =============================================================================
// RECORD INFERENCE USAGE
// =============================================================================

async function recordInferenceUsage(
  tokenId: TokenId,
  contractAddress: ContractAddress,
  usage: {
    inputTokens: number;
    outputTokens: number;
    computeMs: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${JOYMARKETPLACE_API.baseUrl}/inference-nfts/usage`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(contractConfig.apiKey && {
          Authorization: `Bearer ${contractConfig.apiKey}`,
        }),
      },
      body: JSON.stringify({
        tokenId,
        contractAddress,
        ...usage,
        timestamp: new Date().toISOString(),
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.message || "Failed to record usage",
      };
    }
    
    return { success: true };
    
  } catch (error) {
    logger.error("Failed to record inference usage:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

async function configureContractClient(
  apiKey: string,
  publisherId?: string
): Promise<{ success: boolean }> {
  contractConfig.apiKey = apiKey;
  contractConfig.publisherId = publisherId;
  
  // Clear cache on reconfiguration
  contractCache.contracts = [];
  contractCache.nfts = [];
  contractCache.lastFetched = 0;
  
  logger.info("Contract client configured");
  return { success: true };
}

// =============================================================================
// REGISTER IPC HANDLERS
// =============================================================================

export function registerDeployedContractHandlers(): void {
  // Ensure directories exist on startup
  ensureDirectories().catch(err => 
    logger.error("Failed to create contract data directories:", err)
  );
  
  // Configuration
  ipcMain.handle("contracts:configure", async (_, apiKey: string, publisherId?: string) => {
    return configureContractClient(apiKey, publisherId);
  });
  
  // Fetch deployed contracts
  ipcMain.handle("contracts:fetch-deployed", async (_, query?: ContractQuery) => {
    return fetchDeployedContracts(query);
  });
  
  // Fetch inference access NFTs
  ipcMain.handle("contracts:fetch-inference-nfts", async (_, query?: NFTAccessQuery) => {
    return fetchInferenceAccessNFTs(query);
  });
  
  // Get owned NFTs for wallet
  ipcMain.handle("contracts:get-owned-nfts", async (_, walletAddress: WalletAddress) => {
    return getOwnedInferenceNFTs(walletAddress);
  });
  
  // Get contract for asset
  ipcMain.handle("contracts:get-for-asset", async (_, assetCid: Cid) => {
    return getContractForAsset(assetCid);
  });
  
  // Verify inference access
  ipcMain.handle("contracts:verify-access", async (_, request: InferenceAccessRequest) => {
    return verifyInferenceAccess(request);
  });
  
  // Request decryption key
  ipcMain.handle("contracts:request-decryption-key", async (_, params: RequestDecryptionKeyParams) => {
    return requestDecryptionKey(params);
  });
  
  // Deploy contract
  ipcMain.handle("contracts:deploy", async (_, request: DeployContractRequest) => {
    return deployInferenceContract(request);
  });
  
  // Mint inference access NFT
  ipcMain.handle("contracts:mint-access-nft", async (_, request: MintInferenceNFTRequest) => {
    return mintInferenceAccessNFT(request);
  });
  
  // Record inference usage
  ipcMain.handle("contracts:record-usage", async (_, 
    tokenId: TokenId,
    contractAddress: ContractAddress,
    usage: { inputTokens: number; outputTokens: number; computeMs: number }
  ) => {
    return recordInferenceUsage(tokenId, contractAddress, usage);
  });
  
  // Get audit logs
  ipcMain.handle("contracts:get-audit-logs", async (_, 
    contractAddress?: string,
    startDate?: string,
    endDate?: string
  ) => {
    return getAuditLogs(contractAddress, startDate, endDate);
  });
  
  logger.info("Deployed contract handlers registered");
}
