/**
 * Federation & P2P Network Handlers
 * Decentralized peer-to-peer marketplace for JoyCreate
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import type {
  DecentralizedIdentity,
  Peer,
  PeerCapability,
  PeerReputation,
  PeerAddress,
  P2PListing,
  P2PPricing,
  P2PLicense,
  P2PTransaction,
  P2PEscrow,
  P2PMessage,
  P2PConversation,
  AssetDiscoveryRecord,
  DHTRecord,
  FederationStats,
  LocalNodeConfig,
  TransactionStatus,
  P2PCurrency,
} from "@/types/federation_types";
import type { NFTListing } from "@/types/nft_types";

const logger = log.scope("federation_handlers");

// ============= Data Directories =============

function getFederationDir(): string {
  return path.join(app.getPath("userData"), "federation");
}

function getPeersDir(): string {
  return path.join(getFederationDir(), "peers");
}

function getListingsDir(): string {
  return path.join(getFederationDir(), "listings");
}

function getTransactionsDir(): string {
  return path.join(getFederationDir(), "transactions");
}

function getMessagesDir(): string {
  return path.join(getFederationDir(), "messages");
}

function getDHTDir(): string {
  return path.join(getFederationDir(), "dht");
}

async function initFederationDirs() {
  await fs.ensureDir(getFederationDir());
  await fs.ensureDir(getPeersDir());
  await fs.ensureDir(getListingsDir());
  await fs.ensureDir(getTransactionsDir());
  await fs.ensureDir(getMessagesDir());
  await fs.ensureDir(getDHTDir());
  await fs.ensureDir(path.join(getFederationDir(), "escrow"));
  await fs.ensureDir(path.join(getFederationDir(), "identity"));
}

// ============= Identity Management =============

/**
 * Generate Ed25519 keypair for identity
 */
function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Create a new decentralized identity
 */
async function createIdentity(
  displayName: string,
  password: string
): Promise<{ identity: DecentralizedIdentity; privateKey: string }> {
  const { publicKey, privateKey } = generateKeyPair();
  
  // Create DID from public key hash
  const keyHash = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 32);
  const did = `did:joy:${keyHash}`;
  
  const identity: DecentralizedIdentity = {
    did,
    public_key: publicKey,
    display_name: displayName,
    created_at: new Date().toISOString(),
    capabilities: ["asset-hosting"],
  };
  
  // Encrypt private key with password
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.scryptSync(password, "joycreate-salt", 32),
    crypto.randomBytes(16)
  );
  const encryptedKey = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]).toString("base64");
  
  // Save identity
  const identityPath = path.join(getFederationDir(), "identity", "local.json");
  await fs.writeJson(identityPath, {
    identity,
    private_key_encrypted: encryptedKey,
  }, { spaces: 2 });
  
  return { identity, privateKey };
}

/**
 * Get local identity
 */
async function getLocalIdentity(): Promise<DecentralizedIdentity | null> {
  const identityPath = path.join(getFederationDir(), "identity", "local.json");
  if (await fs.pathExists(identityPath)) {
    const data = await fs.readJson(identityPath);
    return data.identity;
  }
  return null;
}

/**
 * Sign data with private key
 */
function signData(data: string, privateKey: string): string {
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  return sign.sign(privateKey, "base64");
}

/**
 * Verify signature
 */
function verifySignature(data: string, signature: string, publicKey: string): boolean {
  try {
    const verify = crypto.createVerify("SHA256");
    verify.update(data);
    return verify.verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

// ============= Peer Management =============

/**
 * In-memory peer list (would be replaced by libp2p in production)
 */
const connectedPeers = new Map<string, Peer>();
const knownPeers = new Map<string, Peer>();

/**
 * Add or update a peer
 */
async function addPeer(peer: Peer): Promise<void> {
  knownPeers.set(peer.id, peer);
  
  // Persist to disk
  const peerPath = path.join(getPeersDir(), `${peer.id}.json`);
  await fs.writeJson(peerPath, peer, { spaces: 2 });
}

/**
 * Get all known peers
 */
async function getKnownPeers(): Promise<Peer[]> {
  const peersDir = getPeersDir();
  await fs.ensureDir(peersDir);
  
  const files = await fs.readdir(peersDir);
  const peers: Peer[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const peer = await fs.readJson(path.join(peersDir, file));
        peers.push(peer);
        knownPeers.set(peer.id, peer);
      } catch (error) {
        logger.warn(`Failed to load peer ${file}:`, error);
      }
    }
  }
  
  return peers;
}

