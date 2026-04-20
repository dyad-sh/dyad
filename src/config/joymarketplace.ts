/**
 * JoyMarketplace.io Integration Configuration
 * Connects local JoyCreate app to the online JoyMarketplace system
 *
 * Architecture: fire-and-forget
 *   1. Verify API key via Supabase edge function (joy-create-verify)
 *   2. Pin to IPFS (Pinata / Helia)
 *   3. Lazy-mint DropERC1155 on Polygon Amoy
 *   4. List on MarketplaceV3
 *   5. Goldsky subgraphs index → marketplace UI picks up
 */

// =============================================================================
// NETWORK & CHAIN CONFIGURATION
// =============================================================================

export const POLYGON_MAINNET = {
  chainId: 137,
  chainIdHex: "0x89",
  name: "Polygon Mainnet",
  rpcUrl: "https://polygon-rpc.com",
  blockExplorer: "https://polygonscan.com",
  nativeCurrency: {
    name: "MATIC",
    symbol: "MATIC",
    decimals: 18,
  },
};

export const POLYGON_AMOY = {
  chainId: 80002,
  chainIdHex: "0x13882",
  name: "Polygon Amoy Testnet",
  rpcUrl: "https://rpc-amoy.polygon.technology",
  blockExplorer: "https://amoy.polygonscan.com",
  nativeCurrency: {
    name: "MATIC",
    symbol: "MATIC",
    decimals: 18,
  },
};

// =============================================================================
// CONTRACT ADDRESSES (Polygon Mainnet - Chain ID 137)
// =============================================================================

export const CONTRACT_ADDRESSES = {
  // Core NFT Contract for AI Assets
  JOY_ASSET_NFT: "0xA8566De9dA7bC1dD9D9595F56CFe34De7EaeF2CC",
  
  // Domain Registry for .joy domains
  JOY_DOMAIN_REGISTRY: "0x2A0Fd0c6f9Cff0034626C3bfcb1E7884aDb74680",
  
  // Marketplace Core Contract
  ENHANCED_MODEL_MARKETPLACE: "0x8408Aeefb2557aaDe48d50E5b1B3b8A0C6275542",
  
  // Token Contracts
  JOY_TOKEN_V3: "0xa3224811e8E765c3aB1314Ee7B6291E171aA2a43",
  
  // USDC on Polygon (Official)
  USDC_POLYGON: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC
  USDC_BRIDGED: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e (bridged)
  
  // AI Model NFT Contract
  AI_MODEL_NFT: "0xBE770612B0bAabF1df1d02d981A5891b583A7766",
  
  // Helia/IPFS Integration Contracts
  HELIA_INFERENCE_REGISTRY: "0x7612a149b93d3f202139Fc13d1C59d554d31376F",
  HELIA_PINNING_SERVICE: "0xe0B1787D3b72Cde79d1A6D9c559f5e2B819eeb58",
  HELIA_INTEGRATION: "0xC0F0AcF0F8f9Bb646d7E94bC1f592B4aCf93a0cD",
  JOY_PINNING_DAO: "0x97fB720E52b672000419c75952BBd820af72695b",
  
  // Licensing & Agreements
  AI_SERVICE_AGREEMENTS: "0x6c70aDEE34381AD26Da143a1918f57154451fdA2",
  AI_TRAINING_DATA_LICENSING: "0x8D6C2CC5C0399deE68de237fE9faE9a24ebF1BD8",
  
  // Governance
  LIQUID_DEMOCRACY: "0x1d0Dc4E05AbC328dEa803FCDbA48f2095740fdc4",
  
  // NFT-Gated Inference Access Control
  INFERENCE_ACCESS_NFT: "0xE4A7d4b22c5f6c3D9a8F0b1C2d3E4F5a6B7c8D9e",
  INFERENCE_LICENSE_REGISTRY: "0x1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A",
  DATA_ENCRYPTION_ESCROW: "0x2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C",
  AGENT_PERMISSION_MANAGER: "0x3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D",
  USAGE_METERING: "0x4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E",
  REVENUE_SPLITTER: "0x5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F",
};

// =============================================================================
// ENS / IDENTITY CONTRACTS (Polygon Amoy – Chain ID 80002)
// =============================================================================

