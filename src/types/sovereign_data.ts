/**
 * Sovereign Data Types
 * Local-first, user-owned data with decentralized storage
 * All data is encrypted and stored as content-addressed hashes
 */

// ============================================================================
// Decentralized Storage Networks
// ============================================================================

export type StorageNetwork = 
  | "local"        // Local encrypted storage
  | "ipfs"         // IPFS/Helia - Content-addressed, distributed
  | "arweave"      // Permanent storage, pay once
  | "filecoin"     // Incentivized storage network
  | "ceramic"      // Mutable documents on IPFS
  | "orbit-db"     // P2P database on IPFS
  | "gun"          // Decentralized real-time database
  | "polybase";    // Decentralized database with ZK proofs

export type StorageTier = 
  | "hot"          // Frequently accessed, fast retrieval
  | "warm"         // Occasional access, moderate cost
  | "cold"         // Archive, cheap long-term storage
  | "permanent";   // Arweave - stored forever

export type DataVisibility = 
  | "private"      // Encrypted, only owner can access
  | "shared"       // Encrypted, shared with specific keys
  | "public"       // Public but signed by owner
  | "marketplace"; // Listed for sale/license

// ============================================================================
// Content-Addressed Data
// ============================================================================

export interface ContentHash {
  // The actual content hash (CID for IPFS, txId for Arweave, etc.)
  hash: string;
  // Hash algorithm used
  algorithm: "sha256" | "sha3-256" | "blake3" | "cid-v1";
  // Storage network where this hash is valid
  network: StorageNetwork;
  // Size in bytes
  size: number;
  // Timestamp when hash was created
  timestamp: string;
}

export interface EncryptedContent {
  // Encrypted data blob
  ciphertext: string;
  // Encryption algorithm
  algorithm: "aes-256-gcm" | "chacha20-poly1305" | "xchacha20-poly1305";
  // Initialization vector / nonce
  iv: string;
  // Authentication tag
  authTag?: string;
  // Key derivation info (for key recovery)
  keyDerivation?: {
    algorithm: "argon2id" | "pbkdf2" | "scrypt";
    salt: string;
    iterations?: number;
    memory?: number;
    parallelism?: number;
  };
}

// ============================================================================
// Sovereign Data Container
// ============================================================================

export interface SovereignData<T = unknown> {
  // Unique identifier (derived from content hash)
  id: string;
  
  // Content hashes on various networks for redundancy
  hashes: ContentHash[];
  
  // Primary storage network
  primaryNetwork: StorageNetwork;
  
  // Replication status across networks
  replication: {
    network: StorageNetwork;
    status: "pending" | "synced" | "failed";
    lastSync?: string;
    pinned?: boolean;
  }[];
  
  // Encryption status
  encrypted: boolean;
  encryptionMetadata?: {
    algorithm: string;
    keyId: string; // Reference to user's key
    sharedWith?: string[]; // Public keys that can decrypt
  };
  
  // Data classification
  dataType: DataType;
  visibility: DataVisibility;
  
  // Ownership & provenance
  owner: {
    did: string; // Decentralized Identifier
    publicKey: string;
    signature: string; // Proves ownership
  };
  
  // Versioning (for mutable data)
  version: number;
  previousVersion?: string; // Hash of previous version
  
  // Metadata (stored separately, can be public)
  metadata: SovereignMetadata;
  
  // The actual data (when decrypted and loaded)
  data?: T;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface SovereignMetadata {
  name: string;
  description?: string;
  tags: string[];
  category: string;
  
  // Schema reference for validation
  schema?: string; // CID of JSON schema
  
  // For AI/ML data
  aiMetadata?: {
    modelType?: string;
    inputFormat?: string;
    outputFormat?: string;
    accuracy?: number;
    trainingData?: string; // Hash of training data used
  };
  
  // Licensing & monetization
  license?: DataLicense;
  pricing?: DataPricing;
  
  // Usage stats (stored locally, optionally shared)
  stats?: {
    localAccesses: number;
    downloads: number;
    revenue: number;
  };

  // Consent metadata (local policy enforcement)
  consent?: {
    training?: {
      granted: boolean;
      grantedAt?: string;
      scope?: string;
    };
    outbound?: {
      granted: boolean;
      grantedAt?: string;
      paymentTxHash?: string;
    };
  };
}

// ============================================================================
// Data Types for Local Creation
// ============================================================================

export type DataType = 
  // AI & ML
  | "model-weights"
  | "model-config"
  | "training-data"
  | "embeddings"
  | "inference-result"
  | "agent-config"
  | "agent-memory"
  | "prompt-template"
  
