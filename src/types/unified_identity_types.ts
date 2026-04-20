/**
 * UNIFIED IDENTITY SYSTEM — One ID, Used Everywhere
 *
 * The fundamental problem: JoyCreate had 3+ separate identity systems
 * (ChatIdentity, DecentralizedIdentity, SSIIdentity) that didn't talk
 * to each other. This module creates a single Universal Identity that
 * works across P2P chat, Creator Network, marketplace, governance, 
 * payments, federation, AI agents, and every other subsystem.
 *
 * Architecture:
 *   ENS Name ←→ DID ←→ Wallet Address(es) ←→ Social Proofs
 *        ↕            ↕              ↕
 *   Chat System   Creator Network   Marketplace
 *   P2P Messages  Agent Registry    Token Economics
 *   Governance    Federation        Compute Network
 *
 * The ENS name (or JNS — Joy Name Service for .joy domains) is the
 * human-readable anchor. The DID is the cryptographic anchor. The
 * wallet addresses are the economic anchors. Everything else links in.
 *
 * "Create once, use everywhere."
 */

import type { DIDString, DIDDocument, VerificationMethod, ServiceEndpoint, VerifiableCredential, CelestiaAnchor } from "./ssi_types";

// ============================================================================
// CORE: UNIVERSAL IDENTITY
// ============================================================================

/**
 * The one true identity. Every system in JoyCreate resolves back to this.
 */
export interface UniversalIdentity {
  // ── Primary Identifiers ──
  /** The DID — cryptographic root of identity (did:joy:xxx, did:ethr:xxx, did:key:xxx) */
  did: DIDString;
  /** ENS name if registered (terry.eth, terry.joy, etc.) */
  ensName?: string;
  /** JNS name — Joy Name Service (.joy TLD on our namespace) */
  jnsName?: string;
  /** Primary human-readable name (ENS > JNS > displayName) */
  primaryName: string;

  // ── Display / Profile ──
  displayName: string;
  bio?: string;
  avatar?: string;                  // IPFS CID or URL
  coverImage?: string;              // IPFS CID or URL
  location?: string;
  website?: string;
  pronouns?: string;

  // ── Wallet Addresses (multi-chain) ──
  wallets: WalletBinding[];
  /** The primary wallet (first verified, or user-selected) */
  primaryWallet: WalletBinding;

  // ── Cryptographic Keys ──
  keys: IdentityKeySet;

  // ── DID Document (W3C compliant) ──
  didDocument: DIDDocument;

  // ── Linked Identities ──
  linkedDids?: DIDString[];
  socialProofs: SocialProof[];
  domainVerifications: DomainVerification[];

  // ── Capabilities / Roles ──
  capabilities: IdentityCapability[];
  roles: IdentityRole[];

  // ── Reputation (aggregated from all subsystems) ──
  reputation: UnifiedReputation;

  // ── Status ──
  status: PresenceStatus;
  lastSeen: string;
  verified: boolean;
  verificationLevel: VerificationLevel;

  // ── Metadata ──
  createdAt: string;
  updatedAt: string;
  version: number;

  // ── Celestia Anchoring ──
  celestiaAnchors?: CelestiaAnchor[];
  lastAnchoredAt?: string;
}

// ============================================================================
// WALLET BINDINGS (Multi-chain)
// ============================================================================

export type ChainType =
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "base"
  | "solana"
  | "cosmos"
  | "celestia"
  | "near"
  | "bitcoin"
  | "sui"
  | "aptos";

export interface WalletBinding {
  /** On-chain address */
  address: string;
  /** Which chain */
  chain: ChainType;
  /** Is this the primary wallet for this chain? */
  isPrimary: boolean;
  /** Signed message proving ownership: sign("I am <DID>") */
  ownershipProof: WalletOwnershipProof;
  /** ENS name resolved from this wallet (if any) */
  ensName?: string;
  /** Balance snapshot (optional, cached) */
  balanceSnapshot?: {
    native: string;
    tokens: { symbol: string; balance: string; contractAddress: string }[];
    nfts: number;
    updatedAt: string;
  };
  /** When this wallet was linked */
  linkedAt: string;
  /** Label (e.g., "Hot Wallet", "Hardware", "Treasury") */
  label?: string;
}