export const AMOY_ENS_CONTRACTS = {
  /** ENS core registry — maps namehash → owner/resolver/ttl */
  ENSRegistry: "0xc3a9e8066d1503d844bcf3b3be22ff4447256880" as const,
  /** ERC-721 registrar — owns .joy 2LD tokens, handles expiry */
  BaseRegistrar: "0x21df5f005531f028dbb39db59c69d3c5092c9aa7" as const,
  /** CCIP-read resolver — stores creator text records */
  JoyResolver: "0x38019fbf352f6027653eb63d1fe8c9e54b8e4a50" as const,
  /** Public registration controller — name + duration + resolver data */
  JoyRegistrarController: "0x40ccae3dbb263369b482588467116bed446eac7a" as const,
  /** Gates platform mints: requires caller to own a .joy name */
  JoyCreatorGate: "0x3af616adedf31cb2d959ece10aa4fed185853a40" as const,
  /** ERC-1155 platform drop — lazy-minted tokens listed on MarketplaceV3 */
  platformDrop: "0x541DbAc03B10352890E33A39b1107B0161474402" as const,
  /** Verida DID ↔ wallet linkage SBT */
  VeridaDIDLinkage: "0x2EF94B74319863c8Baf14A4FC75E640421DAD81A" as const,
} as const;

/** Duration constants for ENS registration (seconds) */
export const ENS_DURATION = {
  ONE_YEAR: 31_536_000,
  TWO_YEARS: 63_072_000,
  FIVE_YEARS: 157_680_000,
} as const;

/** Canonical text-record keys written to JoyResolver */
export const JOY_TEXT_RECORD_KEYS = {
  storeId: "joy.storeId",
  storeName: "joy.storeName",
  storeDescription: "joy.storeDescription",
  storeLogo: "joy.storeLogo",
  tagline: "joy.tagline",
  name: "name",
  description: "description",
  avatar: "avatar",
  url: "url",
} as const;

// =============================================================================
// API CONFIGURATION
// =============================================================================

export const JOYMARKETPLACE_API = {
  // Base URLs
  baseUrl: process.env.JOYMARKETPLACE_API_URL || "https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1",
  webUrl: process.env.JOYMARKETPLACE_WEB_URL || "https://joymarketplace.io",
  
  // Supabase backend
  supabaseUrl: process.env.JOYMARKETPLACE_SUPABASE_URL || "https://jgsbmnzhvuwiujqbaieo.supabase.co",
  supabaseAnonKey: process.env.JOYMARKETPLACE_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnc2JtbnpodnV3aXVqcWJhaWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2MDAxNTEsImV4cCI6MjA1NjE3NjE1MX0.jGGW8mTgX7jXcWiylbxmjOwCIGdl226LRauVMXiWtc4",
  
  // API Endpoints (Supabase Edge Functions)
  endpoints: {
    // The only backend endpoint — verifies the JOY_API_KEY and returns
    // { ok, user_id, scopes, network } including Goldsky subgraph URLs.
    verify: "/joy-create-verify",
    
    // Listing sync (optional — JoyCreate can also go direct to contracts)
    syncListing: "/joycreate-sync-listing",
    
    // Receipts — ingest IPLD inference receipts
    ingestReceipt: "/joycreate-receipt-ingest",
  },
  
  // Auth scheme
  authScheme: "Bearer", // Authorization: Bearer <JOY_API_KEY>
};

// =============================================================================
// PINNING CONFIGURATION (4everland)
// =============================================================================

export const PINNING_CONFIG = {
  // 4everland IPFS Pinning
  foureverland: {
    apiUrl: "https://api.4everland.dev",
    pinningEndpoint: "/bucket/pin",
    gateway: "https://4everland.io/ipfs",
    // API key should be stored in environment or settings
    apiKeyEnvVar: "FOUREVERLAND_API_KEY",
    projectId: process.env.FOUREVERLAND_PROJECT_ID || "",
  },
  
  // Pinata as backup
  pinata: {
    apiUrl: "https://api.pinata.cloud",
    gateway: "https://gateway.pinata.cloud/ipfs",
    apiKeyEnvVar: "PINATA_API_KEY",
    secretKeyEnvVar: "PINATA_SECRET_KEY",
  },
  
  // Helia local pinning (for self-hosted nodes)
  helia: {
    localNode: "http://localhost:5001",
    swarmConnect: [
      "/dns4/joymarketplace.io/tcp/4001/p2p/QmYourPeerId",
    ],
  },
};