  // Code & Apps
  | "source-code"
  | "compiled-app"
  | "web-component"
  | "api-definition"
  | "schema"
  
  // Data
  | "dataset"
  | "document"
  | "media"
  | "structured-data"
  
  // Personal
  | "personal-data"
  | "browsing-history"
  | "preferences"
  | "health-data"
  | "financial-data"
  
  // Workflows
  | "workflow-definition"
  | "automation-script"
  | "integration-config";

// ============================================================================
// Data Licensing & Monetization
// ============================================================================

export interface DataLicense {
  type: LicenseType;
  
  // What's allowed
  permissions: DataPermission[];
  
  // What's restricted
  restrictions: DataRestriction[];
  
  // Attribution requirements
  attribution?: {
    required: boolean;
    format?: string;
  };
  
  // Expiration
  expiresAt?: string;
  maxUses?: number;
  
  // Legal
  jurisdiction?: string;
  termsHash?: string; // CID of full legal terms
}

export type LicenseType = 
  | "sovereign"     // Full ownership transfer
  | "commercial"    // Commercial use allowed
  | "personal"      // Personal use only
  | "research"      // Academic/research use
  | "derivative"    // Can create derivatives
  | "view-only"     // Can only view/use, not copy
  | "pay-per-use"   // Each use costs
  | "subscription"  // Time-based access
  | "custom";       // Custom terms

export type DataPermission = 
  | "read"
  | "copy"
  | "modify"
  | "redistribute"
  | "commercial-use"
  | "train-ai"
  | "embed"
  | "derivative-works";

export type DataRestriction = 
  | "no-ai-training"
  | "no-commercial"
  | "no-redistribution"
  | "no-modification"
  | "geographic"
  | "time-limited"
  | "usage-limited";

export interface DataPricing {
  model: PricingModel;
  
  // Fixed or base price
  price?: number;
  currency: string; // USD, ETH, JOY, etc.
  
  // For pay-per-use
  pricePerUse?: number;
  pricePerByte?: number;
  pricePerInference?: number;
  
  // For subscriptions
  subscriptionPeriod?: "daily" | "weekly" | "monthly" | "yearly";
  
  // For auctions
  minimumBid?: number;
  auctionEnd?: string;
  
  // Revenue sharing
  royaltyPercent?: number; // For derivative works
  
  // Payment methods accepted
  acceptedPayments: PaymentMethod[];
}

export type PricingModel = 
  | "free"
  | "fixed"
  | "pay-per-use"
  | "pay-per-byte"
  | "pay-per-inference"
  | "subscription"
  | "auction"
  | "negotiate";

export type PaymentMethod = 
  | "joy-token"
  | "eth"
  | "usdc"
  | "btc"
  | "fiat-stripe"
  | "fiat-paypal"
  | "ar"           // Arweave token
  | "fil";         // Filecoin

// ============================================================================
// Local Inference & Computation
// ============================================================================

export interface LocalInference {
  id: string;
  
  // Model being used
  modelHash: string;
  modelNetwork: StorageNetwork;
  
  // Input data
  inputHash: string;
  inputType: string;
  
  // Output
  outputHash?: string;
  result?: unknown;
  
  // Verification
  proof?: ComputeProof;
  
  // Metrics
  startTime: string;
  endTime?: string;
  computeTime?: number; // ms
  memoryUsed?: number;  // bytes
  
  // Status
  status: "pending" | "running" | "completed" | "failed" | "verified";
  error?: string;
}

export interface ComputeProof {
  // Proof type
  type: "zk-snark" | "zk-stark" | "optimistic" | "tee" | "signature";
  
  // The proof data
  proof: string;
  
  // Public inputs used
  publicInputs: string[];
  
  // Verifier info
  verifier: {
    contract?: string;  // Smart contract for on-chain verification
    endpoint?: string;  // API endpoint for off-chain verification
  };
  
  // Verification status
  verified: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
}

// ============================================================================
// Data Marketplace
// ============================================================================

export interface DataListing {
  id: string;
  
  // The sovereign data being listed
  dataId: string;
  dataHash: string;
  
  // Listing details
  title: string;
  description: string;
  category: string;
  tags: string[];
  
  // Preview (unencrypted sample)
  previewHash?: string;
  thumbnailHash?: string;
  
  // Pricing & licensing
  pricing: DataPricing;
  license: DataLicense;
  