export interface WalletOwnershipProof {
  /** The message that was signed */
  message: string;
  /** The cryptographic signature */
  signature: string;
  /** Signing algorithm used */
  algorithm: "eip191" | "eip712" | "ed25519" | "nacl";
  /** Timestamp of the proof */
  signedAt: string;
  /** Chain ID (for EVM chains) */
  chainId?: number;
}

// ============================================================================
// CRYPTOGRAPHIC KEYS
// ============================================================================

export interface IdentityKeySet {
  /** Ed25519 signing key pair */
  signing: KeyPair;
  /** X25519 key agreement (encryption) */
  encryption: KeyPair;
  /** Recovery key (for DID rotation) */
  recovery?: KeyPair;
  /** Optional delegation keys (for agents acting on your behalf) */
  delegation?: DelegationKey[];
}

export interface KeyPair {
  /** Public key in multibase encoding */
  publicKeyMultibase: string;
  /** Key type */
  type: "Ed25519" | "X25519" | "secp256k1" | "P-256";
  /** Key ID (for DID document reference) */
  keyId: string;
  /** When this key was created */
  createdAt: string;
  /** When this key expires (null = never) */
  expiresAt?: string;
  /** Is this key currently active? */
  active: boolean;
}

export interface DelegationKey extends KeyPair {
  /** Who/what this key is delegated to */
  delegateDid: DIDString;
  /** What the delegate can do */
  delegatedCapabilities: IdentityCapability[];
  /** Scope restriction */
  scope: DelegationScope;
  /** Signed delegation certificate */
  delegationProof: string;
}

export type DelegationScope =
  | "full"                           // Full access (dangerous)
  | "chat"                           // Can send messages as you
  | "marketplace"                    // Can list/buy/sell
  | "governance"                     // Can vote on proposals
  | "compute"                        // Can submit compute jobs
  | "agent"                          // AI agent acting on behalf
  | "readonly";                      // Can read but not act

// ============================================================================
// SOCIAL PROOFS & VERIFICATION
// ============================================================================

export type SocialPlatform =
  | "twitter"
  | "github"
  | "discord"
  | "telegram"
  | "linkedin"
  | "reddit"
  | "mastodon"
  | "farcaster"
  | "lens"
  | "nostr"
  | "youtube"
  | "twitch"
  | "instagram"
  | "keybase";

export interface SocialProof {
  /** Which platform */
  platform: SocialPlatform;
  /** Handle/username on that platform */
  handle: string;
  /** URL to the proof post (e.g., tweet containing DID) */
  proofUrl?: string;
  /** Profile URL */
  profileUrl: string;
  /** Verification status */
  verified: boolean;
  /** When it was verified */
  verifiedAt?: string;
  /** Verifiable Credential for this proof */
  credential?: VerifiableCredential;
}

export interface DomainVerification {
  /** The domain (e.g., example.com) */
  domain: string;
  /** How it was verified */
  method: "dns-txt" | "well-known" | "meta-tag" | "ens-contenthash";
  /** Proof value */
  proofValue: string;
  /** Is it still valid? */
  valid: boolean;
  /** When verified */
  verifiedAt: string;
  /** When last checked */
  lastCheckedAt: string;
}

export type VerificationLevel =
  | "none"                           // No verification
  | "wallet"                         // Wallet ownership proven
  | "social"                         // 1+ social proof verified
  | "domain"                         // Domain verified
  | "kyc-basic"                      // Basic KYC (email + phone)
  | "kyc-full"                       // Full KYC (government ID)
  | "institutional";                 // Institutional verification

// ============================================================================
// CAPABILITIES & ROLES
// ============================================================================

