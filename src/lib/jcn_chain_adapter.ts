/**
 * JCN Chain Adapter Service
 * Handles blockchain interactions for minting, listing, and transaction tracking.
 * 
 * Features:
 * - Mint assets to collection contracts
 * - Register listings in marketplace contract
 * - Track transaction confirmations with reorg handling
 * - Idempotent transaction submission
 */

import { ethers } from "ethers";
import log from "electron-log";
import { db } from "@/db";
import { jcnChainTransactions } from "@/db/schema";
import { eq, and, lt, or } from "drizzle-orm";
import {
  CONTRACT_ADDRESSES,
  CONTRACT_ABIS,
  POLYGON_MAINNET,
} from "@/config/joymarketplace";

import type {
  ChainNetwork,
  ChainConfig,
  MintRequest,
  MintResult,
  ChainTransaction,
  WalletAddress,
  TxHash,
  RequestId,
} from "@/types/jcn_types";

const logger = log.scope("jcn_chain_adapter");

// =============================================================================
// CHAIN CONFIGURATIONS
// =============================================================================

const CHAIN_CONFIGS: Record<ChainNetwork, ChainConfig> = {
  polygon: {
    network: "polygon",
    chainId: 137,
    rpcUrl: POLYGON_MAINNET.rpcUrl,
    marketplaceContract: CONTRACT_ADDRESSES.ENHANCED_MODEL_MARKETPLACE as WalletAddress,
    confirmationBlocks: 12,
  },
  polygon_mumbai: {
    network: "polygon_mumbai",
    chainId: 80001,
    rpcUrl: "https://rpc-mumbai.maticvigil.com",
    marketplaceContract: "0x0000000000000000000000000000000000000000" as WalletAddress,
    confirmationBlocks: 6,
  },
  ethereum: {
    network: "ethereum",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    marketplaceContract: "0x0000000000000000000000000000000000000000" as WalletAddress,
    confirmationBlocks: 12,
  },
  base: {
    network: "base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    marketplaceContract: "0x0000000000000000000000000000000000000000" as WalletAddress,
    confirmationBlocks: 6,
  },
};

// =============================================================================
// CONTRACT ABIs (Simplified for JCN operations)
// =============================================================================

const COLLECTION_ABI = [
  "function mint(address to, string memory tokenURI) external returns (uint256)",
  "function mintWithRoyalty(address to, string memory tokenURI, address royaltyReceiver, uint96 royaltyBps) external returns (uint256)",
  "function tokenURI(uint256 tokenId) external view returns (string memory)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const MARKETPLACE_REGISTRY_ABI = [
  "function getStoreCollection(uint256 storeId) external view returns (address)",
  "function registerAsset(uint256 storeId, address collection, uint256 tokenId, bytes32 bundleCid, bytes32 merkleRoot) external",
  "function listAsset(uint256 storeId, uint256 tokenId, uint256 price, address currency) external",
  "function delistAsset(uint256 storeId, uint256 tokenId) external",
  "event AssetRegistered(uint256 indexed storeId, address indexed collection, uint256 indexed tokenId, bytes32 bundleCid)",
  "event AssetListed(uint256 indexed storeId, uint256 indexed tokenId, uint256 price, address currency)",
];

// =============================================================================
// SUBMITTED TX TRACKING
// =============================================================================

interface SubmittedTx {
  requestId: RequestId;
  txHash: TxHash;
  network: ChainNetwork;
  submittedAt: number;
}

// In-memory cache of recently submitted transactions (for quick idempotency check)
const recentTxCache = new Map<RequestId, SubmittedTx>();

// =============================================================================
// JCN CHAIN ADAPTER
// =============================================================================

export class JcnChainAdapter {
  private providers: Map<ChainNetwork, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<ChainNetwork, ethers.Wallet> = new Map();
  private defaultNetwork: ChainNetwork = "polygon";
  
  constructor() {
    // Initialize providers
    for (const [network, config] of Object.entries(CHAIN_CONFIGS)) {
      this.providers.set(network as ChainNetwork, new ethers.JsonRpcProvider(config.rpcUrl));
    }
  }
  
