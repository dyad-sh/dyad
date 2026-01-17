/**
 * JoyMarketplace.io Integration Configuration
 * Connects local JoyCreate app to the online JoyMarketplace system
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
};

// =============================================================================
// API CONFIGURATION
// =============================================================================

export const JOYMARKETPLACE_API = {
  // Base URLs
  baseUrl: process.env.JOYMARKETPLACE_API_URL || "https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1",
  webUrl: process.env.JOYMARKETPLACE_WEB_URL || "https://joymarketplace.io",
  
  // Supabase backend (for direct database operations)
  supabaseUrl: "https://jgsbmnzhvuwiujqbaieo.supabase.co",
  supabaseAnonKey: process.env.JOYMARKETPLACE_SUPABASE_ANON_KEY || "",
  
  // API Endpoints (Edge Functions)
  endpoints: {
    // Auth & Profile
    verifyPublisher: "/joycreate-publisher-verify",
    getProfile: "/joycreate-publisher-verify",
    
    // Listings Sync - syncs to user's store (digital_assets + store_ai_assets)
    syncListing: "/joycreate-sync-listing",
    
    // Receipts - ingest IPLD inference receipts
    ingestReceipt: "/joycreate-receipt-ingest",
    
    // Legacy endpoints (kept for compatibility)
    listAssets: "/marketplace-listing",
    getAsset: "/marketplace-listing",
    publishAsset: "/marketplace-listing",
    updateAsset: "/marketplace-listing",
    archiveAsset: "/marketplace-listing",
    verifyReceipt: "/joycreate-receipt-ingest",
    getEarnings: "/database-operations",
    requestPayout: "/process-royalty",
  },
  
  // Auth scheme
  authScheme: "Bearer", // Authorization: Bearer <API_KEY>
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
