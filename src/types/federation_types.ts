/**
 * Federation & P2P Marketplace Types
 * Decentralized peer-to-peer asset marketplace for JoyCreate
 */

// ============= Identity & Keys =============

/**
 * Decentralized Identity (DID)
 * Self-sovereign identity for peers
 */
export interface DecentralizedIdentity {
  did: string;                      // did:joy:xxxx or did:key:xxxx
  public_key: string;               // Ed25519 public key
  display_name: string;
  avatar_cid?: string;              // IPFS CID for avatar
  bio?: string;
  created_at: string;
  
  // Verification
  verified_domains?: string[];      // DNS-verified domains
  verified_social?: {
    platform: string;
    handle: string;
    proof_url: string;
  }[];
  
  // Capabilities
  capabilities: PeerCapability[];
}

export type PeerCapability = 
  | "asset-hosting"       // Can host/seed assets
  | "relay"               // Can relay messages
  | "storage"             // Offers storage space
  | "compute"             // Offers compute for inference
  | "validation"          // Can validate transactions
  | "marketplace"         // Runs marketplace node
  | "gateway";            // HTTP gateway for web access

// ============= Peer Network =============

/**
 * Peer in the federated network
 */
export interface Peer {
  id: string;                       // Peer ID (derived from public key)
  did: DecentralizedIdentity;
  
  // Network info
  addresses: PeerAddress[];
  protocols: string[];              // Supported protocols
  agent_version: string;            // JoyCreate version
  
  // Status
  status: "online" | "offline" | "busy" | "away";
  last_seen: string;
  latency_ms?: number;
  
  // Capabilities
  capabilities: PeerCapability[];
  storage_available_gb?: number;
  bandwidth_mbps?: number;
  
  // Reputation
  reputation: PeerReputation;
  
  // Connection
  connected: boolean;
  connection_quality?: "excellent" | "good" | "fair" | "poor";
}

export interface PeerAddress {
  protocol: "libp2p" | "tcp" | "quic" | "webrtc" | "websocket";
  address: string;
  port?: number;
  is_relay?: boolean;
}

export interface PeerReputation {
  score: number;                    // 0-100
  total_transactions: number;
  successful_transactions: number;
  disputes: number;
  disputes_won: number;
  uptime_percentage: number;
  avg_response_time_ms: number;
  reviews: PeerReview[];
  badges: ReputationBadge[];
}

export interface PeerReview {
  id: string;
  reviewer_did: string;
  reviewer_name: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  transaction_id: string;
  created_at: string;
  verified: boolean;                // Cryptographically verified
}

export type ReputationBadge = 
  | "early-adopter"
  | "trusted-seller"
  | "verified-creator"
  | "high-volume"
  | "quality-assets"
  | "fast-delivery"
  | "dispute-resolver"
  | "network-contributor";

// ============= DHT & Discovery =============

/**
 * Distributed Hash Table record
 */
export interface DHTRecord {
  key: string;                      // Content hash or peer ID
  value: any;
  publisher: string;                // DID of publisher
  signature: string;                // Ed25519 signature
  timestamp: string;
  ttl_seconds: number;
  replicas: string[];               // Peer IDs holding replicas
}

export interface BootstrapPeerEntry {
  id: string; // peer id
  did?: string;
  display_name?: string;
  address?: string;
  capabilities?: PeerCapability[];
  notes?: string;
  added_at: string;
}

/**
 * Model chunk availability record in DHT
 */
export interface ModelChunkAnnouncement {
  model_id: string;
  model_hash?: string;
  chunk_cid: string;
  chunk_index: number;
  total_chunks?: number;
  bytes?: number;
  peer_id: string;
  publisher_did: string;
  created_at: string;
}

/**
 * IPLD receipt reference for routing and verification
 */
export interface IpldReceiptRef {
  cid: string;
  created_at: string;
  json_path?: string;
  cbor_path?: string;
}

export interface FederatedInferenceRequest {
  model_id: string;
  model_hash?: string;
  prompt_hash: string;
  data_hash: string;
  preferred_peer_id?: string;
  issuer_did?: string;
  payer_did: string;
  payment_tx_hash?: string;
  payment_amount?: string;
  create_receipt?: boolean;
}