// =============================================================================
// PAYOUT VERIFICATION (USDC on Polygon)
// =============================================================================

export const PAYOUT_CONFIG = {
  // USDC Contract on Polygon
  usdcContract: CONTRACT_ADDRESSES.USDC_POLYGON,
  usdcBridged: CONTRACT_ADDRESSES.USDC_BRIDGED,
  
  // Confirmation requirements
  confirmations: 12, // Standard for Polygon
  
  // Transaction tagging/memo
  memoPrefix: "JOY-PAYOUT-",
  
  // Minimum payout threshold (in USDC, 6 decimals)
  minimumPayout: 10_000000, // $10 USDC
  
  // Payout wallet verification
  verifyWalletOwnership: true,
  
  // Fee structure
  platformFee: 0.025, // 2.5%
  creatorShare: 0.975, // 97.5%
};

// =============================================================================
// FIELD MAPPING (On-chain → Marketplace)
// =============================================================================

export const FIELD_MAPPING = {
  // Domain → Store mapping
  domain: {
    name: "storeName", // domain.joy → store name
    owner: "creatorWallet", // domain owner address
    metadata: {
      logo: "storeLogo",
      bio: "storeDescription",
      banner: "storeBanner",
    },
  },
  
  // NFT → Asset mapping
  nft: {
    tokenId: "assetId",
    tokenURI: "metadataUri",
    owner: "creatorId",
    properties: {
      name: "assetName",
      description: "assetDescription",
      image: "thumbnailUrl",
      category: "category",
      price: "price",
      license: "licenseType",
    },
  },
  
  // Receipt → Transaction mapping
  receipt: {
    issuer: "sellerId",
    payer: "buyerId",
    "model.id": "assetId",
    "payment.tx": "transactionHash",
    "payment.amount": "amount",
    "store.name": "storeName",
    "store.creatorId": "creatorId",
  },
};

// =============================================================================
// CONTRACT ABIs (Essential Functions)
// =============================================================================