export type IdentityCapability =
  // Chat
  | "chat:send"
  | "chat:create-group"
  | "chat:create-channel"
  | "chat:moderate"
  | "chat:admin"
  // Creator Network
  | "creator:publish"
  | "creator:sell"
  | "creator:license"
  | "creator:curate"
  // Marketplace
  | "marketplace:list"
  | "marketplace:buy"
  | "marketplace:sell"
  | "marketplace:arbitrate"
  // Compute
  | "compute:provide"
  | "compute:consume"
  | "compute:validate"
  // Governance
  | "governance:propose"
  | "governance:vote"
  | "governance:delegate"
  | "governance:council"
  // Agent
  | "agent:create"
  | "agent:deploy"
  | "agent:manage"
  | "agent:interact"
  // Federation
  | "federation:relay"
  | "federation:gateway"
  | "federation:validate"
  // Admin
  | "admin:platform"
  | "admin:moderation"
  | "admin:treasury";

export type IdentityRole =
  | "user"
  | "creator"
  | "developer"
  | "moderator"
  | "curator"
  | "validator"
  | "compute-provider"
  | "marketplace-operator"
  | "governance-council"
  | "federation-node"
  | "agent"                          // AI agent identity
  | "bot"                            // Bot identity
  | "admin";

// ============================================================================
// PRESENCE
// ============================================================================

export type PresenceStatus = "online" | "away" | "busy" | "dnd" | "invisible" | "offline";

export interface PresenceInfo {
  status: PresenceStatus;
  customMessage?: string;
  emoji?: string;
  /** What are they doing right now? */
  activity?: PresenceActivity;
  /** Per-platform online status */
  platforms: PlatformPresence[];
  /** Auto-away timeout in minutes */
  autoAwayMinutes?: number;
  lastSeen: string;
}

export interface PresenceActivity {
  type: "chatting" | "building" | "browsing" | "training" | "computing" | "gaming" | "listening" | "watching" | "custom";
  label?: string;
  /** Reference to what they're doing (app ID, model ID, etc.) */
  referenceId?: string;
  startedAt: string;
}

export interface PlatformPresence {
  platform: "web" | "desktop" | "mobile" | "api" | "agent";
  online: boolean;
  lastSeen: string;
  userAgent?: string;
}

// ============================================================================
// UNIFIED REPUTATION
// ============================================================================

/**
 * Aggregated reputation across all JoyCreate subsystems.
 * Each subsystem contributes a component score.
 */
export interface UnifiedReputation {
  /** Overall score (0-1000) — weighted average of components */
  overallScore: number;
  /** Trust level derived from score */
  trustLevel: TrustLevel;
  /** Total transactions across all subsystems */
  totalTransactions: number;

  // ── Component Scores ──
  components: ReputationComponent[];

  // ── Badges (earned across subsystems) ──
  badges: ReputationBadge[];

  // ── History ──
  history: ReputationEvent[];

  /** Staked amount (if applicable — skin in the game) */
  stakedAmount?: { token: string; amount: string };

  /** Verifiable Credential for reputation (Celestia-anchored) */
  credential?: VerifiableCredential;

  updatedAt: string;
}

export type TrustLevel =
  | "newcomer"           // 0-99
  | "contributor"        // 100-299
  | "trusted"            // 300-499
  | "established"        // 500-699
  | "expert"             // 700-849
  | "legendary";         // 850-1000

export interface ReputationComponent {
  subsystem: ReputationSubsystem;
  score: number;                     // 0-1000
  weight: number;                    // 0-1 (how much this counts toward overall)
  transactionCount: number;
  successRate: number;               // 0-1
  lastActivityAt?: string;
}

export type ReputationSubsystem =
  | "marketplace"                    // Buying/selling assets
  | "chat"                           // Chat behavior (reports, moderation)
  | "governance"                     // Proposal quality, vote participation
  | "compute"                        // Compute reliability, uptime
  | "creator"                        // Content quality, sales, reviews
  | "agent"                          // Agent reliability, safety
  | "federation"                     // Node uptime, relay quality
  | "community";                     // Community contributions

export interface ReputationBadge {
  id: string;
  name: string;
  description: string;
  icon: string;                      // Emoji or IPFS CID
  subsystem: ReputationSubsystem;
  earnedAt: string;
  /** NFT token ID if minted as achievement NFT */
  nftTokenId?: string;
}