export interface FederatedInferenceRoute {
  route_id: string;
  target: {
    peer_id?: string;
    did: string;
    display_name?: string;
    capability: "compute" | "local";
  };
  required_chunks: ModelChunkAnnouncement[];
  receipt?: IpldReceiptRef;
  created_at: string;
}

export interface FederatedInferenceExecutionRequest {
  provider: "ollama" | "lmstudio" | "llamacpp" | "vllm";
  model_id: string;
  model_hash?: string;
  prompt: string;
  system_prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  config?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    seed?: number;
  };
  data_hash?: string;
  preferred_peer_id?: string;
  payer_did: string;
  issuer_did?: string;
  payment_tx_hash?: string;
  payment_amount?: string;
  create_receipt?: boolean;
  require_remote?: boolean;
  private_key?: string;
}

export interface FederatedInferenceExecutionResult {
  status: "local" | "dispatched";
  route: FederatedInferenceRoute;
  output?: string;
  record_id?: string;
  proof_cid?: string;
  receipt?: IpldReceiptRef;
  dispatch_message_id?: string;
}

/**
 * Asset discovery record in DHT
 */
export interface AssetDiscoveryRecord {
  asset_id: string;
  content_hash: string;
  metadata_cid: string;             // IPFS CID for metadata
  
  // Availability
  seeders: AssetSeeder[];
  total_seeders: number;
  
  // Discovery
  tags: string[];
  category: string;
  search_keywords: string[];
  
  // Pricing (from various sellers)
  listings: P2PListing[];
  
  created_at: string;
  updated_at: string;
}

export interface AssetSeeder {
  peer_id: string;
  did: string;
  available_chunks: number[];       // Which chunks this peer has
  bandwidth_limit?: number;         // KB/s
  pricing?: {
    price_per_gb: number;
    currency: string;
  };
}

// ============= P2P Listings =============

/**
 * Decentralized marketplace listing
 */
export interface P2PListing {
  id: string;
  asset_id: string;
  chunk_ids?: string[];             // Specific chunks if partial
  
  // Seller
  seller: {
    did: string;
    peer_id: string;
    display_name: string;
    reputation_score: number;
  };
  
  // Pricing
  pricing: P2PPricing;
  
  // Availability
  availability: "instant" | "on-request" | "scheduled";
  delivery_method: "direct-transfer" | "ipfs" | "arweave" | "relay";
  
  // Terms
  license: P2PLicense;
  terms_cid?: string;               // IPFS CID for full terms
  
  // Status
  status: "active" | "paused" | "sold-out" | "expired";
  stock?: number;                   // For limited listings
  expires_at?: string;
  
  // Verification
  signature: string;                // Seller's signature
  verified_at?: string;
  
  created_at: string;
  updated_at: string;
}

export interface P2PPricing {
  type: "fixed" | "auction" | "negotiable" | "pay-what-you-want" | "free";
  
  // Amounts
  base_price?: number;
  min_price?: number;               // For negotiable/PWYW
  suggested_price?: number;
  
  // Currency options
  accepted_currencies: P2PCurrency[];
  preferred_currency: P2PCurrency;
  
  // Payment terms
  escrow_required: boolean;
  escrow_percentage?: number;
  payment_window_hours?: number;
  
  // Discounts
  bulk_pricing?: {
    quantity: number;
    discount_percent: number;
  }[];
  referral_discount_percent?: number;
}

export interface P2PCurrency {
  symbol: string;                   // JOY, ETH, USDC, BTC, etc.
  network?: string;                 // ethereum, polygon, bitcoin, joy-chain
  contract_address?: string;        // For tokens
  exchange_rate_usd?: number;
}

export interface P2PLicense {
  type: "ownership" | "license" | "rental" | "subscription";
  
  // Rights
  can_resell: boolean;
  can_modify: boolean;
  can_commercial_use: boolean;
  can_distribute: boolean;
  
  // Restrictions
  max_users?: number;
  max_deployments?: number;
  geographic_restrictions?: string[];
  
  // Duration
  duration?: "perpetual" | "time-limited";
  expires_at?: string;
  