/**
 * Get connected peers
 */
function getConnectedPeers(): Peer[] {
  return Array.from(connectedPeers.values());
}

/**
 * Simulate connecting to a peer
 */
async function connectToPeer(peerId: string): Promise<Peer | null> {
  const peer = knownPeers.get(peerId);
  if (!peer) return null;
  
  peer.connected = true;
  peer.status = "online";
  peer.last_seen = new Date().toISOString();
  connectedPeers.set(peerId, peer);
  
  return peer;
}

/**
 * Disconnect from peer
 */
async function disconnectPeer(peerId: string): Promise<void> {
  const peer = connectedPeers.get(peerId);
  if (peer) {
    peer.connected = false;
    peer.status = "offline";
    connectedPeers.delete(peerId);
  }
}

// ============= DHT Operations =============

/**
 * Put a record in the DHT
 */
async function dhtPut(
  key: string,
  value: any,
  publisherDid: string,
  privateKey: string,
  ttlSeconds: number = 86400
): Promise<DHTRecord> {
  const record: DHTRecord = {
    key,
    value,
    publisher: publisherDid,
    signature: signData(JSON.stringify({ key, value }), privateKey),
    timestamp: new Date().toISOString(),
    ttl_seconds: ttlSeconds,
    replicas: [],
  };
  
  // Store locally
  const recordPath = path.join(getDHTDir(), `${crypto.createHash("sha256").update(key).digest("hex")}.json`);
  await fs.writeJson(recordPath, record, { spaces: 2 });
  
  // In production, would broadcast to peers
  
  return record;
}

/**
 * Get a record from the DHT
 */
async function dhtGet(key: string): Promise<DHTRecord | null> {
  const recordPath = path.join(getDHTDir(), `${crypto.createHash("sha256").update(key).digest("hex")}.json`);
  if (await fs.pathExists(recordPath)) {
    return fs.readJson(recordPath);
  }
  
  // In production, would query peers
  
  return null;
}

// ============= P2P Listings =============

/**
 * Create a P2P listing from an NFT listing
 */