export interface ReputationEvent {
  type: "earned" | "lost" | "badge-awarded" | "level-up" | "level-down" | "dispute" | "review";
  amount: number;                    // Positive or negative
  subsystem: ReputationSubsystem;
  reason: string;
  timestamp: string;
  referenceId?: string;              // Transaction/proposal/review ID
}

// ============================================================================
// ENS / JNS NAME SERVICE
// ============================================================================

/**
 * ENS (Ethereum Name Service) integration for human-readable names.
 * Also supports JNS (.joy TLD) for the JoyCreate ecosystem.
 */
export interface NameServiceRecord {
  /** The name (e.g., terry.eth, terry.joy) */
  name: string;
  /** Name service type */
  service: NameServiceType;
  /** Resolved address */
  resolvedAddress: string;
  /** Chain where it lives */
  chain: ChainType;
  /** Owner address */
  owner: string;
  /** Resolver contract address */
  resolverAddress: string;

  // ── ENS Text Records ──
  textRecords: ENSTextRecords;

  // ── Content Hash (IPFS/Swarm/Arweave) ──
  contentHash?: {
    codec: "ipfs" | "ipns" | "swarm" | "arweave" | "onion" | "skynet";
    hash: string;
    url: string;
  };

  // ── Reverse Resolution ──
  /** Does this address have reverse resolution set? */
  hasReverseRecord: boolean;

  // ── Metadata ──
  registeredAt?: string;
  expiresAt?: string;
  lastUpdatedAt: string;
  /** Is the registration still valid? */
  valid: boolean;
}

export type NameServiceType = "ens" | "jns" | "unstoppable" | "sns" | "bonfida" | "space-id";

/**
 * ENS Text Records — store identity metadata on-chain.
 * These are the standard ENS text record keys plus JoyCreate extensions.
 */
export interface ENSTextRecords {
  // ── Standard ENS Records ──
  /** Display name */
  name?: string;
  /** Description / Bio */
  description?: string;
  /** Avatar URL (supports eip155 NFT URIs) */
  avatar?: string;
  /** Header/banner image */
  header?: string;
  /** Email */
  email?: string;
  /** Website URL */
  url?: string;
  /** Location */
  location?: string;

  // ── Social Records (ENS standard) ──
  "com.twitter"?: string;
  "com.github"?: string;
  "com.discord"?: string;
  "org.telegram"?: string;
  "io.keybase"?: string;
  "xyz.farcaster"?: string;
  "xyz.lens"?: string;

  // ── JoyCreate Extension Records ──
  /** DID for this identity */
  "ai.joycreate.did"?: string;
  /** JNS name */
  "ai.joycreate.jns"?: string;
  /** IPFS CID of the full UniversalIdentity profile */
  "ai.joycreate.profile"?: string;
  /** Creator Network store ID */
  "ai.joycreate.store"?: string;
  /** Agent registry entry */
  "ai.joycreate.agents"?: string;
  /** Compute node endpoint */
  "ai.joycreate.compute"?: string;
  /** P2P chat public key */
  "ai.joycreate.chat.pubkey"?: string;
  /** Governance delegation address */
  "ai.joycreate.delegate"?: string;
  /** IPLD receipt CID for identity anchoring */
  "ai.joycreate.receipt"?: string;

  // ── Catch-all for additional records ──
  [key: string]: string | undefined;
}

// ============================================================================
// JOY NAME SERVICE (.joy TLD)
// ============================================================================

/**
 * JNS — Joy Name Service
 * Our own name service for the .joy TLD, running on the same contract
 * pattern as ENS but on Polygon/Base for cheap registrations.
 */
export interface JNSRegistration {
  /** The .joy name (e.g., terry.joy) */
  name: string;
  /** Registered to this DID */
  ownerDid: DIDString;
  /** Registered to this wallet */
  ownerAddress: string;
  /** Chain where JNS contract lives */
  chain: ChainType;
  /** JNS contract address */
  contractAddress: string;
  /** Token ID in the JNS NFT contract */
  tokenId: string;

  // ── Resolution ──
  resolvedDid: DIDString;
  resolvedAddresses: { chain: ChainType; address: string }[];
  textRecords: ENSTextRecords;
  contentHash?: string;

  // ── Subnames ──
  subnames?: JNSSubname[];