  // Seller info
  seller: {
    did: string;
    reputation?: number;
    salesCount?: number;
  };
  
  // Stats
  views: number;
  purchases: number;
  rating?: number;
  
  // Status
  status: "draft" | "active" | "sold" | "expired" | "removed";
  
  // Networks where listed
  listedOn: {
    network: string; // joy-marketplace, ocean-protocol, etc.
    listingId: string;
    url?: string;
  }[];
  
  createdAt: string;
  updatedAt: string;
}

export interface DataPurchase {
  id: string;
  listingId: string;
  dataHash: string;
  
  // Buyer info
  buyer: {
    did: string;
    publicKey: string;
  };
  
  // Payment
  amount: number;
  currency: string;
  transactionHash?: string;
  
  // Access key (encrypted with buyer's public key)
  encryptedAccessKey: string;
  
  // License granted
  license: DataLicense;
  
  // Status
  status: "pending" | "paid" | "delivered" | "disputed" | "refunded";
  
  // Timestamps
  purchasedAt: string;
  deliveredAt?: string;
}

// ============================================================================
// User Data Vault
// ============================================================================

export interface DataVault {
  // User's decentralized identity
  did: string;
  
  // Master public key (private key never leaves device)
  publicKey: string;
  
  // Key derivation paths for different data types
  keyPaths: {
    dataType: DataType;
    derivationPath: string;
  }[];
  
  // Local encrypted index of all data
  indexHash: string;
  
  // Storage configuration
  storageConfig: {
    network: StorageNetwork;
    enabled: boolean;
    autoSync: boolean;
    encryptionRequired: boolean;
  }[];
  
  // Default settings
  defaults: {
    visibility: DataVisibility;
    storageTier: StorageTier;
    replicationCount: number;
  };

  // Local policy settings
  policies?: {
    training: {
      requireConsent: boolean;
      requirePayment: boolean;
    };
    outbound: {
      requireConsent: boolean;
      requirePayment: boolean;
    };
  };
  
  // Stats
  stats: {
    totalItems: number;
    totalSize: number;
    totalRevenue: number;
    networkUsage: {
      network: StorageNetwork;
      itemCount: number;
      bytesStored: number;
      bytesTransferred: number;
    }[];
  };
}

// ============================================================================
// Offline-first Outbox
// ============================================================================

export type OutboxJobStatus = "queued" | "processing" | "completed" | "failed";

export type OutboxJobType = "sync" | "share";

export interface OutboxJob {
  id: string;
  type: OutboxJobType;
  dataId: string;
  network?: StorageNetwork;
  recipientPublicKey?: string;
  permissions?: string[];
  payload?: Record<string, unknown>;
  status: OutboxJobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyAuditEvent {
  id: string;
  dataId: string;
  policy: "training-consent" | "outbound-consent" | "outbound-payment";
  action: "sync" | "share" | "listing" | "export" | "outbox";
  message: string;
  createdAt: string;
}

// ============================================================================
// Personal Data Monetization
// ============================================================================

export interface PersonalDataOffer {
  id: string;
  
  // What data is being requested
  dataTypes: DataType[];
  
  // Who's requesting
  requester: {
    name: string;
    did: string;
    verified: boolean;
    reputation?: number;
  };
  
  // What they're offering
  offer: {
    type: "one-time" | "recurring" | "per-access";
    amount: number;
    currency: string;
    frequency?: string; // For recurring
  };
  
  // What they'll use it for
  purpose: string;
  usagePolicy: string;
  retentionPeriod?: string;
  
  // User's response
  status: "pending" | "accepted" | "rejected" | "negotiating";
  counterOffer?: {
    amount: number;
    restrictions?: string[];
  };
  
  createdAt: string;
  expiresAt?: string;
}

// ============================================================================
// Verification & Trust
// ============================================================================

export interface DataAttestation {
  id: string;
  dataHash: string;
  
  // What's being attested
  claim: {
    type: "ownership" | "authenticity" | "quality" | "provenance" | "compliance";
    statement: string;
  };
  
  // Who's attesting
  attester: {
    did: string;
    name?: string;
    type: "self" | "peer" | "authority" | "automated";
  };
  
  // The attestation
  signature: string;
  timestamp: string;
  
  // On-chain proof (optional)
  onChainProof?: {
    network: "ethereum" | "polygon" | "solana" | "joy-chain";
    transactionHash: string;
    blockNumber: number;
  };
  
  // Expiration
  expiresAt?: string;
  revoked: boolean;
}