async function createP2PListing(
  nftListing: NFTListing,
  pricing: P2PPricing,
  license: P2PLicense,
  sellerIdentity: DecentralizedIdentity,
  privateKey: string
): Promise<P2PListing> {
  const listingId = `p2p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const listing: P2PListing = {
    id: listingId,
    asset_id: nftListing.asset_id,
    chunk_ids: [nftListing.chunk_id],
    
    seller: {
      did: sellerIdentity.did,
      peer_id: sellerIdentity.did.replace("did:joy:", ""),
      display_name: sellerIdentity.display_name,
      reputation_score: 100, // New user starts at 100
    },
    
    pricing,
    availability: "instant",
    delivery_method: "ipfs",
    license,
    
    status: "active",
    signature: "",
    
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  // Sign the listing
  listing.signature = signData(JSON.stringify({
    id: listing.id,
    asset_id: listing.asset_id,
    seller: listing.seller.did,
    pricing: listing.pricing,
  }), privateKey);
  
  // Save locally
  const listingPath = path.join(getListingsDir(), `${listingId}.json`);
  await fs.writeJson(listingPath, listing, { spaces: 2 });
  
  // Publish to DHT
  await dhtPut(`listing:${listingId}`, listing, sellerIdentity.did, privateKey);
  
  return listing;
}

/**
 * Get all P2P listings
 */
async function getP2PListings(): Promise<P2PListing[]> {
  const listingsDir = getListingsDir();
  await fs.ensureDir(listingsDir);
  
  const files = await fs.readdir(listingsDir);
  const listings: P2PListing[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const listing = await fs.readJson(path.join(listingsDir, file));
        listings.push(listing);
      } catch (error) {
        logger.warn(`Failed to load listing ${file}:`, error);
      }
    }
  }
  
  return listings.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Search P2P listings
 */
async function searchP2PListings(query: {
  keyword?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
}): Promise<P2PListing[]> {
  const listings = await getP2PListings();
  
  return listings.filter(listing => {
    if (query.keyword) {
      const keyword = query.keyword.toLowerCase();
      if (!listing.asset_id.toLowerCase().includes(keyword)) {
        return false;
      }
    }
    
    if (query.minPrice !== undefined && listing.pricing.base_price !== undefined) {
      if (listing.pricing.base_price < query.minPrice) return false;
    }
    
    if (query.maxPrice !== undefined && listing.pricing.base_price !== undefined) {
      if (listing.pricing.base_price > query.maxPrice) return false;
    }
    
    if (query.currency) {
      if (!listing.pricing.accepted_currencies.some(c => c.symbol === query.currency)) {
        return false;
      }
    }
    
    return true;
  });
}

// ============= Transactions =============

/**
 * Initiate a P2P transaction
 */
async function initiateTransaction(
  listingId: string,
  buyerIdentity: DecentralizedIdentity,
  privateKey: string
): Promise<P2PTransaction> {
  const listingPath = path.join(getListingsDir(), `${listingId}.json`);
  if (!await fs.pathExists(listingPath)) {
    throw new Error("Listing not found");
  }
  
  const listing: P2PListing = await fs.readJson(listingPath);
  
  const transactionId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const transaction: P2PTransaction = {
    id: transactionId,
    type: "purchase",
    
    buyer: {
      did: buyerIdentity.did,
      peer_id: buyerIdentity.did.replace("did:joy:", ""),
      display_name: buyerIdentity.display_name,
    },
    
    seller: {
      did: listing.seller.did,
      peer_id: listing.seller.peer_id,
      display_name: listing.seller.display_name,
    },
    
    listing_id: listingId,
    asset_id: listing.asset_id,
    chunk_ids: listing.chunk_ids,
    
    amount: listing.pricing.base_price || 0,
    currency: listing.pricing.preferred_currency,
    
    status: "initiated",
    status_history: [{
      status: "initiated",
      timestamp: new Date().toISOString(),
      actor: buyerIdentity.did,
      signature: signData(`initiated:${transactionId}`, privateKey),
    }],
    
    delivery_method: listing.delivery_method,
    
    initiated_at: new Date().toISOString(),
  };
  
  // Sign transaction
  transaction.buyer_signature = signData(JSON.stringify({
    id: transaction.id,
    listing_id: transaction.listing_id,
    amount: transaction.amount,
  }), privateKey);
  
  // Save transaction
  const txPath = path.join(getTransactionsDir(), `${transactionId}.json`);
  await fs.writeJson(txPath, transaction, { spaces: 2 });
  
  return transaction;
}

/**
 * Update transaction status
 */
async function updateTransactionStatus(
  transactionId: string,
  status: TransactionStatus,
  actorDid: string,
  privateKey: string,
  message?: string
): Promise<P2PTransaction> {
  const txPath = path.join(getTransactionsDir(), `${transactionId}.json`);
  if (!await fs.pathExists(txPath)) {
    throw new Error("Transaction not found");
  }
  
  const transaction: P2PTransaction = await fs.readJson(txPath);
  
  transaction.status = status;
  transaction.status_history.push({
    status,
    timestamp: new Date().toISOString(),
    actor: actorDid,
    message,
    signature: signData(`${status}:${transactionId}:${Date.now()}`, privateKey),
  });
  
  if (status === "completed") {
    transaction.completed_at = new Date().toISOString();
  }
  
  await fs.writeJson(txPath, transaction, { spaces: 2 });
  
  return transaction;
}

/**
 * Get all transactions
 */
async function getTransactions(): Promise<P2PTransaction[]> {
  const txDir = getTransactionsDir();
  await fs.ensureDir(txDir);
  
  const files = await fs.readdir(txDir);
  const transactions: P2PTransaction[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const tx = await fs.readJson(path.join(txDir, file));
        transactions.push(tx);
      } catch (error) {
        logger.warn(`Failed to load transaction ${file}:`, error);
      }
    }
  }
  
  return transactions.sort((a, b) => 
    new Date(b.initiated_at).getTime() - new Date(a.initiated_at).getTime()
  );
}

// ============= Escrow =============

/**
 * Create escrow for a transaction
 */
async function createEscrow(
  transaction: P2PTransaction,
  mediatorDid?: string
): Promise<P2PEscrow> {
  const escrowId = `escrow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  type SignerRole = "buyer" | "seller" | "mediator" | "platform";
  const signers: { role: SignerRole; did: string; public_key: string; has_signed: boolean }[] = [
    { role: "buyer", did: transaction.buyer.did, public_key: "", has_signed: false },
    { role: "seller", did: transaction.seller.did, public_key: "", has_signed: false },
  ];
  
  if (mediatorDid) {
    signers.push({ role: "mediator", did: mediatorDid, public_key: "", has_signed: false });
  }
  
  const escrow: P2PEscrow = {
    id: escrowId,
    transaction_id: transaction.id,
    
    amount: transaction.amount,
    currency: transaction.currency,
    fee_amount: transaction.amount * 0.01, // 1% fee
    
    required_signatures: mediatorDid ? 2 : 2,
    signers,
    
    status: "pending",
    
    release_conditions: [
      { type: "delivery-confirmed", satisfied: false },
    ],
    
    auto_release_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    
    created_at: new Date().toISOString(),
  };
  
  // Save escrow
  const escrowPath = path.join(getFederationDir(), "escrow", `${escrowId}.json`);
  await fs.writeJson(escrowPath, escrow, { spaces: 2 });
  
  return escrow;
}