  // ── Pricing / Registration ──
  registrationPrice: { amount: string; token: string };
  renewalPrice: { amount: string; token: string };
  registeredAt: string;
  expiresAt: string;
  autoRenew: boolean;

  /** Is this a premium name? */
  premium: boolean;
  /** Transfer locked until */
  transferLockUntil?: string;
}

export interface JNSSubname {
  /** Full name (e.g., agent.terry.joy) */
  name: string;
  /** What this subname is for */
  purpose: "agent" | "store" | "app" | "project" | "team" | "custom";
  /** Resolved DID */
  resolvedDid?: DIDString;
  /** Resolved address */
  resolvedAddress?: string;
  createdAt: string;
}

// ============================================================================
// IDENTITY RESOLUTION — How to find someone
// ============================================================================

/**
 * When you search for someone, you might use any of these identifiers.
 * The resolution system finds the UniversalIdentity from any entry point.
 */
export type IdentityQuery =
  | { type: "did"; value: DIDString }
  | { type: "ens"; value: string }
  | { type: "jns"; value: string }
  | { type: "wallet"; value: string; chain?: ChainType }
  | { type: "social"; platform: SocialPlatform; handle: string }
  | { type: "domain"; value: string }
  | { type: "publicKey"; value: string }
  | { type: "displayName"; value: string };

export interface IdentityResolutionResult {
  found: boolean;
  identity?: UniversalIdentity;
  /** Which identifier matched */
  matchedOn: IdentityQuery["type"];
  /** Confidence of the match (1.0 = exact, <1.0 = fuzzy) */
  confidence: number;
  /** If multiple identities matched a fuzzy search */
  alternatives?: UniversalIdentity[];
  /** Resolution time in ms */
  resolvedInMs: number;
}

// ============================================================================
// IDENTITY CREATION / UPDATE
// ============================================================================

export interface CreateIdentityParams {
  /** Display name (required) */
  displayName: string;
  /** Bio */
  bio?: string;
  /** Avatar (file or IPFS CID) */
  avatar?: string;
  /** Cover image */
  coverImage?: string;
  /** Wallet to bind (will need signature) */
  walletAddress: string;
  /** Chain of the wallet */
  chain: ChainType;
  /** ENS name (if already owned, will be linked) */
  ensName?: string;
  /** Register a .joy name? */
  registerJns?: string;
  /** Key algorithm preference */
  keyAlgorithm?: "ed25519" | "secp256k1";
  /** Initial social links */
  socialLinks?: { platform: SocialPlatform; handle: string }[];
}

export interface UpdateIdentityParams {
  did: DIDString;
  displayName?: string;
  bio?: string;
  avatar?: string;
  coverImage?: string;
  location?: string;
  website?: string;
  pronouns?: string;
  /** Update ENS text records? */
  ensTextRecords?: Partial<ENSTextRecords>;
  /** Presence settings */
  presence?: Partial<PresenceInfo>;
}

export interface LinkWalletParams {
  did: DIDString;
  walletAddress: string;
  chain: ChainType;
  label?: string;
  makePrimary?: boolean;
  /** Will need wallet signature */
}

export interface LinkSocialParams {
  did: DIDString;
  platform: SocialPlatform;
  handle: string;
  proofUrl?: string;
}

export interface LinkENSParams {
  did: DIDString;
  ensName: string;
  /** Set JoyCreate text records on the ENS name? */
  setTextRecords?: boolean;
  /** Set as primary name? */
  setPrimaryName?: boolean;
}

export interface RegisterJNSParams {
  did: DIDString;
  name: string;                      // Without .joy suffix
  /** Duration in years */
  durationYears: number;
  /** Set as primary name? */
  setPrimaryName?: boolean;
  /** Auto-renew? */
  autoRenew?: boolean;
}

// ============================================================================
// IDENTITY EVENTS (for audit trail & Celestia anchoring)
// ============================================================================