  // Royalties
  royalty_percentage?: number;
  royalty_recipient?: string;       // DID of royalty recipient
}

// ============= Model Chunk Listings =============

export type ModelChunkLicenseType =
  | "training"
  | "inference"
  | "research"
  | "non-commercial"
  | "custom";

export interface ModelChunkListing {
  id: string;
  model_id: string;
  model_hash?: string;
  chunk_cids: string[];
  chunk_count: number;
  bytes_total?: number;
  title: string;
  description?: string;
  tags: string[];
  pricing: P2PPricing;
  license: {
    type: ModelChunkLicenseType;
    terms_cid?: string;
  };
  seller: {
    did: string;
    peer_id: string;
    display_name: string;
    reputation_score: number;
  };
  status: "active" | "paused" | "sold-out" | "expired";
  created_at: string;
  updated_at: string;
}

export interface ModelChunkPurchase {
  id: string;
  listing_id: string;
  buyer_did: string;
  seller_did: string;
  amount: number;
  currency: P2PCurrency;
  status: "initiated" | "paid" | "delivered" | "completed";
  escrow_id?: string;
  payment_tx_hash?: string;
  receipt_cid?: string;
  created_at: string;
  completed_at?: string;
}

// ============= Transactions =============

/**
 * P2P Transaction
 */
export interface P2PTransaction {
  id: string;
  type: "purchase" | "rental" | "license" | "tip" | "escrow-release" | "refund";
  
  // Parties
  buyer: TransactionParty;
  seller: TransactionParty;
  
  // Asset
  listing_id: string;
  asset_id: string;
  chunk_ids?: string[];
  
  // Payment
  amount: number;
  currency: P2PCurrency;
  escrow_id?: string;
  
  // Status
  status: TransactionStatus;
  status_history: TransactionStatusUpdate[];
  
  // Verification
  buyer_signature?: string;
  seller_signature?: string;
  escrow_signature?: string;
  
  // Delivery
  delivery_method: string;
  delivery_proof?: DeliveryProof;
  
  // Timestamps
  initiated_at: string;
  completed_at?: string;
  expires_at?: string;
  
  // Dispute
  dispute?: TransactionDispute;
}

export interface TransactionParty {
  did: string;
  peer_id: string;
  display_name: string;
  address?: string;                 // Wallet address
}

export type TransactionStatus = 
  | "initiated"
  | "awaiting-payment"
  | "payment-received"
  | "payment-in-escrow"
  | "delivering"
  | "delivered"
  | "confirmed"
  | "completed"
  | "disputed"
  | "refunded"
  | "cancelled"
  | "expired";

export interface TransactionStatusUpdate {
  status: TransactionStatus;
  timestamp: string;
  actor: string;                    // DID of who made the update
  message?: string;
  signature: string;
}

export interface DeliveryProof {
  content_hash: string;             // Hash of delivered content
  delivery_timestamp: string;
  delivery_method: string;
  chunks_delivered: string[];
  merkle_root?: string;             // Merkle root of all chunks
  receiver_confirmation?: string;   // Signature from buyer
}

export interface TransactionDispute {
  id: string;
  transaction_id: string;
  
  initiator: string;                // DID
  respondent: string;               // DID
  
  reason: DisputeReason;
  description: string;
  evidence_cids: string[];          // IPFS CIDs for evidence
  
  // Resolution
  status: "open" | "under-review" | "resolved" | "escalated";
  mediators: string[];              // DIDs of mediators
  resolution?: DisputeResolution;
  
  created_at: string;
  resolved_at?: string;
}

export type DisputeReason = 
  | "non-delivery"
  | "wrong-asset"
  | "quality-issue"
  | "license-violation"
  | "payment-issue"
  | "fraud"
  | "other";

export interface DisputeResolution {
  decision: "buyer-wins" | "seller-wins" | "split" | "cancelled";
  refund_percentage?: number;
  explanation: string;
  mediator_signatures: string[];
}

// ============= Escrow =============

/**
 * Decentralized escrow for secure transactions
 */
export interface P2PEscrow {
  id: string;
  transaction_id: string;
  
  // Amounts
  amount: number;
  currency: P2PCurrency;
  fee_amount: number;
  fee_recipient?: string;
  