export const CONTRACT_ABIS = {
  // Domain Registry ABI (read functions)
  JOY_DOMAIN_REGISTRY: [
    "function admin() view returns (address)",
    "function baseRegistrationFee() view returns (uint256)",
    "function renewalFeePerYear() view returns (uint256)",
    "function isAvailable(string domain) view returns (bool)",
    "function getOwner(string domain) view returns (address)",
    "function getDomainInfo(string domain) view returns (address owner, uint256 expiresAt, uint256 pouScore, bool isActive, uint256 salePrice, bool isForSale)",
    "function calculateRegistrationFee(string domain) view returns (uint256)",
    "function getOwnerDomains(address owner) view returns (string[])",
    "function getBalance() view returns (uint256)",
    // Write functions
    "function register(string domain, address owner) payable",
    "function registerDomain(string domain, uint256 duration) payable",
    "function transferDomain(string domain, address newOwner)",
    "function renewDomain(string domain, uint256 duration) payable",
    "function setMetadataUri(string domain, string metadataUri)",
    // Events
    "event DomainRegistered(string indexed domain, address indexed owner, uint256 expiresAt)",
    "event DomainTransferred(string indexed domain, address indexed from, address indexed to)",
  ],
  
  // NFT Asset Contract ABI
  JOY_ASSET_NFT: [
    // ERC721 Standard
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function balanceOf(address owner) view returns (uint256)",
    "function getApproved(uint256 tokenId) view returns (address)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    // Marketplace functions
    "function mint(address to, string memory uri) returns (uint256)",
    "function mintWithRoyalty(address to, string memory uri, address royaltyReceiver, uint96 royaltyBps) returns (uint256)",
    "function setTokenURI(uint256 tokenId, string memory uri)",
    "function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)",
    // Transfer
    "function transferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function approve(address to, uint256 tokenId)",
    "function setApprovalForAll(address operator, bool approved)",
    // Events
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  ],
  
  // Marketplace Contract ABI
  ENHANCED_MODEL_MARKETPLACE: [
    // Listing functions
    "function createListing(uint256 tokenId, uint256 price, address currency) returns (uint256 listingId)",
    "function updateListing(uint256 listingId, uint256 newPrice)",
    "function cancelListing(uint256 listingId)",
    "function purchaseListing(uint256 listingId) payable",
    // View functions
    "function getListing(uint256 listingId) view returns (address seller, uint256 tokenId, uint256 price, address currency, bool active)",
    "function getActiveListings() view returns (uint256[])",
    "function getSellerListings(address seller) view returns (uint256[])",
    // Events
    "event ListingCreated(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 price)",
    "event ListingPurchased(uint256 indexed listingId, address indexed buyer, uint256 price)",
    "event ListingCancelled(uint256 indexed listingId)",
  ],
  
  // USDC Contract ABI (ERC20)
  USDC: [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)",
  ],
  
  // Helia Pinning Service ABI
  HELIA_PINNING_SERVICE: [
    "function pinContent(string cid, address pinner) returns (uint256 pinId)",
    "function unpinContent(uint256 pinId)",
    "function getPinInfo(uint256 pinId) view returns (string cid, address pinner, uint256 timestamp, bool active)",
    "function getContentPins(string cid) view returns (uint256[])",
    "function getUserPins(address user) view returns (uint256[])",
    "event ContentPinned(uint256 indexed pinId, string cid, address indexed pinner)",
    "event ContentUnpinned(uint256 indexed pinId, string cid)",
  ],
  
  // NFT-Gated Inference Access Contract ABI
  INFERENCE_ACCESS_NFT: [
    // ERC721 Standard
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function balanceOf(address owner) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    // Minting
    "function mint(address to, string assetCid, bytes32 licenseHash, bytes32 dataHash) returns (uint256)",
    "function mintWithLimits(address to, string assetCid, bytes32 licenseHash, bytes32 dataHash, uint256 maxInferences, uint256 maxTokens, uint256 expiresAt) returns (uint256)",
    // Access verification
    "function verifyAccess(uint256 tokenId, address requester) view returns (bool hasAccess, uint256 remainingInferences, uint256 remainingTokens)",
    "function getAccessDetails(uint256 tokenId) view returns (string assetCid, bytes32 licenseHash, bytes32 dataHash, uint256 maxInferences, uint256 usedInferences, uint256 maxTokens, uint256 usedTokens, uint256 expiresAt, bool isActive)",
    "function hasValidAccess(address wallet, string assetCid) view returns (bool)",
    // Usage tracking
    "function recordUsage(uint256 tokenId, uint256 inputTokens, uint256 outputTokens, uint256 computeMs)",
    "function getUsageStats(uint256 tokenId) view returns (uint256 totalInferences, uint256 totalInputTokens, uint256 totalOutputTokens, uint256 totalComputeMs)",
    // License management
    "function getLicense(uint256 tokenId) view returns (bytes32 licenseHash, string licenseCid, uint8 licenseType, bool transferable, bool sublicensable)",
    "function setLicenseCid(uint256 tokenId, string licenseCid)",
    // Data protection
    "function getDataProtection(uint256 tokenId) view returns (bytes32 dataHash, bytes32 merkleRoot, bool encrypted, address keyEscrow)",
    "function setKeyEscrow(uint256 tokenId, address keyEscrow)",
    // Agent permissions
    "function allowAgent(uint256 tokenId, address agent)",
    "function revokeAgent(uint256 tokenId, address agent)",
    "function isAgentAllowed(uint256 tokenId, address agent) view returns (bool)",
    "function getAllowedAgents(uint256 tokenId) view returns (address[])",
    // Revocation
    "function revoke(uint256 tokenId)",
    "function isRevoked(uint256 tokenId) view returns (bool)",
    // Events
    "event InferenceAccessMinted(uint256 indexed tokenId, address indexed owner, string assetCid, bytes32 licenseHash)",
    "event UsageRecorded(uint256 indexed tokenId, uint256 inputTokens, uint256 outputTokens, uint256 computeMs)",
    "event AgentPermissionChanged(uint256 indexed tokenId, address indexed agent, bool allowed)",
    "event AccessRevoked(uint256 indexed tokenId)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ],
  
  // Inference License Registry ABI
  INFERENCE_LICENSE_REGISTRY: [
    // License registration
    "function registerLicense(bytes32 licenseHash, string licenseCid, uint8 licenseType, string scope, bool transferable, bool sublicensable, uint16 creatorRoyaltyBps) returns (uint256)",
    "function getLicense(bytes32 licenseHash) view returns (uint256 id, string licenseCid, uint8 licenseType, string scope, bool transferable, bool sublicensable, uint16 creatorRoyaltyBps, address creator, uint256 createdAt)",
    "function verifyLicense(bytes32 licenseHash) view returns (bool valid, string reason)",
    // License templates
    "function createTemplate(string name, uint8 licenseType, string scope, string terms, uint16 defaultRoyaltyBps) returns (uint256)",
    "function getTemplate(uint256 templateId) view returns (string name, uint8 licenseType, string scope, string terms, uint16 defaultRoyaltyBps)",
    "function listTemplates() view returns (uint256[])",
    // Events
    "event LicenseRegistered(bytes32 indexed licenseHash, uint8 licenseType, address indexed creator)",
    "event TemplateCreated(uint256 indexed templateId, string name, uint8 licenseType)",
  ],
  
  // Data Encryption Key Escrow ABI
  DATA_ENCRYPTION_ESCROW: [
    // Key storage
    "function storeKey(uint256 tokenId, bytes encryptedKey, bytes32 keyHash) returns (bool)",
    "function requestKey(uint256 tokenId, bytes ownershipProof, string purpose) returns (bytes encryptedKey)",
    "function hasKey(uint256 tokenId) view returns (bool)",
    // Key rotation
    "function rotateKey(uint256 tokenId, bytes newEncryptedKey, bytes32 newKeyHash) returns (bool)",
    "function getKeyVersion(uint256 tokenId) view returns (uint256)",
    // Access logging
    "function getAccessLog(uint256 tokenId) view returns (address[] requesters, uint256[] timestamps, string[] purposes)",
    // Events
    "event KeyStored(uint256 indexed tokenId, bytes32 keyHash)",
    "event KeyRequested(uint256 indexed tokenId, address indexed requester, string purpose)",
    "event KeyRotated(uint256 indexed tokenId, bytes32 newKeyHash, uint256 version)",
  ],
  
  // Agent Permission Manager ABI
  AGENT_PERMISSION_MANAGER: [
    // Agent registration
    "function registerAgent(string agentId, string name, uint8 agentType, address wallet) returns (uint256)",
    "function getAgent(uint256 id) view returns (string agentId, string name, uint8 agentType, address wallet, uint256 reputationScore, bool verified, bool active)",
    "function verifyAgent(uint256 id) returns (bool)",
    // Permission management
    "function grantPermission(uint256 agentId, uint256 tokenId, uint8 permissionLevel) returns (bool)",
    "function revokePermission(uint256 agentId, uint256 tokenId) returns (bool)",
    "function getPermissions(uint256 agentId) view returns (uint256[] tokenIds, uint8[] levels)",
    "function hasPermission(uint256 agentId, uint256 tokenId, uint8 requiredLevel) view returns (bool)",
    // Reputation
    "function updateReputation(uint256 agentId, int256 change, string reason) returns (uint256 newScore)",
    "function getReputation(uint256 agentId) view returns (uint256 score, uint256 positiveVotes, uint256 negativeVotes)",
    // Events
    "event AgentRegistered(uint256 indexed id, string agentId, address indexed wallet)",
    "event PermissionGranted(uint256 indexed agentId, uint256 indexed tokenId, uint8 level)",
    "event PermissionRevoked(uint256 indexed agentId, uint256 indexed tokenId)",
    "event ReputationUpdated(uint256 indexed agentId, int256 change, uint256 newScore)",
  ],
  
  // Usage Metering Contract ABI
  USAGE_METERING: [
    // Usage recording
    "function recordInference(uint256 tokenId, uint256 inputTokens, uint256 outputTokens, uint256 computeMs, bytes32 receiptHash) returns (uint256 recordId)",
    "function getUsageRecord(uint256 recordId) view returns (uint256 tokenId, uint256 inputTokens, uint256 outputTokens, uint256 computeMs, bytes32 receiptHash, uint256 timestamp)",
    "function getTokenUsage(uint256 tokenId) view returns (uint256 totalInferences, uint256 totalInputTokens, uint256 totalOutputTokens, uint256 totalComputeMs, uint256 lastUsedAt)",
    // Aggregations
    "function getDailyUsage(uint256 tokenId, uint256 date) view returns (uint256 inferences, uint256 tokens, uint256 computeMs)",
    "function getMonthlyUsage(uint256 tokenId, uint256 year, uint256 month) view returns (uint256 inferences, uint256 tokens, uint256 computeMs)",
    // Billing
    "function calculateCost(uint256 tokenId, uint256 inputTokens, uint256 outputTokens) view returns (uint256 costInWei)",
    "function getOutstandingBalance(uint256 tokenId) view returns (uint256)",
    // Events
    "event UsageRecorded(uint256 indexed recordId, uint256 indexed tokenId, uint256 inputTokens, uint256 outputTokens, bytes32 receiptHash)",
  ],
  
  // Revenue Splitter Contract ABI
  REVENUE_SPLITTER: [
    // Revenue distribution
    "function distributeRevenue(uint256 tokenId, uint256 amount) returns (bool)",
    "function getShares(uint256 tokenId) view returns (address[] recipients, uint256[] shares)",
    "function setShares(uint256 tokenId, address[] recipients, uint256[] shares) returns (bool)",
    // Withdrawals
    "function withdraw() returns (uint256)",
    "function getBalance(address recipient) view returns (uint256)",
    "function getPendingRevenue(address recipient) view returns (uint256)",
    // Stats
    "function getTotalDistributed(uint256 tokenId) view returns (uint256)",
    "function getCreatorEarnings(address creator) view returns (uint256 total, uint256 pending, uint256 withdrawn)",
    // Events
    "event RevenueDistributed(uint256 indexed tokenId, uint256 amount, uint256 creatorShare, uint256 platformShare)",
    "event Withdrawn(address indexed recipient, uint256 amount)",
    "event SharesUpdated(uint256 indexed tokenId, address[] recipients, uint256[] shares)",
  ],

  // ── ENS / Identity contracts (Polygon Amoy) ─────────────────────────────

  /** JoyRegistrarController — public registration */
  JOY_REGISTRAR_CONTROLLER: [
    "function register(string name, address owner, uint256 duration, address resolver, bytes[] resolverData) payable",
    "function available(string name) view returns (bool)",
    "function rentPrice(string name, uint256 duration) view returns (uint256)",
  ],

  /** JoyResolver — CCIP-read resolver with text records */
  JOY_RESOLVER: [
    "function setText(bytes32 node, string key, string value)",
    "function text(bytes32 node, string key) view returns (string)",
    "function addr(bytes32 node) view returns (address)",
    "function setAddr(bytes32 node, address a)",
  ],

  /** JoyCreatorGate — gates platform mints to .joy name owners */
  JOY_CREATOR_GATE: [
    "function mint(address creator, uint256 tokenId, uint256 quantity, bytes data)",
    "function canMint(address creator) view returns (bool)",
  ],

  /** BaseRegistrar — ERC-721 .joy name tokens */
  BASE_REGISTRAR: [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function nameExpires(uint256 id) view returns (uint256)",
    "function available(uint256 id) view returns (bool)",
  ],

  /** ENSRegistry — core name registry */
  ENS_REGISTRY: [
    "function owner(bytes32 node) view returns (address)",
    "function resolver(bytes32 node) view returns (address)",
    "function ttl(bytes32 node) view returns (uint64)",
    "function recordExists(bytes32 node) view returns (bool)",
  ],
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build API URL with path parameters
 */
export function buildApiUrl(endpoint: string, params?: Record<string, string>): string {
  let url = `${JOYMARKETPLACE_API.baseUrl}${endpoint}`;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, value);
    });
  }
  return url;
}

/**
 * Get contract address by name
 */
export function getContractAddress(name: keyof typeof CONTRACT_ADDRESSES): string {
  return CONTRACT_ADDRESSES[name];
}

/**
 * Get contract ABI by name
 */
export function getContractABI(name: keyof typeof CONTRACT_ABIS): string[] {
  return CONTRACT_ABIS[name];
}

/**
 * Get USDC balance formatted
 */
export function formatUSDC(amount: bigint): string {
  const decimals = 6;
  const value = Number(amount) / Math.pow(10, decimals);
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parse USDC amount to smallest unit
 */
export function parseUSDC(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export default {
  POLYGON_MAINNET,
  CONTRACT_ADDRESSES,
  CONTRACT_ABIS,
  JOYMARKETPLACE_API,
  PINNING_CONFIG,
  PAYOUT_CONFIG,
  FIELD_MAPPING,
  buildApiUrl,
  getContractAddress,
  getContractABI,
  formatUSDC,
  parseUSDC,
};