export type IdentityEventType =
  | "identity:created"
  | "identity:updated"
  | "identity:deactivated"
  | "wallet:linked"
  | "wallet:unlinked"
  | "wallet:primary-changed"
  | "social:linked"
  | "social:verified"
  | "social:unlinked"
  | "domain:verified"
  | "domain:expired"
  | "ens:linked"
  | "ens:text-records-updated"
  | "jns:registered"
  | "jns:renewed"
  | "jns:transferred"
  | "jns:subname-created"
  | "key:rotated"
  | "key:delegation-granted"
  | "key:delegation-revoked"
  | "reputation:updated"
  | "reputation:badge-earned"
  | "reputation:level-changed"
  | "verification:level-changed"
  | "capability:granted"
  | "capability:revoked"
  | "role:assigned"
  | "role:removed"
  | "identity:anchored";

export interface IdentityEvent {
  id: string;
  type: IdentityEventType;
  did: DIDString;
  timestamp: string;
  description: string;
  /** Snapshot of what changed */
  changes?: Record<string, { before: unknown; after: unknown }>;
  /** Data hash for integrity */
  dataHash: string;
  /** Celestia anchor (if anchored) */
  celestiaAnchor?: CelestiaAnchor;
  /** Who/what triggered this event */
  triggeredBy: DIDString | "system";
  metadata?: Record<string, unknown>;
}

// ============================================================================
// IDENTITY DIRECTORY / SEARCH
// ============================================================================