  // Multi-sig configuration
  required_signatures: number;      // Usually 2 of 3
  signers: EscrowSigner[];
  
  // Status
  status: "pending" | "funded" | "releasing" | "released" | "refunding" | "refunded" | "disputed";
  
  // Conditions
  release_conditions: EscrowCondition[];
  auto_release_at?: string;         // Auto-release after timeout
  
  // Blockchain (if on-chain)
  contract_address?: string;
  chain_id?: string;
  
  created_at: string;
  funded_at?: string;
  released_at?: string;
}

export interface EscrowSigner {
  role: "buyer" | "seller" | "mediator" | "platform";
  did: string;
  public_key: string;
  has_signed: boolean;
  signature?: string;
  signed_at?: string;
}

export interface EscrowCondition {
  type: "delivery-confirmed" | "time-elapsed" | "dispute-resolved" | "manual-release";
  satisfied: boolean;
  satisfied_at?: string;
  proof?: string;
}

// ============= Messaging =============

/**
 * P2P encrypted messaging
 */
export interface P2PMessage {
  id: string;
  conversation_id: string;
  
  // Parties
  sender: string;                   // DID
  recipient: string;                // DID
  
  // Content (encrypted)
  encrypted_content: string;
  encryption_algorithm: "x25519-xsalsa20-poly1305" | "aes-256-gcm";
  nonce: string;
  
  // Metadata (public)
  type: "text" | "offer" | "counter-offer" | "accept" | "reject" | "system";
  related_listing_id?: string;
  related_transaction_id?: string;
  
  // Verification
  signature: string;
  
  // Status
  delivered: boolean;
  read: boolean;
  
  created_at: string;
}

export interface P2PConversation {
  id: string;
  participants: string[];           // DIDs
  
  // Context
  listing_id?: string;
  transaction_id?: string;
  
  // Status
  last_message_at: string;
  unread_count: number;
  
  created_at: string;
}

// ============= Network Stats =============

/**
 * Federation network statistics
 */
export interface FederationStats {
  // Network
  total_peers: number;
  online_peers: number;
  total_storage_tb: number;
  total_bandwidth_gbps: number;
  
  // Marketplace
  total_listings: number;
  active_listings: number;
  total_transactions: number;
  total_volume_usd: number;
  
  // Assets
  total_assets: number;
  total_chunks: number;
  unique_creators: number;
  
  // Health
  network_health: "excellent" | "good" | "degraded" | "poor";
  avg_latency_ms: number;
  replication_factor: number;
  
  updated_at: string;
}

// ============= Local Node Config =============

/**
 * Local peer node configuration
 */
export interface LocalNodeConfig {
  // Identity
  identity: DecentralizedIdentity;
  private_key_encrypted: string;    // Encrypted with user password
  
  // Network
  listen_addresses: string[];
  bootstrap_peers: string[];
  relay_servers: string[];
  
  // Capabilities
  enabled_capabilities: PeerCapability[];
  
  // Storage
  storage_path: string;
  max_storage_gb: number;
  pin_own_assets: boolean;
  seed_purchased_assets: boolean;
  
  // Bandwidth
  max_upload_mbps: number;
  max_download_mbps: number;
  
  // Privacy
  announce_public_ip: boolean;
  use_tor: boolean;
  
  // Marketplace
  auto_accept_purchases: boolean;
  min_reputation_score: number;
  blocked_peers: string[];
  
  // Fees
  seeding_fee_per_gb?: number;
  relay_fee_per_mb?: number;
}

// ============= Events =============

export type FederationEvent = 
  | { type: "peer-connected"; peer: Peer }
  | { type: "peer-disconnected"; peer_id: string }
  | { type: "listing-discovered"; listing: P2PListing }
  | { type: "listing-updated"; listing: P2PListing }
  | { type: "transaction-initiated"; transaction: P2PTransaction }
  | { type: "transaction-updated"; transaction: P2PTransaction }
  | { type: "message-received"; message: P2PMessage }
  | { type: "asset-available"; asset_id: string; seeders: number }
  | { type: "dispute-opened"; dispute: TransactionDispute }
  | { type: "reputation-updated"; peer_id: string; new_score: number };