// ============= Messaging =============

/**
 * Send encrypted P2P message
 */
async function sendMessage(
  recipientDid: string,
  content: string,
  senderIdentity: DecentralizedIdentity,
  privateKey: string,
  metadata?: {
    type?: P2PMessage["type"];
    listing_id?: string;
    transaction_id?: string;
  }
): Promise<P2PMessage> {
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Simple encryption (in production, use recipient's public key)
  const nonce = crypto.randomBytes(24).toString("hex");
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.scryptSync(nonce, "message-salt", 32),
    crypto.randomBytes(16)
  );
  const encryptedContent = Buffer.concat([
    cipher.update(content, "utf8"),
    cipher.final(),
  ]).toString("base64");
  
  // Get or create conversation
  const conversationId = [senderIdentity.did, recipientDid].sort().join(":");
  
  const message: P2PMessage = {
    id: messageId,
    conversation_id: conversationId,
    
    sender: senderIdentity.did,
    recipient: recipientDid,
    
    encrypted_content: encryptedContent,
    encryption_algorithm: "aes-256-gcm",
    nonce,
    
    type: metadata?.type || "text",
    related_listing_id: metadata?.listing_id,
    related_transaction_id: metadata?.transaction_id,
    
    signature: signData(encryptedContent, privateKey),
    
    delivered: false,
    read: false,
    
    created_at: new Date().toISOString(),
  };
  
  // Save message
  const msgPath = path.join(getMessagesDir(), `${messageId}.json`);
  await fs.writeJson(msgPath, message, { spaces: 2 });
  
  return message;
}

/**
 * Get conversations
 */