export interface IdentitySearchParams {
  /** Free-text query (searches name, bio, ENS, JNS, social handles) */
  query?: string;
  /** Filter by roles */
  roles?: IdentityRole[];
  /** Filter by capabilities */
  capabilities?: IdentityCapability[];
  /** Filter by verification level */
  minVerificationLevel?: VerificationLevel;
  /** Filter by minimum reputation score */
  minReputation?: number;
  /** Filter by trust level */
  minTrustLevel?: TrustLevel;
  /** Filter by chain presence */
  chains?: ChainType[];
  /** Filter by social platform presence */
  socialPlatforms?: SocialPlatform[];
  /** Online only */
  onlineOnly?: boolean;
  /** Has ENS name */
  hasEns?: boolean;
  /** Has JNS name */
  hasJns?: boolean;
  /** Pagination */
  limit?: number;
  offset?: number;
  /** Sort */
  sortBy?: "reputation" | "name" | "lastSeen" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface IdentitySearchResult {
  identities: UniversalIdentity[];
  total: number;
  limit: number;
  offset: number;
  query?: string;
}

// ============================================================================
// AGENT IDENTITY (AI agents as first-class citizens)
// ============================================================================

/**
 * AI Agents get their own UniversalIdentity with agent-specific metadata.
 * This lets agents participate in chat, marketplace, governance — everything.
 */
export interface AgentIdentity extends UniversalIdentity {
  /** Always "agent" or "bot" in roles */
  agentType: AgentType;
  /** Who created/owns this agent */
  ownerDid: DIDString;
  /** What model powers this agent */
  modelId?: string;
  /** Agent capabilities/skills */
  agentCapabilities: string[];
  /** Is this agent autonomous or human-supervised? */
  autonomyLevel: AutonomyLevel;
  /** Rate limiting */
  rateLimits: {
    messagesPerMinute: number;
    actionsPerHour: number;
    transactionsPerDay: number;
  };
  /** JoyCreate Agent ID (if linked) */
  joyCreateAgentId?: number;
  /** Marketplace listing ID (if published) */
  marketplaceListingId?: string;
  /** Delegation from owner */
  delegationScope: DelegationScope;
  /** Agent safety rating */
  safetyRating?: {
    score: number;
    reviewedAt: string;
    reviewedBy: DIDString;
    flags: string[];
  };
}

export type AgentType =
  | "chatbot"
  | "task-agent"
  | "multi-agent"
  | "workflow-agent"
  | "rag-agent"
  | "autonomous-agent"
  | "community-bot"
  | "moderation-bot"
  | "utility-bot";

export type AutonomyLevel =
  | "supervised"                     // Human approves all actions
  | "semi-autonomous"               // Human approves high-risk actions
  | "autonomous"                    // Fully autonomous within rate limits
  | "restricted";                   // Severely limited, read-mostly

// ============================================================================
// CROSS-SUBSYSTEM IDENTITY ADAPTERS
// ============================================================================

/**
 * These adapter interfaces show how the UniversalIdentity maps to each
 * subsystem's view of identity. The idea: each subsystem only sees what
 * it needs, but it all comes from one source of truth.
 */

/** What the P2P Chat system sees */
export interface ChatIdentityView {
  did: DIDString;
  displayName: string;
  avatar?: string;
  publicKey: string;                 // From keys.encryption.publicKeyMultibase
  signingKey: string;                // From keys.signing.publicKeyMultibase
  walletAddress: string;             // From primaryWallet.address
  ensName?: string;
  jnsName?: string;
  status: PresenceStatus;
  lastSeen: string;
  verified: boolean;
  verificationLevel: VerificationLevel;
  reputation: number;                // From reputation.overallScore
  roles: IdentityRole[];
  badges: ReputationBadge[];
}

/** What the Creator Network sees */
export interface CreatorIdentityView {
  did: DIDString;
  displayName: string;
  ensName?: string;
  jnsName?: string;
  avatar?: string;
  bio?: string;
  website?: string;
  wallets: WalletBinding[];
  socialProofs: SocialProof[];
  reputation: UnifiedReputation;
  capabilities: IdentityCapability[];
  /** Creator-specific stats */
  creatorStats?: {
    totalAssets: number;
    totalSales: number;
    totalRevenue: string;
    averageRating: number;
    followers: number;
  };
}

/** What the Marketplace sees */
export interface MarketplaceIdentityView {
  did: DIDString;
  displayName: string;
  ensName?: string;
  primaryWallet: WalletBinding;
  verified: boolean;
  verificationLevel: VerificationLevel;
  reputation: UnifiedReputation;
  capabilities: IdentityCapability[];
  /** Can this identity buy? */
  canBuy: boolean;
  /** Can this identity sell? */
  canSell: boolean;
  /** Can this identity arbitrate disputes? */
  canArbitrate: boolean;
}

/** What the Governance system sees */
export interface GovernanceIdentityView {
  did: DIDString;
  displayName: string;
  ensName?: string;
  wallets: WalletBinding[];
  reputation: UnifiedReputation;
  /** Voting power (from staked tokens + reputation + delegation) */
  votingPower: string;
  /** Who delegated to this identity */
  delegatedFrom?: DIDString[];
  /** Who this identity delegates to */
  delegatedTo?: DIDString;
  capabilities: IdentityCapability[];
  /** Is on governance council? */
  isCouncil: boolean;
}

/** What the Compute Network sees */
export interface ComputeIdentityView {
  did: DIDString;
  displayName: string;
  wallets: WalletBinding[];
  reputation: UnifiedReputation;
  capabilities: IdentityCapability[];
  /** Is this a compute provider? */
  isProvider: boolean;
  /** Provider details */
  providerInfo?: {
    endpoint: string;
    supportedModels: string[];
    gpuSpecs: string[];
    uptime: number;
    latencyMs: number;
  };
}

/** What the Federation system sees */
export interface FederationIdentityView {
  did: DIDString;
  displayName: string;
  publicKey: string;
  capabilities: IdentityCapability[];
  /** Peer addresses */
  peerAddresses: string[];
  /** Supported protocols */
  protocols: string[];
  /** Is this a relay/gateway node? */
  isRelay: boolean;
  isGateway: boolean;
}

// ============================================================================
// IDENTITY PROVIDER / RESOLVER INTERFACE
// ============================================================================

/**
 * The abstract interface that the identity resolver implements.
 * Any subsystem can use this to look up, create, or update identities.
 */
export interface IUniversalIdentityProvider {
  // ── Resolution ──
  resolve(query: IdentityQuery): Promise<IdentityResolutionResult>;
  resolveMany(queries: IdentityQuery[]): Promise<IdentityResolutionResult[]>;

  // ── CRUD ──
  create(params: CreateIdentityParams): Promise<UniversalIdentity>;
  update(params: UpdateIdentityParams): Promise<UniversalIdentity>;
  deactivate(did: DIDString): Promise<void>;

