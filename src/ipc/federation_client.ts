/**
 * Federation & P2P Network Client
 * Renderer-side client for decentralized marketplace
 */

import type { IpcRenderer } from "electron";
import type {
  DecentralizedIdentity,
  Peer,
  BootstrapPeerEntry,
  P2PEscrow,
  P2PListing,
  P2PPricing,
  P2PLicense,
  P2PTransaction,
  P2PEscrow,
  P2PMessage,
  P2PConversation,
  DHTRecord,
  ModelChunkAnnouncement,
  ModelChunkListing,
  ModelChunkPurchase,
  FederatedInferenceRequest,
  FederatedInferenceRoute,
  FederatedInferenceExecutionRequest,
  FederatedInferenceExecutionResult,
  FederationStats,
  TransactionStatus,
} from "@/types/federation_types";
import type { NFTListing } from "@/types/nft_types";

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

export const FederationClient = {
  // ============= Identity =============

  /**
   * Create a new decentralized identity
   */
  async createIdentity(
    displayName: string,
    password: string
  ): Promise<{ identity: DecentralizedIdentity; privateKey: string }> {
    return getIpcRenderer().invoke("federation:create-identity", displayName, password);
  },

  /**
   * Get local identity
   */
  async getIdentity(): Promise<DecentralizedIdentity | null> {
    return getIpcRenderer().invoke("federation:get-identity");
  },

  // ============= Peers =============

  /**
   * Get all known peers
   */
  async getPeers(): Promise<Peer[]> {
    return getIpcRenderer().invoke("federation:get-peers");
  },

  /**
   * Get currently connected peers
   */
  async getConnectedPeers(): Promise<Peer[]> {
    return getIpcRenderer().invoke("federation:get-connected-peers");
  },

  /**
   * Connect to a peer
   */
  async connectPeer(peerId: string): Promise<Peer | null> {
    return getIpcRenderer().invoke("federation:connect-peer", peerId);
  },

  /**
   * Disconnect from a peer
   */
  async disconnectPeer(peerId: string): Promise<void> {
    return getIpcRenderer().invoke("federation:disconnect-peer", peerId);
  },

  /**
   * Add a new peer
   */
  async addPeer(peer: Peer): Promise<void> {
    return getIpcRenderer().invoke("federation:add-peer", peer);
  },

  // ============= Bootstrap Peers =============

  async listBootstrapPeers(): Promise<BootstrapPeerEntry[]> {
    return getIpcRenderer().invoke("federation:bootstrap:list");
  },

  async addBootstrapPeer(entry: Omit<BootstrapPeerEntry, "added_at">): Promise<BootstrapPeerEntry> {
    return getIpcRenderer().invoke("federation:bootstrap:add", entry);
  },

  async removeBootstrapPeer(peerId: string): Promise<void> {
    return getIpcRenderer().invoke("federation:bootstrap:remove", peerId);
  },

  async importBootstrapPeer(peerId: string): Promise<Peer> {
    return getIpcRenderer().invoke("federation:bootstrap:import", peerId);
  },

  // ============= DHT =============

  /**
   * Put a record in the DHT
   */
  async dhtPut(
    key: string,
    value: any,
    publisherDid: string,
    privateKey: string,
    ttlSeconds?: number
  ): Promise<DHTRecord> {
    return getIpcRenderer().invoke("federation:dht-put", key, value, publisherDid, privateKey, ttlSeconds);
  },

  /**
   * Get a record from the DHT
   */
  async dhtGet(key: string): Promise<DHTRecord | null> {
    return getIpcRenderer().invoke("federation:dht-get", key);
  },

  // ============= Model Chunk DHT =============

  async serveModelChunk(params: { filePath: string }): Promise<{ cid: string; bytes: number }> {
    return getIpcRenderer().invoke("federation:model-chunk-serve", params);
  },

  async requestModelChunk(params: { cid: string; outputPath: string }): Promise<{ bytes: number }> {
    return getIpcRenderer().invoke("federation:model-chunk-request", params);
  },

  async announceModelChunk(params: {
    modelId: string;
    modelHash?: string;
    chunkCid: string;
    chunkIndex: number;
    totalChunks?: number;
    bytes?: number;
    privateKey: string;
  }): Promise<ModelChunkAnnouncement> {
    return getIpcRenderer().invoke("federation:model-chunk-announce", params);
  },

  async findModelChunks(modelId: string): Promise<ModelChunkAnnouncement[]> {
    return getIpcRenderer().invoke("federation:model-chunk-find", modelId);
  },

  // ============= Federated Inference Routing =============

  async routeInference(request: FederatedInferenceRequest): Promise<FederatedInferenceRoute> {
    return getIpcRenderer().invoke("federation:route-inference", request);
  },

  async executeInference(
    request: FederatedInferenceExecutionRequest
  ): Promise<FederatedInferenceExecutionResult> {
    return getIpcRenderer().invoke("federation:execute-inference", request);
  },

  async streamInference(
    request: FederatedInferenceExecutionRequest,
    callbacks: {
      onChunk: (content: string) => void;
      onDone?: (data: {
        status: "local" | "dispatched";
        route: FederatedInferenceRoute;
        recordId?: string;
        cid?: string;
        receipt?: { cid: string; created_at: string; json_path?: string; cbor_path?: string };
      }) => void;
      onError?: (error: string) => void;
    }
  ): Promise<{ streamId: string }> {
    const stream = await getIpcRenderer().invoke("federation:execute-inference-stream", request);
    const streamId = stream.streamId as string;

    const onChunk = (payload: any) => {
      if (payload?.streamId === streamId && payload?.content) {
        callbacks.onChunk(payload.content);
      }
    };
    const onDone = (payload: any) => {
      if (payload?.streamId === streamId) {
        callbacks.onDone?.(payload);
        cleanup();
      }
    };
    const onError = (payload: any) => {
      if (payload?.streamId === streamId) {
        callbacks.onError?.(payload.error || "Stream error");
        cleanup();
      }
    };

    const cleanup = () => {
      getIpcRenderer().removeListener("federation:inference:chunk", onChunk);
      getIpcRenderer().removeListener("federation:inference:done", onDone);
      getIpcRenderer().removeListener("federation:inference:error", onError);
    };

    getIpcRenderer().on("federation:inference:chunk", onChunk);
    getIpcRenderer().on("federation:inference:done", onDone);
    getIpcRenderer().on("federation:inference:error", onError);

    return { streamId };
  },

  // ============= Model Chunk Marketplace =============

  async createModelChunkListing(params: {
    modelId: string;
    modelHash?: string;
    title: string;
    description?: string;
    tags?: string[];
    chunkCids: string[];
    chunkCount: number;
    bytesTotal?: number;
    pricing: P2PPricing;
    license: ModelChunkListing["license"];
    privateKey: string;
  }): Promise<ModelChunkListing> {
    return getIpcRenderer().invoke("federation:model-chunk-listing:create", params);
  },

  async listModelChunkListings(): Promise<ModelChunkListing[]> {
    return getIpcRenderer().invoke("federation:model-chunk-listing:list");
  },

  async createModelChunkPurchase(params: {
    listingId: string;
    buyerDid: string;
    paymentTxHash?: string;
    receiptCid?: string;
  }): Promise<ModelChunkPurchase> {
    return getIpcRenderer().invoke("federation:model-chunk-purchase:create", params);
  },

  async listModelChunkPurchases(): Promise<ModelChunkPurchase[]> {
    return getIpcRenderer().invoke("federation:model-chunk-purchase:list");
  },

  async createModelChunkEscrow(transactionId: string): Promise<P2PEscrow> {
    return getIpcRenderer().invoke("federation:model-chunk-escrow:create", transactionId);
  },

  // ============= P2P Listings =============

  /**
   * Create a P2P listing from an NFT listing
   */
  async createListing(params: {
    nftListing: NFTListing;
    pricing: P2PPricing;
    license: P2PLicense;
    privateKey: string;
  }): Promise<P2PListing> {
    return getIpcRenderer().invoke("federation:create-listing", params);
  },

  /**
   * Get all P2P listings
   */
  async getListings(): Promise<P2PListing[]> {
    return getIpcRenderer().invoke("federation:get-listings");
  },

  /**
   * Search P2P listings
   */
  async searchListings(query: {
    keyword?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    currency?: string;
  }): Promise<P2PListing[]> {
    return getIpcRenderer().invoke("federation:search-listings", query);
  },

  // ============= Transactions =============

  /**
   * Initiate a P2P transaction
   */
  async initiateTransaction(
    listingId: string,
    privateKey: string
  ): Promise<P2PTransaction> {
    return getIpcRenderer().invoke("federation:initiate-transaction", listingId, privateKey);
  },

  /**
   * Update transaction status
   */
  async updateTransaction(
    transactionId: string,
    status: TransactionStatus,
    privateKey: string,
    message?: string
  ): Promise<P2PTransaction> {
    return getIpcRenderer().invoke("federation:update-transaction", transactionId, status, privateKey, message);
  },

  /**
   * Get all transactions
   */
  async getTransactions(): Promise<P2PTransaction[]> {
    return getIpcRenderer().invoke("federation:get-transactions");
  },

  // ============= Escrow =============

  /**
   * Create escrow for a transaction
   */
  async createEscrow(
    transactionId: string,
    mediatorDid?: string
  ): Promise<P2PEscrow> {
    return getIpcRenderer().invoke("federation:create-escrow", transactionId, mediatorDid);
  },

  // ============= Messaging =============

  /**
   * Send an encrypted P2P message
   */
  async sendMessage(params: {
    recipientDid: string;
    content: string;
    privateKey: string;
    metadata?: {
      type?: P2PMessage["type"];
      listing_id?: string;
      transaction_id?: string;
    };
  }): Promise<P2PMessage> {
    return getIpcRenderer().invoke("federation:send-message", params);
  },

  /**
   * Get all conversations
   */
  async getConversations(): Promise<P2PConversation[]> {
    return getIpcRenderer().invoke("federation:get-conversations");
  },

  // ============= Stats =============

  /**
   * Get federation network statistics
   */
  async getStats(): Promise<FederationStats> {
    return getIpcRenderer().invoke("federation:get-stats");
  },

  // ============= Helpers =============

  /**
   * Quick buy: initiate transaction, create escrow, and start delivery
   */
  async quickBuy(
    listingId: string,
    privateKey: string,
    useEscrow: boolean = true
  ): Promise<{
    transaction: P2PTransaction;
    escrow?: P2PEscrow;
  }> {
    const transaction = await this.initiateTransaction(listingId, privateKey);
    
    let escrow: P2PEscrow | undefined;
    if (useEscrow) {
      escrow = await this.createEscrow(transaction.id);
    }
    
    return { transaction, escrow };
  },

  /**
   * Start a negotiation with a seller
   */
  async startNegotiation(
    listingId: string,
    offerPrice: number,
    privateKey: string
  ): Promise<P2PMessage> {
    const listings = await this.getListings();
    const listing = listings.find(l => l.id === listingId);
    if (!listing) throw new Error("Listing not found");
    
    return this.sendMessage({
      recipientDid: listing.seller.did,
      content: JSON.stringify({
        type: "offer",
        listing_id: listingId,
        offer_price: offerPrice,
      }),
      privateKey,
      metadata: {
        type: "offer",
        listing_id: listingId,
      },
    });
  },
};