async function getConversations(userDid: string): Promise<P2PConversation[]> {
  const msgsDir = getMessagesDir();
  await fs.ensureDir(msgsDir);
  
  const files = await fs.readdir(msgsDir);
  const conversationMap = new Map<string, P2PMessage[]>();
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const msg: P2PMessage = await fs.readJson(path.join(msgsDir, file));
        if (msg.sender === userDid || msg.recipient === userDid) {
          const existing = conversationMap.get(msg.conversation_id) || [];
          existing.push(msg);
          conversationMap.set(msg.conversation_id, existing);
        }
      } catch (error) {
        logger.warn(`Failed to load message ${file}:`, error);
      }
    }
  }
  
  const conversations: P2PConversation[] = [];
  for (const [id, messages] of conversationMap) {
    const participants = id.split(":");
    const lastMessage = messages.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    
    conversations.push({
      id,
      participants,
      last_message_at: lastMessage.created_at,
      unread_count: messages.filter(m => m.recipient === userDid && !m.read).length,
      created_at: messages[messages.length - 1].created_at,
    });
  }
  
  return conversations.sort((a, b) => 
    new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

// ============= Stats =============

/**
 * Get federation network stats
 */
async function getFederationStats(): Promise<FederationStats> {
  const peers = await getKnownPeers();
  const listings = await getP2PListings();
  const transactions = await getTransactions();
  
  const onlinePeers = peers.filter(p => p.status === "online").length;
  const activeListings = listings.filter(l => l.status === "active").length;
  const completedTx = transactions.filter(t => t.status === "completed");
  
  const totalVolume = completedTx.reduce((sum, tx) => sum + tx.amount, 0);
  
  return {
    total_peers: peers.length,
    online_peers: onlinePeers,
    total_storage_tb: peers.reduce((sum, p) => sum + (p.storage_available_gb || 0), 0) / 1024,
    total_bandwidth_gbps: peers.reduce((sum, p) => sum + (p.bandwidth_mbps || 0), 0) / 1000,
    
    total_listings: listings.length,
    active_listings: activeListings,
    total_transactions: transactions.length,
    total_volume_usd: totalVolume,
    
    total_assets: new Set(listings.map(l => l.asset_id)).size,
    total_chunks: listings.reduce((sum, l) => sum + (l.chunk_ids?.length || 1), 0),
    unique_creators: new Set(listings.map(l => l.seller.did)).size,
    
    network_health: onlinePeers > 10 ? "excellent" : onlinePeers > 5 ? "good" : onlinePeers > 0 ? "degraded" : "poor",
    avg_latency_ms: 50, // Placeholder
    replication_factor: 3,
    
    updated_at: new Date().toISOString(),
  };
}

// ============= Register Handlers =============

export function registerFederationHandlers() {
  initFederationDirs();

  // Identity
  ipcMain.handle("federation:create-identity", async (_, displayName: string, password: string) => {
    return createIdentity(displayName, password);
  });

  ipcMain.handle("federation:get-identity", async () => {
    return getLocalIdentity();
  });

  // Peers
  ipcMain.handle("federation:get-peers", async () => {
    return getKnownPeers();
  });

  ipcMain.handle("federation:get-connected-peers", async () => {
    return getConnectedPeers();
  });

  ipcMain.handle("federation:connect-peer", async (_, peerId: string) => {
    return connectToPeer(peerId);
  });

  ipcMain.handle("federation:disconnect-peer", async (_, peerId: string) => {
    return disconnectPeer(peerId);
  });

  ipcMain.handle("federation:add-peer", async (_, peer: Peer) => {
    return addPeer(peer);
  });

  // DHT
  ipcMain.handle("federation:dht-put", async (_, key: string, value: any, publisherDid: string, privateKey: string, ttl?: number) => {
    return dhtPut(key, value, publisherDid, privateKey, ttl);
  });

  ipcMain.handle("federation:dht-get", async (_, key: string) => {
    return dhtGet(key);
  });

  // P2P Listings
  ipcMain.handle("federation:create-listing", async (_, params: {
    nftListing: NFTListing;
    pricing: P2PPricing;
    license: P2PLicense;
    privateKey: string;
  }) => {
    const identity = await getLocalIdentity();
    if (!identity) throw new Error("No local identity");
    return createP2PListing(params.nftListing, params.pricing, params.license, identity, params.privateKey);
  });

  ipcMain.handle("federation:get-listings", async () => {
    return getP2PListings();
  });

  ipcMain.handle("federation:search-listings", async (_, query: {
    keyword?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    currency?: string;
  }) => {
    return searchP2PListings(query);
  });

  // Transactions
  ipcMain.handle("federation:initiate-transaction", async (_, listingId: string, privateKey: string) => {
    const identity = await getLocalIdentity();
    if (!identity) throw new Error("No local identity");
    return initiateTransaction(listingId, identity, privateKey);
  });

  ipcMain.handle("federation:update-transaction", async (_, transactionId: string, status: TransactionStatus, privateKey: string, message?: string) => {
    const identity = await getLocalIdentity();
    if (!identity) throw new Error("No local identity");
    return updateTransactionStatus(transactionId, status, identity.did, privateKey, message);
  });

  ipcMain.handle("federation:get-transactions", async () => {
    return getTransactions();
  });

  // Escrow
  ipcMain.handle("federation:create-escrow", async (_, transactionId: string, mediatorDid?: string) => {
    const transactions = await getTransactions();
    const tx = transactions.find(t => t.id === transactionId);
    if (!tx) throw new Error("Transaction not found");
    return createEscrow(tx, mediatorDid);
  });

  // Messaging
  ipcMain.handle("federation:send-message", async (_, params: {
    recipientDid: string;
    content: string;
    privateKey: string;
    metadata?: {
      type?: P2PMessage["type"];
      listing_id?: string;
      transaction_id?: string;
    };
  }) => {
    const identity = await getLocalIdentity();
    if (!identity) throw new Error("No local identity");
    return sendMessage(params.recipientDid, params.content, identity, params.privateKey, params.metadata);
  });

  ipcMain.handle("federation:get-conversations", async () => {
    const identity = await getLocalIdentity();
    if (!identity) throw new Error("No local identity");
    return getConversations(identity.did);
  });

  // Stats
  ipcMain.handle("federation:get-stats", async () => {
    return getFederationStats();
  });

  logger.info("Federation P2P handlers registered");
}