  /**
   * Configure wallet for a network
   * WARNING: Never log the private key!
   */
  configureWallet(network: ChainNetwork, privateKey: string): void {
    const provider = this.providers.get(network);
    if (!provider) {
      throw new Error(`Unknown network: ${network}`);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    this.wallets.set(network, wallet);
    logger.info(`Configured wallet for ${network}: ${wallet.address}`);
  }
  
  /**
   * Set default network
   */
  setDefaultNetwork(network: ChainNetwork): void {
    this.defaultNetwork = network;
  }
  
  /**
   * Get provider for network
   */
  getProvider(network?: ChainNetwork): ethers.JsonRpcProvider {
    const net = network || this.defaultNetwork;
    const provider = this.providers.get(net);
    if (!provider) {
      throw new Error(`Provider not available for network: ${net}`);
    }
    return provider;
  }
  
  /**
   * Get wallet for network
   */
  getWallet(network?: ChainNetwork): ethers.Wallet {
    const net = network || this.defaultNetwork;
    const wallet = this.wallets.get(net);
    if (!wallet) {
      throw new Error(`Wallet not configured for network: ${net}. Call configureWallet first.`);
    }
    return wallet;
  }
  
  /**
   * Get collection contract for a store
   */
  async getStoreCollection(
    storeId: string,
    network?: ChainNetwork
  ): Promise<WalletAddress | null> {
    const net = network || this.defaultNetwork;
    const config = CHAIN_CONFIGS[net];
    const provider = this.getProvider(net);
    
    try {
      const marketplace = new ethers.Contract(
        config.marketplaceContract,
        MARKETPLACE_REGISTRY_ABI,
        provider
      );
      
      const collectionAddress = await marketplace.getStoreCollection(storeId);
      
      if (collectionAddress === ethers.ZeroAddress) {
        return null;
      }
      
      return collectionAddress as WalletAddress;
    } catch (error) {
      logger.error("Failed to get store collection:", error);
      return null;
    }
  }
  
  /**
   * Mint an asset token (idempotent via requestId)
   */
  async mintAsset(request: MintRequest): Promise<MintResult> {
    const network = this.defaultNetwork;
    
    // Check for existing transaction with this requestId
    const existingTx = await this.getExistingTransaction(request.requestId);
    if (existingTx) {
      logger.info(`Found existing transaction for requestId ${request.requestId}`, {
        txHash: existingTx.txHash,
        status: existingTx.status,
      });
      
      if (existingTx.status === "confirmed") {
        return {
          success: true,
          txHash: existingTx.txHash,
          blockNumber: existingTx.blockNumber || undefined,
          confirmations: existingTx.confirmations,
        };
      } else if (existingTx.status === "pending") {
        return {
          success: true,
          txHash: existingTx.txHash,
          pending: true,
          confirmations: existingTx.confirmations,
        };
      } else if (existingTx.status === "failed" || existingTx.status === "dropped") {
        // Allow retry for failed/dropped transactions
        logger.info(`Retrying failed transaction for requestId ${request.requestId}`);
      }
    }
    
    try {
      const wallet = this.getWallet(network);
      
      // Get or validate collection contract
      let collectionAddress = request.collectionContract;
      if (!collectionAddress) {
        collectionAddress = (await this.getStoreCollection(request.storeId, network)) ?? undefined;
        if (!collectionAddress) {
          return {
            success: false,
            error: `No collection contract found for store ${request.storeId}`,
          };
        }
      }
      
      const collection = new ethers.Contract(collectionAddress, COLLECTION_ABI, wallet);
      
      // Prepare mint transaction
      logger.info("Submitting mint transaction", {
        requestId: request.requestId,
        collection: collectionAddress,
        tokenUri: request.tokenUri,
      });
      
      let tx: ethers.ContractTransactionResponse;
      
      if (request.royaltyBps > 0) {
        // Mint with royalty
        tx = await collection.mintWithRoyalty(
          wallet.address,
          request.tokenUri,
          wallet.address, // Royalty receiver
          request.royaltyBps
        );
      } else {
        // Simple mint
        tx = await collection.mint(wallet.address, request.tokenUri);
      }
      
      // Record transaction
      await this.recordTransaction({
        txHash: tx.hash as TxHash,
        network,
        status: "pending",
        txType: "mint",
        relatedRecordId: request.requestId,
        relatedRecordType: "publish",
        requiredConfirmations: CHAIN_CONFIGS[network].confirmationBlocks,
      });
      
      // Cache for quick idempotency check
      recentTxCache.set(request.requestId, {
        requestId: request.requestId,
        txHash: tx.hash as TxHash,
        network,
        submittedAt: Date.now(),
      });
      
      logger.info("Mint transaction submitted", {
        requestId: request.requestId,
        txHash: tx.hash,
      });
      
      return {
        success: true,
        txHash: tx.hash as TxHash,
        collectionContract: collectionAddress,
        pending: true,
        confirmations: 0,
      };
    } catch (error) {
      logger.error("Mint failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    txHash: TxHash,
    network?: ChainNetwork,
    requiredConfirmations?: number
  ): Promise<MintResult> {
    const net = network || this.defaultNetwork;
    const config = CHAIN_CONFIGS[net];
    const provider = this.getProvider(net);
    const required = requiredConfirmations || config.confirmationBlocks;
    
    try {
      logger.info("Waiting for transaction confirmation", { txHash, required });
      
      // Wait for transaction receipt
      const receipt = await provider.waitForTransaction(txHash, required);
      
      if (!receipt) {
        return {
          success: false,
          txHash,
          error: "Transaction not found",
        };
      }
      
      if (receipt.status === 0) {
        // Transaction reverted
        await this.updateTransactionStatus(txHash, "failed");
        return {
          success: false,
          txHash,
          error: "Transaction reverted",
        };
      }
      
      // Get token ID from Transfer event
      let tokenId: string | undefined;
      for (const log of receipt.logs) {
        try {
          const iface = new ethers.Interface(COLLECTION_ABI);
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === "Transfer") {
            tokenId = parsed.args.tokenId.toString();
            break;
          }
        } catch {
          // Not a Transfer event
        }
      }
      
      // Update transaction record
      await this.updateTransactionStatus(txHash, "confirmed", receipt.blockNumber);
      
      return {
        success: true,
        txHash,
        tokenId,
        blockNumber: receipt.blockNumber,
        confirmations: required,
      };
    } catch (error) {
      logger.error("Confirmation wait failed:", error);
      return {
        success: false,
        txHash,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Register asset in marketplace
   */
  async registerAsset(
    storeId: string,
    collectionAddress: WalletAddress,
    tokenId: string,
    bundleCid: string,
    merkleRoot: string,
    network?: ChainNetwork
  ): Promise<{ success: boolean; txHash?: TxHash; error?: string }> {
    const net = network || this.defaultNetwork;
    const config = CHAIN_CONFIGS[net];
    
    try {
      const wallet = this.getWallet(net);
      const marketplace = new ethers.Contract(
        config.marketplaceContract,
        MARKETPLACE_REGISTRY_ABI,
        wallet
      );
      
      // Convert CID and merkleRoot to bytes32
      const cidBytes = ethers.id(bundleCid);
      const rootBytes = ethers.id(merkleRoot);
      
      const tx = await marketplace.registerAsset(
        storeId,
        collectionAddress,
        tokenId,
        cidBytes,
        rootBytes
      );
      
      logger.info("Asset registration submitted", { txHash: tx.hash });
      
      return {
        success: true,
        txHash: tx.hash as TxHash,
      };
    } catch (error) {
      logger.error("Asset registration failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * List asset for sale
   */
  async listAsset(
    storeId: string,
    tokenId: string,
    price: bigint,
    currency: WalletAddress,
    network?: ChainNetwork
  ): Promise<{ success: boolean; txHash?: TxHash; error?: string }> {
    const net = network || this.defaultNetwork;
    const config = CHAIN_CONFIGS[net];
    
    try {
      const wallet = this.getWallet(net);
      const marketplace = new ethers.Contract(
        config.marketplaceContract,
        MARKETPLACE_REGISTRY_ABI,
        wallet
      );
      
      const tx = await marketplace.listAsset(storeId, tokenId, price, currency);
      
      logger.info("Asset listing submitted", { txHash: tx.hash });
      
      return {
        success: true,
        txHash: tx.hash as TxHash,
      };
    } catch (error) {
      logger.error("Asset listing failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Record a transaction in the database
   */
  private async recordTransaction(params: {
    txHash: TxHash;
    network: ChainNetwork;
    status: "pending" | "confirmed" | "failed" | "dropped";
    txType: "mint" | "transfer" | "list" | "delist" | "payout" | "other";
    relatedRecordId?: string;
    relatedRecordType?: "publish" | "job" | "payout";
    requiredConfirmations: number;
  }): Promise<void> {
    await db.insert(jcnChainTransactions).values({
      id: crypto.randomUUID(),
      txHash: params.txHash,
      network: params.network,
      status: params.status,
      txType: params.txType,
      relatedRecordId: params.relatedRecordId,
      relatedRecordType: params.relatedRecordType,
      requiredConfirmations: params.requiredConfirmations,
      confirmations: 0,
      submittedAt: new Date(),
    }).onConflictDoNothing();
  }
  
  /**
   * Update transaction status
   */
  private async updateTransactionStatus(
    txHash: TxHash,
    status: "pending" | "confirmed" | "failed" | "dropped" | "reorged",
    blockNumber?: number
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      status,
      lastCheckedAt: new Date(),
    };
    
    if (blockNumber !== undefined) {
      updateData.blockNumber = blockNumber;
      updateData.confirmedAt = new Date();
    }
    
    await db.update(jcnChainTransactions)
      .set(updateData)
      .where(eq(jcnChainTransactions.txHash, txHash));
  }
  
  /**
   * Get existing transaction by requestId
   */
  private async getExistingTransaction(requestId: RequestId): Promise<ChainTransaction | null> {
    // Check in-memory cache first
    const cached = recentTxCache.get(requestId);
    if (cached) {
      // Verify it's still in the database
      const [record] = await db.select()
        .from(jcnChainTransactions)
        .where(eq(jcnChainTransactions.txHash, cached.txHash))
        .limit(1);
      
      if (record) {
        return {
          txHash: record.txHash as TxHash,
          network: record.network as ChainNetwork,
          status: record.status as "pending" | "confirmed" | "failed" | "dropped",
          blockNumber: record.blockNumber || undefined,
          confirmations: record.confirmations,
          requiredConfirmations: record.requiredConfirmations,
          createdAt: record.createdAt?.getTime() || Date.now(),
          lastCheckedAt: record.lastCheckedAt?.getTime() || Date.now(),
        };
      }
    }
    
    // Check database
    const [record] = await db.select()
      .from(jcnChainTransactions)
      .where(eq(jcnChainTransactions.relatedRecordId, requestId))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return {
      txHash: record.txHash as TxHash,
      network: record.network as ChainNetwork,
      status: record.status as "pending" | "confirmed" | "failed" | "dropped",
      blockNumber: record.blockNumber || undefined,
      confirmations: record.confirmations,
      requiredConfirmations: record.requiredConfirmations,
      createdAt: record.createdAt?.getTime() || Date.now(),
      lastCheckedAt: record.lastCheckedAt?.getTime() || Date.now(),
    };
  }
  
  /**
   * Poll and update pending transactions
   */
  async pollPendingTransactions(): Promise<void> {
    const pendingTxs = await db.select()
      .from(jcnChainTransactions)
      .where(eq(jcnChainTransactions.status, "pending"));
    
    for (const tx of pendingTxs) {
      try {
        const provider = this.getProvider(tx.network as ChainNetwork);
        const receipt = await provider.getTransactionReceipt(tx.txHash);
        
        if (receipt) {
          const currentBlock = await provider.getBlockNumber();
          const confirmations = currentBlock - receipt.blockNumber;
          
          await db.update(jcnChainTransactions)
            .set({
              confirmations,
              blockNumber: receipt.blockNumber,
              lastCheckedAt: new Date(),
              ...(confirmations >= tx.requiredConfirmations && receipt.status === 1
                ? { status: "confirmed", confirmedAt: new Date() }
                : receipt.status === 0
                  ? { status: "failed" }
                  : {}),
            })
            .where(eq(jcnChainTransactions.id, tx.id));
        }
      } catch (error) {
        logger.error(`Failed to poll transaction ${tx.txHash}:`, error);
      }
    }
  }
  
  /**
   * Check for chain reorgs
   */
  async checkForReorgs(): Promise<string[]> {
    const reorgedTxs: string[] = [];
    
    const confirmedTxs = await db.select()
      .from(jcnChainTransactions)
      .where(
        and(
          eq(jcnChainTransactions.status, "confirmed"),
          lt(jcnChainTransactions.confirmations, 100) // Only check relatively recent txs
        )
      );
    
    for (const tx of confirmedTxs) {
      try {
        const provider = this.getProvider(tx.network as ChainNetwork);
        const receipt = await provider.getTransactionReceipt(tx.txHash);
        
        if (!receipt) {
          // Transaction no longer exists - possible reorg
          logger.warn(`Potential reorg detected for tx ${tx.txHash}`);
          await this.updateTransactionStatus(tx.txHash as TxHash, "reorged");
          reorgedTxs.push(tx.txHash);
        }
      } catch (error) {
        logger.error(`Failed to check for reorg on tx ${tx.txHash}:`, error);
      }
    }
    
    return reorgedTxs;
  }
  
  /**
   * Get current gas price
   */
  async getGasPrice(network?: ChainNetwork): Promise<bigint> {
    const provider = this.getProvider(network);
    const feeData = await provider.getFeeData();
    return feeData.gasPrice || 0n;
  }
  
  /**
   * Get wallet balance
   */
  async getBalance(network?: ChainNetwork): Promise<bigint> {
    const wallet = this.getWallet(network);
    return wallet.provider?.getBalance(wallet.address) || 0n;
  }
}

// Export singleton instance
export const jcnChainAdapter = new JcnChainAdapter();