  // ── Wallet Management ──
  linkWallet(params: LinkWalletParams): Promise<WalletBinding>;
  unlinkWallet(did: DIDString, address: string, chain: ChainType): Promise<void>;
  setPrimaryWallet(did: DIDString, address: string, chain: ChainType): Promise<void>;

  // ── Name Services ──
  linkENS(params: LinkENSParams): Promise<NameServiceRecord>;
  registerJNS(params: RegisterJNSParams): Promise<JNSRegistration>;
  resolveENS(name: string): Promise<NameServiceRecord | null>;
  resolveJNS(name: string): Promise<JNSRegistration | null>;

  // ── Social ──
  linkSocial(params: LinkSocialParams): Promise<SocialProof>;
  verifySocial(did: DIDString, platform: SocialPlatform): Promise<SocialProof>;
  unlinkSocial(did: DIDString, platform: SocialPlatform): Promise<void>;

  // ── Verification ──
  verifyDomain(did: DIDString, domain: string): Promise<DomainVerification>;
  getVerificationLevel(did: DIDString): Promise<VerificationLevel>;

  // ── Keys ──
  rotateKeys(did: DIDString, newKeyAlgorithm?: "ed25519" | "secp256k1"): Promise<IdentityKeySet>;
  grantDelegation(ownerDid: DIDString, delegateDid: DIDString, scope: DelegationScope, capabilities: IdentityCapability[]): Promise<DelegationKey>;
  revokeDelegation(ownerDid: DIDString, delegateDid: DIDString): Promise<void>;

  // ── Reputation ──
  getReputation(did: DIDString): Promise<UnifiedReputation>;
  recordReputationEvent(event: Omit<ReputationEvent, "timestamp">): Promise<void>;

  // ── Presence ──
  updatePresence(did: DIDString, presence: Partial<PresenceInfo>): Promise<void>;
  getPresence(did: DIDString): Promise<PresenceInfo>;

  // ── Directory / Search ──
  search(params: IdentitySearchParams): Promise<IdentitySearchResult>;

  // ── Subsystem Views ──
  getChatView(did: DIDString): Promise<ChatIdentityView>;
  getCreatorView(did: DIDString): Promise<CreatorIdentityView>;
  getMarketplaceView(did: DIDString): Promise<MarketplaceIdentityView>;
  getGovernanceView(did: DIDString): Promise<GovernanceIdentityView>;
  getComputeView(did: DIDString): Promise<ComputeIdentityView>;
  getFederationView(did: DIDString): Promise<FederationIdentityView>;

  // ── Agent Identity ──
  createAgentIdentity(params: CreateIdentityParams & { agentType: AgentType; ownerDid: DIDString }): Promise<AgentIdentity>;
  getAgentIdentity(did: DIDString): Promise<AgentIdentity | null>;

  // ── Events ──
  getEvents(did: DIDString, limit?: number, offset?: number): Promise<IdentityEvent[]>;

  // ── Anchoring ──
  anchorToCelestia(did: DIDString): Promise<CelestiaAnchor>;
  verifyAnchor(did: DIDString, anchorHeight: number): Promise<boolean>;
}

// ============================================================================
// IDENTITY MIGRATION HELPERS
// ============================================================================

/**
 * Helpers for migrating from the old separate identity systems to the
 * unified one. These map old types → UniversalIdentity.
 */

export interface MigrationFromChatIdentity {
  /** Old ChatIdentity fields */
  walletAddress: string;
  did: string;
  publicKey: string;
  signingKey: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  status: string;
}

export interface MigrationFromFederationIdentity {
  /** Old DecentralizedIdentity fields */
  did: string;
  public_key: string;
  display_name: string;
  avatar_cid?: string;
  bio?: string;
  capabilities: string[];
}

export interface MigrationFromSSIIdentity {
  /** Old SSIIdentity fields */
  did: DIDString;
  displayName?: string;
  bio?: string;
  avatar?: string;
  didDocument: DIDDocument;
  linkedDids?: DIDString[];
}

export interface IdentityMigrationResult {
  success: boolean;
  universalIdentity?: UniversalIdentity;
  migratedFrom: ("chat" | "federation" | "ssi")[];
  warnings: string[];
  errors: string[];
}
