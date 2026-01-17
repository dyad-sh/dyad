/**
 * Federation & P2P Network Handlers
 * Decentralized peer-to-peer marketplace for JoyCreate
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { heliaVerificationService } from "@/lib/helia_verification_service";
import { trustlessInferenceService } from "@/lib/trustless_inference_service";
import { ipldReceiptService } from "@/lib/ipld_receipt_service";
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
  ModelChunkAnnouncement,
  FederatedInferenceRequest,
  FederatedInferenceRoute,
  IpldReceiptRef,
  FederatedInferenceExecutionRequest,
  FederatedInferenceExecutionResult,
  ModelChunkListing,
  ModelChunkPurchase,
  BootstrapPeerEntry,
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

function getModelChunksIndexPath(): string {
  return path.join(getDHTDir(), "model_chunks.json");
}

function getModelChunkListingsDir(): string {
  return path.join(getFederationDir(), "model-chunk-listings");
}

function getModelChunkPurchasesDir(): string {
  return path.join(getFederationDir(), "model-chunk-purchases");
}

function getBootstrapPeersPath(): string {
  return path.join(getFederationDir(), "bootstrap_peers.json");
}

async function initFederationDirs() {
  await fs.ensureDir(getFederationDir());
  await fs.ensureDir(getPeersDir());
  await fs.ensureDir(getListingsDir());
  await fs.ensureDir(getTransactionsDir());
  await fs.ensureDir(getMessagesDir());
  await fs.ensureDir(getDHTDir());
  await fs.ensureDir(getModelChunkListingsDir());
  await fs.ensureDir(getModelChunkPurchasesDir());
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
  password: string,
  storeName?: string,
  creatorId?: string
): Promise<{ identity: DecentralizedIdentity; privateKey: string }> {
  const { publicKey, privateKey } = generateKeyPair();
  
  // Create DID from public key hash
  const keyHash = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 32);
  const did = `did:joy:${keyHash}`;
  
  const identity: DecentralizedIdentity = {
    did,
    public_key: publicKey,
    display_name: displayName,
    ...(storeName ? { store_name: storeName } : {}),
    ...(creatorId ? { creator_id: creatorId } : {}),
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

function hashString(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
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

// ============= Bootstrap Peers =============

async function listBootstrapPeers(): Promise<BootstrapPeerEntry[]> {
  const filePath = getBootstrapPeersPath();
  if (!(await fs.pathExists(filePath))) {
    return [];
  }
  try {
    return await fs.readJson(filePath);
  } catch {
    return [];
  }
}

async function saveBootstrapPeers(peers: BootstrapPeerEntry[]): Promise<void> {
  const filePath = getBootstrapPeersPath();
  await fs.writeJson(filePath, peers, { spaces: 2 });
}

async function addBootstrapPeer(entry: Omit<BootstrapPeerEntry, "added_at">): Promise<BootstrapPeerEntry> {
  const peers = await listBootstrapPeers();
  if (peers.some((peer) => peer.id === entry.id)) {
    throw new Error("Bootstrap peer already exists");
  }
  const record: BootstrapPeerEntry = {
    ...entry,
    added_at: new Date().toISOString(),
  };
  peers.push(record);
  await saveBootstrapPeers(peers);
  return record;
}

async function removeBootstrapPeer(peerId: string): Promise<void> {
  const peers = await listBootstrapPeers();
  const next = peers.filter((peer) => peer.id !== peerId);
  await saveBootstrapPeers(next);
}

async function importBootstrapPeer(peerId: string): Promise<Peer> {
  const bootstrapPeers = await listBootstrapPeers();
  const entry = bootstrapPeers.find((peer) => peer.id === peerId);
  if (!entry) {
    throw new Error("Bootstrap peer not found");
  }

  const peer: Peer = {
    id: entry.id,
    did: {
      did: entry.did || `did:joy:${entry.id}`,
      public_key: "",
      display_name: entry.display_name || entry.id.slice(0, 12),
      created_at: new Date().toISOString(),
      capabilities: entry.capabilities || ["relay"],
    },
    addresses: entry.address
      ? [
          {
            protocol: "libp2p",
            address: entry.address,
          },
        ]
      : [],
    protocols: ["libp2p"],
    agent_version: "unknown",
    status: "offline",
    last_seen: new Date().toISOString(),
    capabilities: entry.capabilities || ["relay"],
    reputation: {
      score: 50,
      total_transactions: 0,
      successful_transactions: 0,
      disputes: 0,
      disputes_won: 0,
      uptime_percentage: 0,
      avg_response_time_ms: 0,
      reviews: [],
      badges: [],
    },
    connected: false,
  };

  await addPeer(peer);
  return peer;
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

// ============= Model Chunk DHT =============

async function loadModelChunkIndex(): Promise<Record<string, ModelChunkAnnouncement[]>> {
  const indexPath = getModelChunksIndexPath();
  if (await fs.pathExists(indexPath)) {
    try {
      return await fs.readJson(indexPath);
    } catch {
      return {};
    }
  }
  return {};
}

async function saveModelChunkIndex(index: Record<string, ModelChunkAnnouncement[]>): Promise<void> {
  await fs.writeJson(getModelChunksIndexPath(), index, { spaces: 2 });
}

async function announceModelChunk(params: {
  modelId: string;
  modelHash?: string;
  chunkCid: string;
  chunkIndex: number;
  totalChunks?: number;
  bytes?: number;
  privateKey: string;
}): Promise<ModelChunkAnnouncement> {
  const identity = await getLocalIdentity();
  if (!identity) {
    throw new Error("No local identity");
  }

  const announcement: ModelChunkAnnouncement = {
    model_id: params.modelId,
    model_hash: params.modelHash,
    chunk_cid: params.chunkCid,
    chunk_index: params.chunkIndex,
    total_chunks: params.totalChunks,
    bytes: params.bytes,
    peer_id: identity.did.replace("did:joy:", ""),
    publisher_did: identity.did,
    created_at: new Date().toISOString(),
  };

  const key = `model-chunk:${params.modelId}:${params.chunkCid}`;
  await dhtPut(key, announcement, identity.did, params.privateKey);

  const index = await loadModelChunkIndex();
  const existing = index[params.modelId] || [];
  const deduped = existing.filter((item) => item.chunk_cid !== params.chunkCid);
  index[params.modelId] = [...deduped, announcement];
  await saveModelChunkIndex(index);

  return announcement;
}

async function findModelChunks(modelId: string): Promise<ModelChunkAnnouncement[]> {
  const index = await loadModelChunkIndex();
  return (index[modelId] || []).sort((a, b) => a.chunk_index - b.chunk_index);
}

// ============= Model Chunk Marketplace =============

async function createModelChunkListing(params: {
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
  const identity = await getLocalIdentity();
  if (!identity) {
    throw new Error("No local identity");
  }

  const listingId = `mchunk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listing: ModelChunkListing = {
    id: listingId,
    model_id: params.modelId,
    model_hash: params.modelHash,
    chunk_cids: params.chunkCids,
    chunk_count: params.chunkCount,
    bytes_total: params.bytesTotal,
    title: params.title,
    description: params.description,
    tags: params.tags || [],
    pricing: params.pricing,
    license: params.license,
    seller: {
      did: identity.did,
      peer_id: identity.did.replace("did:joy:", ""),
      display_name: identity.display_name,
      reputation_score: 100,
    },
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const listingPath = path.join(getModelChunkListingsDir(), `${listingId}.json`);
  await fs.writeJson(listingPath, listing, { spaces: 2 });

  await dhtPut(`model-chunk-listing:${listingId}`, listing, identity.did, params.privateKey);

  return listing;
}

async function listModelChunkListings(): Promise<ModelChunkListing[]> {
  const listingsDir = getModelChunkListingsDir();
  await fs.ensureDir(listingsDir);
  const files = await fs.readdir(listingsDir);
  const listings: ModelChunkListing[] = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        listings.push(await fs.readJson(path.join(listingsDir, file)));
      } catch (error) {
        logger.warn(`Failed to load model chunk listing ${file}:`, error);
      }
    }
  }

  return listings.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

async function purchaseModelChunkListing(params: {
  listingId: string;
  buyerDid: string;
  paymentTxHash?: string;
  receiptCid?: string;
}): Promise<ModelChunkPurchase> {
  const listingPath = path.join(getModelChunkListingsDir(), `${params.listingId}.json`);
  if (!(await fs.pathExists(listingPath))) {
    throw new Error("Model chunk listing not found");
  }

  const listing: ModelChunkListing = await fs.readJson(listingPath);
  const purchaseId = `mchunk-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const purchase: ModelChunkPurchase = {
    id: purchaseId,
    listing_id: listing.id,
    buyer_did: params.buyerDid,
    seller_did: listing.seller.did,
    amount: listing.pricing.base_price || 0,
    currency: listing.pricing.preferred_currency,
    status: "initiated",
    payment_tx_hash: params.paymentTxHash,
    receipt_cid: params.receiptCid,
    created_at: new Date().toISOString(),
  };

  const purchasePath = path.join(getModelChunkPurchasesDir(), `${purchaseId}.json`);
  await fs.writeJson(purchasePath, purchase, { spaces: 2 });

  return purchase;
}

async function listModelChunkPurchases(): Promise<ModelChunkPurchase[]> {
  const purchasesDir = getModelChunkPurchasesDir();
  await fs.ensureDir(purchasesDir);
  const files = await fs.readdir(purchasesDir);
  const purchases: ModelChunkPurchase[] = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        purchases.push(await fs.readJson(path.join(purchasesDir, file)));
      } catch (error) {
        logger.warn(`Failed to load model chunk purchase ${file}:`, error);
      }
    }
  }

  return purchases.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

async function createModelChunkEscrow(transactionId: string): Promise<P2PEscrow> {
  const purchases = await listModelChunkPurchases();
  const purchase = purchases.find((p) => p.id === transactionId);
  if (!purchase) {
    throw new Error("Purchase not found");
  }

  const escrowId = `mchunk-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const escrow: P2PEscrow = {
    id: escrowId,
    transaction_id: purchase.id,
    amount: purchase.amount,
    currency: purchase.currency,
    fee_amount: purchase.amount * 0.01,
    required_signatures: 2,
    signers: [
      { role: "buyer", did: purchase.buyer_did, public_key: "", has_signed: false },
      { role: "seller", did: purchase.seller_did, public_key: "", has_signed: false },
    ],
    status: "pending",
    release_conditions: [{ type: "delivery-confirmed", satisfied: false }],
    auto_release_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  const escrowPath = path.join(getFederationDir(), "escrow", `${escrowId}.json`);
  await fs.writeJson(escrowPath, escrow, { spaces: 2 });

  purchase.escrow_id = escrowId;
  purchase.status = "paid";
  await fs.writeJson(
    path.join(getModelChunkPurchasesDir(), `${purchase.id}.json`),
    purchase,
    { spaces: 2 }
  );

  return escrow;
}

async function routeInference(
  request: FederatedInferenceRequest
): Promise<FederatedInferenceRoute> {
  const identity = await getLocalIdentity();
  if (!identity) {
    throw new Error("No local identity");
  }

  const computePeers = Array.from(connectedPeers.values()).filter((peer) =>
    peer.capabilities.includes("compute")
  );

  const preferredPeer = request.preferred_peer_id
    ? computePeers.find((peer) => peer.id === request.preferred_peer_id)
    : undefined;
  const targetPeer = preferredPeer || computePeers[0];
  const requiredChunks = await findModelChunks(request.model_id);

  let receiptRef: IpldReceiptRef | undefined;
  if (request.create_receipt) {
    const record = await ipldReceiptService.createReceipt({
      issuer: request.issuer_did || identity.did,
      payer: request.payer_did,
      modelId: request.model_id,
      modelHash: request.model_hash,
      storeName: identity.store_name,
      creatorId: identity.creator_id,
      dataHash: request.data_hash,
      promptHash: request.prompt_hash,
      paymentTxHash: request.payment_tx_hash,
      paymentAmount: request.payment_amount,
    });
    receiptRef = {
      cid: record.cid,
      created_at: new Date(record.createdAt).toISOString(),
      json_path: record.jsonPath,
      cbor_path: record.cborPath,
    };
  }

  if (targetPeer) {
    return {
      route_id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      target: {
        peer_id: targetPeer.id,
        did: targetPeer.did.did,
        display_name: targetPeer.did.display_name,
        capability: "compute",
      },
      required_chunks: requiredChunks,
      receipt: receiptRef,
      created_at: new Date().toISOString(),
    };
  }

  return {
    route_id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    target: {
      did: identity.did,
      display_name: identity.display_name,
      capability: "local",
    },
    required_chunks: requiredChunks,
    receipt: receiptRef,
    created_at: new Date().toISOString(),
  };
}

async function createReceiptRef(params: {
  issuerDid: string;
  payerDid: string;
  modelId: string;
  modelHash?: string;
  storeName?: string;
  creatorId?: string;
  dataHash: string;
  promptHash: string;
  outputHash?: string;
  paymentTxHash?: string;
  paymentAmount?: string;
}): Promise<IpldReceiptRef> {
  const record = await ipldReceiptService.createReceipt({
    issuer: params.issuerDid,
    payer: params.payerDid,
    modelId: params.modelId,
    modelHash: params.modelHash,
    storeName: params.storeName,
    creatorId: params.creatorId,
    dataHash: params.dataHash,
    promptHash: params.promptHash,
    outputHash: params.outputHash,
    paymentTxHash: params.paymentTxHash,
    paymentAmount: params.paymentAmount,
  });

  return {
    cid: record.cid,
    created_at: new Date(record.createdAt).toISOString(),
    json_path: record.jsonPath,
    cbor_path: record.cborPath,
  };
}

async function executeFederatedInference(
  request: FederatedInferenceExecutionRequest
): Promise<FederatedInferenceExecutionResult> {
  const identity = await getLocalIdentity();
  if (!identity) {
    throw new Error("No local identity");
  }

  const promptHash = hashString(request.prompt);
  const dataHash = request.data_hash || "";

  if (request.create_receipt && !dataHash) {
    throw new Error("data_hash is required to create a receipt");
  }

  const route = await routeInference({
    model_id: request.model_id,
    model_hash: request.model_hash,
    prompt_hash: promptHash,
    data_hash: dataHash || promptHash,
    preferred_peer_id: request.preferred_peer_id,
    issuer_did: request.issuer_did,
    payer_did: request.payer_did,
    payment_tx_hash: request.payment_tx_hash,
    payment_amount: request.payment_amount,
    create_receipt: false,
  });

  if (route.target.capability === "compute") {
    if (request.require_remote && !request.private_key) {
      throw new Error("private_key is required to dispatch to remote compute");
    }
    let dispatchMessageId: string | undefined;
    if (request.private_key) {
      const payload = {
        type: "federated-inference-request",
        model_id: request.model_id,
        model_hash: request.model_hash,
        prompt: request.prompt,
        system_prompt: request.system_prompt,
        messages: request.messages,
        config: request.config,
        data_hash: dataHash,
        payer_did: request.payer_did,
        payment_tx_hash: request.payment_tx_hash,
        payment_amount: request.payment_amount,
      };
      const msg = await sendMessage(
        route.target.did,
        JSON.stringify(payload),
        identity,
        request.private_key,
        { type: "system" }
      );
      dispatchMessageId = msg.id;
    }

    const receiptRef = request.create_receipt
      ? await createReceiptRef({
          issuerDid: request.issuer_did || identity.did,
          payerDid: request.payer_did,
          modelId: request.model_id,
          modelHash: request.model_hash,
          storeName: identity.store_name,
          creatorId: identity.creator_id,
          dataHash: dataHash || promptHash,
          promptHash,
          paymentTxHash: request.payment_tx_hash,
          paymentAmount: request.payment_amount,
        })
      : undefined;

    return {
      status: "dispatched",
      route,
      receipt: receiptRef,
      dispatch_message_id: dispatchMessageId,
    };
  }

  if (request.require_remote) {
    throw new Error("No compute peers available for remote-only inference");
  }

  const result = await trustlessInferenceService.runVerifiedInference(
    request.provider,
    request.model_id,
    request.prompt,
    {
      systemPrompt: request.system_prompt,
      messages: request.messages,
      config: request.config ? { options: request.config } : undefined,
    }
  );

  const outputHash = hashString(result.response.output);
  const receiptRef = request.create_receipt
    ? await createReceiptRef({
        issuerDid: request.issuer_did || identity.did,
        payerDid: request.payer_did,
        modelId: request.model_id,
        modelHash: request.model_hash,
        storeName: identity.store_name,
        creatorId: identity.creator_id,
        dataHash: dataHash || promptHash,
        promptHash,
        outputHash,
        paymentTxHash: request.payment_tx_hash,
        paymentAmount: request.payment_amount,
      })
    : undefined;

  return {
    status: "local",
    route,
    output: result.response.output,
    record_id: result.record?.id,
    proof_cid: result.record?.cid,
    receipt: receiptRef,
  };
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
  ipcMain.handle(
    "federation:create-identity",
    async (
      _,
      displayName: string,
      password: string,
      storeName?: string,
      creatorId?: string
    ) => {
      return createIdentity(displayName, password, storeName, creatorId);
    }
  );
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

  // Bootstrap peers
  ipcMain.handle("federation:bootstrap:list", async () => {
    return listBootstrapPeers();
  });

  ipcMain.handle("federation:bootstrap:add", async (_, entry: Omit<BootstrapPeerEntry, "added_at">) => {
    return addBootstrapPeer(entry);
  });

  ipcMain.handle("federation:bootstrap:remove", async (_, peerId: string) => {
    return removeBootstrapPeer(peerId);
  });

  ipcMain.handle("federation:bootstrap:import", async (_, peerId: string) => {
    return importBootstrapPeer(peerId);
  });

  // DHT
  ipcMain.handle("federation:dht-put", async (_, key: string, value: any, publisherDid: string, privateKey: string, ttl?: number) => {
    return dhtPut(key, value, publisherDid, privateKey, ttl);
  });

  ipcMain.handle("federation:dht-get", async (_, key: string) => {
    return dhtGet(key);
  });

  // Model chunk transfer (Helia/IPFS)
  ipcMain.handle("federation:model-chunk-serve", async (_, params: { filePath: string }) => {
    await heliaVerificationService.start();
    return heliaVerificationService.storeModelChunkFile(params.filePath);
  });

  ipcMain.handle("federation:model-chunk-request", async (_, params: { cid: string; outputPath: string }) => {
    await heliaVerificationService.start();
    return heliaVerificationService.exportModelChunkToFile(params.cid, params.outputPath);
  });

  // Model chunk announcements
  ipcMain.handle("federation:model-chunk-announce", async (_, params: {
    modelId: string;
    modelHash?: string;
    chunkCid: string;
    chunkIndex: number;
    totalChunks?: number;
    bytes?: number;
    privateKey: string;
  }) => {
    return announceModelChunk(params);
  });

  ipcMain.handle("federation:model-chunk-find", async (_, modelId: string) => {
    return findModelChunks(modelId);
  });

  // Federated inference routing
  ipcMain.handle("federation:route-inference", async (_, request: FederatedInferenceRequest) => {
    return routeInference(request);
  });

  ipcMain.handle("federation:execute-inference", async (_, request: FederatedInferenceExecutionRequest) => {
    return executeFederatedInference(request);
  });

  ipcMain.handle("federation:execute-inference-stream", async (event, request: FederatedInferenceExecutionRequest) => {
    const streamId = `federated-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const identity = await getLocalIdentity();

    (async () => {
      try {
        if (!identity) {
          throw new Error("No local identity");
        }

        const route = await routeInference({
          model_id: request.model_id,
          model_hash: request.model_hash,
          prompt_hash: hashString(request.prompt),
          data_hash: request.data_hash || hashString(request.prompt),
          preferred_peer_id: request.preferred_peer_id,
          issuer_did: request.issuer_did,
          payer_did: request.payer_did,
          payment_tx_hash: request.payment_tx_hash,
          payment_amount: request.payment_amount,
          create_receipt: false,
        });

        if (route.target.capability === "compute") {
          event.sender.send("federation:inference:done", {
            streamId,
            status: "dispatched",
            route,
          });
          return;
        }

        if (request.require_remote) {
          throw new Error("No compute peers available for remote-only inference");
        }

        const stream = trustlessInferenceService.streamVerifiedInference(
          request.provider,
          request.model_id,
          request.messages || [{ role: "user", content: request.prompt }],
          {
            systemPrompt: request.system_prompt,
            config: request.config ? { options: request.config } : undefined,
          }
        );

        let collectedOutput = "";
        for await (const chunk of stream) {
          if (chunk.type === "token") {
            collectedOutput += chunk.content;
            event.sender.send("federation:inference:chunk", {
              streamId,
              content: chunk.content,
            });
          } else if (chunk.type === "done") {
            let receiptRef: IpldReceiptRef | undefined;
            if (request.create_receipt && request.data_hash) {
              receiptRef = await createReceiptRef({
                issuerDid: request.issuer_did || identity.did,
                payerDid: request.payer_did,
                modelId: request.model_id,
                modelHash: request.model_hash,
                storeName: identity.store_name,
                creatorId: identity.creator_id,
                dataHash: request.data_hash,
                promptHash: hashString(request.prompt),
                outputHash: hashString(collectedOutput),
                paymentTxHash: request.payment_tx_hash,
                paymentAmount: request.payment_amount,
              });
            }

            event.sender.send("federation:inference:done", {
              streamId,
              status: "local",
              route,
              recordId: chunk.record?.id,
              cid: chunk.record?.cid,
              receipt: receiptRef,
            });
          }
        }
      } catch (error) {
        event.sender.send("federation:inference:error", {
          streamId,
          error: String(error),
        });
      }
    })();

    return { streamId };
  });

  // Model chunk marketplace
  ipcMain.handle("federation:model-chunk-listing:create", async (_, params: {
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
  }) => {
    return createModelChunkListing(params);
  });

  ipcMain.handle("federation:model-chunk-listing:list", async () => {
    return listModelChunkListings();
  });

  ipcMain.handle("federation:model-chunk-purchase:create", async (_, params: {
    listingId: string;
    buyerDid: string;
    paymentTxHash?: string;
    receiptCid?: string;
  }) => {
    return purchaseModelChunkListing(params);
  });

  ipcMain.handle("federation:model-chunk-purchase:list", async () => {
    return listModelChunkPurchases();
  });

  ipcMain.handle("federation:model-chunk-escrow:create", async (_, transactionId: string) => {
    return createModelChunkEscrow(transactionId);
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
