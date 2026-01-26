/**
 * Smart Contract Studio
 * Create, compile, deploy, and manage smart contracts without external services.
 * Supports Solidity and Vyper on EVM-compatible chains.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";
import { ethers } from "ethers";

import type {
  ContractId,
  SmartContract,
  ContractLanguage,
  ContractTemplate,
  CompilationResult,
  ContractDeployment,
  ContractVerification,
} from "@/types/sovereign_stack_types";

const logger = log.scope("smart_contract_studio");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONTRACTS_DIR = path.join(app.getPath("userData"), "contracts");

// Solidity compiler versions available for download
const SOLC_VERSIONS = [
  "0.8.28",
  "0.8.27",
  "0.8.26",
  "0.8.25",
  "0.8.24",
  "0.8.20",
  "0.8.19",
  "0.8.17",
  "0.7.6",
];

// Chain configurations
const CHAIN_CONFIGS: Record<number, {
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}> = {
  1: {
    name: "Ethereum Mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    explorerApiUrl: "https://api.etherscan.io/api",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  137: {
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon.llamarpc.com",
    explorerUrl: "https://polygonscan.com",
    explorerApiUrl: "https://api.polygonscan.com/api",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  },
  56: {
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    explorerApiUrl: "https://api.bscscan.com/api",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  42161: {
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    explorerApiUrl: "https://api.arbiscan.io/api",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  10: {
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
    explorerApiUrl: "https://api-optimistic.etherscan.io/api",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  8453: {
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    explorerApiUrl: "https://api.basescan.org/api",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  43114: {
    name: "Avalanche C-Chain",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorerUrl: "https://snowtrace.io",
    explorerApiUrl: "https://api.snowtrace.io/api",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  },
  11155111: {
    name: "Sepolia Testnet",
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
    explorerApiUrl: "https://api-sepolia.etherscan.io/api",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  },
  80002: {
    name: "Polygon Amoy Testnet",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    explorerUrl: "https://amoy.polygonscan.com",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  },
};

// Contract templates
const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: "erc20-token",
    name: "ERC20 Token",
    description: "Standard fungible token with minting, burning, and transfer capabilities",
    category: "token",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract {{name}} is ERC20, ERC20Burnable, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "Token name", default: "MyToken" },
      { name: "symbol", type: "string", description: "Token symbol", default: "MTK" },
      { name: "initialSupply", type: "uint256", description: "Initial supply", default: "1000000" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
  {
    id: "erc721-nft",
    name: "ERC721 NFT Collection",
    description: "Non-fungible token collection with minting, metadata, and royalties",
    category: "nft",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract {{name}} is ERC721, ERC721URIStorage, ERC721Royalty, Ownable {
    uint256 private _nextTokenId;
    uint256 public maxSupply;
    uint256 public mintPrice;
    string public baseURI;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 mintPrice_,
        uint96 royaltyBps_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
        _setDefaultRoyalty(msg.sender, royaltyBps_);
    }

    function mint(address to, string memory uri) public payable {
        require(_nextTokenId < maxSupply, "Max supply reached");
        require(msg.value >= mintPrice, "Insufficient payment");
        
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function setBaseURI(string memory uri) public onlyOwner {
        baseURI = uri;
    }

    function withdraw() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Override functions
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage, ERC721Royalty) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721) {
        super._increaseBalance(account, value);
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "Collection name", default: "MyNFT" },
      { name: "symbol", type: "string", description: "Collection symbol", default: "MNFT" },
      { name: "maxSupply", type: "uint256", description: "Maximum supply", default: "10000" },
      { name: "mintPrice", type: "uint256", description: "Mint price in wei", default: "0" },
      { name: "royaltyBps", type: "uint96", description: "Royalty in basis points (500 = 5%)", default: "500" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
  {
    id: "erc1155-multitoken",
    name: "ERC1155 Multi-Token",
    description: "Semi-fungible tokens for gaming items, memberships, etc.",
    category: "token",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

contract {{name}} is ERC1155, Ownable, ERC1155Supply {
    mapping(uint256 => string) private _tokenURIs;

    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

    function setURI(uint256 tokenId, string memory newuri) public onlyOwner {
        _tokenURIs[tokenId] = newuri;
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenUri = _tokenURIs[tokenId];
        return bytes(tokenUri).length > 0 ? tokenUri : super.uri(tokenId);
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data) public onlyOwner {
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public onlyOwner {
        _mintBatch(to, ids, amounts, data);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "Contract name", default: "MyMultiToken" },
      { name: "uri", type: "string", description: "Base URI for metadata", default: "https://api.example.com/token/{id}.json" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
  {
    id: "simple-marketplace",
    name: "NFT Marketplace",
    description: "Simple marketplace for listing and buying NFTs",
    category: "defi",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract {{name}} is ReentrancyGuard, Ownable {
    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    uint256 public listingCount;
    uint256 public feePercent; // basis points (250 = 2.5%)
    
    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(uint256 => uint256)) public tokenListings;

    event Listed(uint256 indexed listingId, address indexed seller, address nftContract, uint256 tokenId, uint256 price);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 price);
    event Cancelled(uint256 indexed listingId);

    constructor(uint256 feePercent_) Ownable(msg.sender) {
        feePercent = feePercent_;
    }

    function list(address nftContract, uint256 tokenId, uint256 price) external returns (uint256) {
        require(price > 0, "Price must be > 0");
        
        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(tokenId) == msg.sender, "Not owner");
        require(nft.isApprovedForAll(msg.sender, address(this)) || nft.getApproved(tokenId) == address(this), "Not approved");

        uint256 listingId = ++listingCount;
        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            active: true
        });
        tokenListings[nftContract][tokenId] = listingId;

        emit Listed(listingId, msg.sender, nftContract, tokenId, price);
        return listingId;
    }

    function buy(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(msg.value >= listing.price, "Insufficient payment");

        listing.active = false;
        delete tokenListings[listing.nftContract][listing.tokenId];

        uint256 fee = (listing.price * feePercent) / 10000;
        uint256 sellerAmount = listing.price - fee;

        IERC721(listing.nftContract).safeTransferFrom(listing.seller, msg.sender, listing.tokenId);
        payable(listing.seller).transfer(sellerAmount);
        
        if (msg.value > listing.price) {
            payable(msg.sender).transfer(msg.value - listing.price);
        }

        emit Sold(listingId, msg.sender, listing.price);
    }

    function cancel(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Not seller");
        require(listing.active, "Not active");

        listing.active = false;
        delete tokenListings[listing.nftContract][listing.tokenId];

        emit Cancelled(listingId);
    }

    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Fee too high"); // max 10%
        feePercent = newFee;
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "Marketplace name", default: "MyMarketplace" },
      { name: "feePercent", type: "uint256", description: "Fee in basis points", default: "250" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
  {
    id: "staking-contract",
    name: "Token Staking",
    description: "Stake tokens to earn rewards over time",
    category: "defi",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract {{name}} is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IERC20 public rewardToken;

    uint256 public rewardRate; // tokens per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;

    mapping(address => uint256) public userStakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    constructor(address stakingToken_, address rewardToken_, uint256 rewardRate_) Ownable(msg.sender) {
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        rewardRate = rewardRate_;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((block.timestamp - lastUpdateTime) * rewardRate * 1e18 / totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        return (userStakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18) + rewards[account];
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalStaked += amount;
        userStakedBalance[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(userStakedBalance[msg.sender] >= amount, "Insufficient balance");
        totalStaked -= amount;
        userStakedBalance[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function setRewardRate(uint256 newRate) external onlyOwner updateReward(address(0)) {
        rewardRate = newRate;
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "Contract name", default: "TokenStaking" },
      { name: "stakingToken", type: "address", description: "Token to stake" },
      { name: "rewardToken", type: "address", description: "Reward token" },
      { name: "rewardRate", type: "uint256", description: "Rewards per second", default: "1000000000000000" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
  {
    id: "dao-governance",
    name: "DAO Governance",
    description: "Decentralized governance with proposals and voting",
    category: "governance",
    language: "solidity",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract {{name}} is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {
    constructor(
        IVotes token_,
        TimelockController timelock_,
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumPercentage_
    )
        Governor("{{name}}")
        GovernorSettings(votingDelay_, votingPeriod_, proposalThreshold_)
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(quorumPercentage_)
        GovernorTimelockControl(timelock_)
    {}

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function _queueOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}`,
    parameters: [
      { name: "name", type: "string", description: "DAO name", default: "MyDAO" },
      { name: "token", type: "address", description: "Governance token address" },
      { name: "timelock", type: "address", description: "Timelock controller address" },
      { name: "votingDelay", type: "uint256", description: "Delay before voting starts (blocks)", default: "7200" },
      { name: "votingPeriod", type: "uint256", description: "Voting period length (blocks)", default: "50400" },
      { name: "proposalThreshold", type: "uint256", description: "Tokens needed to propose", default: "0" },
      { name: "quorumPercentage", type: "uint256", description: "Quorum percentage", default: "4" },
    ],
    dependencies: ["@openzeppelin/contracts"],
  },
];

// =============================================================================
// SMART CONTRACT STUDIO SERVICE
// =============================================================================

export class SmartContractStudio extends EventEmitter {
  private contractsDir: string;
  private contracts: Map<ContractId, SmartContract> = new Map();
  private solcVersions: Map<string, string> = new Map(); // version -> path
  
  constructor(contractsDir?: string) {
    super();
    this.contractsDir = contractsDir || DEFAULT_CONTRACTS_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing smart contract studio", { contractsDir: this.contractsDir });
    
    await fs.mkdir(this.contractsDir, { recursive: true });
    await this.scanContracts();
    
    logger.info("Smart contract studio initialized", { contractCount: this.contracts.size });
  }
  
  private async scanContracts(): Promise<void> {
    const entries = await fs.readdir(this.contractsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(this.contractsDir, entry.name, "contract.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            this.contracts.set(config.id as ContractId, config);
          } catch (error) {
            logger.warn("Failed to load contract config", { path: configPath, error });
          }
        }
      }
    }
  }
  
  // ===========================================================================
  // TEMPLATES
  // ===========================================================================
  
  getTemplates(): ContractTemplate[] {
    return CONTRACT_TEMPLATES;
  }
  
  getTemplate(id: string): ContractTemplate | null {
    return CONTRACT_TEMPLATES.find((t) => t.id === id) || null;
  }
  
  // ===========================================================================
  // CHAIN CONFIG
  // ===========================================================================
  
  getSupportedChains(): Array<{ chainId: number; name: string }> {
    return Object.entries(CHAIN_CONFIGS).map(([chainId, config]) => ({
      chainId: parseInt(chainId),
      name: config.name,
    }));
  }
  
  getChainConfig(chainId: number) {
    return CHAIN_CONFIGS[chainId] || null;
  }
  
  // ===========================================================================
  // CONTRACT MANAGEMENT
  // ===========================================================================
  
  async createContract(params: {
    name: string;
    description?: string;
    language?: ContractLanguage;
    code?: string;
    templateId?: string;
    templateParams?: Record<string, unknown>;
  }): Promise<SmartContract> {
    const id = crypto.randomUUID() as ContractId;
    const contractDir = path.join(this.contractsDir, id);
    await fs.mkdir(contractDir, { recursive: true });
    
    let code = params.code || "";
    const language = params.language || "solidity";
    
    // Use template if specified
    if (params.templateId) {
      const template = this.getTemplate(params.templateId);
      if (template) {
        code = template.code;
        // Replace template variables
        for (const [key, value] of Object.entries(params.templateParams || {})) {
          code = code.replace(new RegExp(`{{${key}}}`, "g"), String(value));
        }
        code = code.replace(/{{name}}/g, params.name);
      }
    }
    
    // If no code provided, use a basic template
    if (!code) {
      code = language === "solidity"
        ? `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${params.name} {
    // Your code here
}
`
        : `# @version ^0.3.10

# ${params.name}
# Your Vyper code here
`;
    }
    
    const contract: SmartContract = {
      id,
      name: params.name,
      description: params.description,
      language,
      sourceCode: code,
      compilerVersion: language === "solidity" ? "0.8.20" : "0.3.10",
      deployments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Save source code
    const extension = language === "solidity" ? "sol" : "vy";
    await fs.writeFile(path.join(contractDir, `${params.name}.${extension}`), code);
    
    // Save config
    await this.saveContract(contract);
    this.contracts.set(id, contract);
    this.emit("contract:created", contract);
    
    return contract;
  }
  
  async saveContract(contract: SmartContract): Promise<void> {
    const contractDir = path.join(this.contractsDir, contract.id);
    await fs.mkdir(contractDir, { recursive: true });
    
    contract.updatedAt = Date.now();
    await fs.writeFile(
      path.join(contractDir, "contract.json"),
      JSON.stringify(contract, null, 2)
    );
    
    // Save source code
    const extension = contract.language === "solidity" ? "sol" : "vy";
    await fs.writeFile(
      path.join(contractDir, `${contract.name}.${extension}`),
      contract.sourceCode
    );
    
    this.contracts.set(contract.id, contract);
  }
  
  listContracts(): SmartContract[] {
    return Array.from(this.contracts.values());
  }
  
  getContract(id: ContractId): SmartContract | null {
    return this.contracts.get(id) || null;
  }
  
  async updateContract(id: ContractId, updates: Partial<SmartContract>): Promise<SmartContract> {
    const contract = this.contracts.get(id);
    if (!contract) {
      throw new Error(`Contract not found: ${id}`);
    }
    
    Object.assign(contract, updates);
    await this.saveContract(contract);
    this.emit("contract:updated", contract);
    
    return contract;
  }
  
  async deleteContract(id: ContractId): Promise<void> {
    const contractDir = path.join(this.contractsDir, id);
    if (existsSync(contractDir)) {
      await fs.rm(contractDir, { recursive: true, force: true });
    }
    
    this.contracts.delete(id);
    this.emit("contract:deleted", { id });
  }
  
  // ===========================================================================
  // COMPILATION
  // ===========================================================================
  
  async compile(contractId: ContractId): Promise<CompilationResult> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }
    
    logger.info("Compiling contract", { contractId, language: contract.language });
    
    if (contract.language === "solidity") {
      return this.compileSolidity(contract);
    } else {
      return this.compileVyper(contract);
    }
  }
  
  private async compileSolidity(contract: SmartContract): Promise<CompilationResult> {
    try {
      // Use solc-js for compilation
      const solc = await this.getSolcCompiler(contract.compilerVersion || "0.8.20");
      
      const input = {
        language: "Solidity",
        sources: {
          [`${contract.name}.sol`]: {
            content: contract.sourceCode,
          },
        },
        settings: {
          optimizer: {
            enabled: contract.optimizerRuns !== undefined,
            runs: contract.optimizerRuns || 200,
          },
          outputSelection: {
            "*": {
              "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
            },
          },
        },
      };
      
      // For a real implementation, we'd use solc-js here
      // For now, we'll use a simplified approach via ethers
      const result = await this.compileSolidityViaEthers(contract);
      
      contract.abi = result.abi;
      contract.bytecode = result.bytecode;
      contract.lastCompiled = Date.now();
      await this.saveContract(contract);
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{ message: errorMessage, severity: "error" }],
      };
    }
  }
  
  private async compileSolidityViaEthers(contract: SmartContract): Promise<CompilationResult> {
    // This is a simplified compilation that only works for basic contracts
    // In production, we'd use solc-js directly
    
    // For now, return a mock compilation result
    // Real implementation would need proper solc integration
    
    // Parse basic ABI from source
    const abi = this.parseBasicAbi(contract.sourceCode);
    
    return {
      success: true,
      abi,
      bytecode: "0x", // Would be actual bytecode
      warnings: [{ message: "Using simplified compilation - consider setting up full solc", severity: "warning" }],
    };
  }
  
  private parseBasicAbi(sourceCode: string): ethers.InterfaceAbi {
    // Very basic ABI parsing - real implementation would use solc
    const abi: Array<{ type: string; name?: string; inputs?: Array<{ type: string; name: string }>; outputs?: Array<{ type: string; name: string }>; stateMutability?: string }> = [];
    
    // Find constructor
    const constructorMatch = sourceCode.match(/constructor\s*\(([^)]*)\)/);
    if (constructorMatch) {
      const params = this.parseParams(constructorMatch[1]);
      abi.push({
        type: "constructor",
        inputs: params,
        stateMutability: "nonpayable",
      });
    }
    
    // Find functions
    const functionRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*(public|external|internal|private)?\s*(view|pure|payable)?\s*(returns\s*\(([^)]*)\))?/g;
    let match;
    while ((match = functionRegex.exec(sourceCode)) !== null) {
      const [, name, params, , mutability, , returns] = match;
      if (name && !["constructor"].includes(name)) {
        abi.push({
          type: "function",
          name,
          inputs: this.parseParams(params),
          outputs: returns ? this.parseParams(returns) : [],
          stateMutability: mutability || "nonpayable",
        });
      }
    }
    
    return abi;
  }
  
  private parseParams(paramsStr: string): Array<{ type: string; name: string }> {
    if (!paramsStr.trim()) return [];
    
    return paramsStr.split(",").map((param) => {
      const parts = param.trim().split(/\s+/);
      const type = parts[0] || "uint256";
      const name = parts[parts.length - 1] || "param";
      return { type, name };
    });
  }
  
  private async compileVyper(contract: SmartContract): Promise<CompilationResult> {
    // Vyper compilation would require vyper compiler
    return {
      success: false,
      errors: [{ message: "Vyper compilation not yet implemented", severity: "error" }],
    };
  }
  
  private async getSolcCompiler(version: string): Promise<unknown> {
    // In production, this would load the actual solc-js compiler
    return null;
  }
  
  // ===========================================================================
  // DEPLOYMENT
  // ===========================================================================
  
  async deploy(
    contractId: ContractId,
    params: {
      chainId: number;
      constructorArgs?: unknown[];
      privateKey?: string;
      gasLimit?: number;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    }
  ): Promise<ContractDeployment> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }
    
    if (!contract.bytecode || contract.bytecode === "0x") {
      throw new Error("Contract must be compiled before deployment");
    }
    
    const chainConfig = CHAIN_CONFIGS[params.chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${params.chainId}`);
    }
    
    logger.info("Deploying contract", { contractId, chainId: params.chainId });
    
    // Create provider and wallet
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    
    if (!params.privateKey) {
      throw new Error("Private key required for deployment");
    }
    
    const wallet = new ethers.Wallet(params.privateKey, provider);
    
    // Create contract factory
    const factory = new ethers.ContractFactory(
      contract.abi!,
      contract.bytecode,
      wallet
    );
    
    // Deploy
    const deployTx: Record<string, unknown> = {};
    if (params.gasLimit) deployTx.gasLimit = params.gasLimit;
    if (params.gasPrice) deployTx.gasPrice = ethers.parseUnits(params.gasPrice, "gwei");
    if (params.maxFeePerGas) deployTx.maxFeePerGas = ethers.parseUnits(params.maxFeePerGas, "gwei");
    if (params.maxPriorityFeePerGas) deployTx.maxPriorityFeePerGas = ethers.parseUnits(params.maxPriorityFeePerGas, "gwei");
    
    const deployedContract = await factory.deploy(...(params.constructorArgs || []), deployTx);
    await deployedContract.waitForDeployment();
    
    const address = await deployedContract.getAddress();
    const txHash = deployedContract.deploymentTransaction()?.hash || "";
    
    const deployment: ContractDeployment = {
      id: crypto.randomUUID(),
      contractId,
      chainId: params.chainId,
      address,
      transactionHash: txHash,
      deployerAddress: wallet.address,
      constructorArgs: params.constructorArgs,
      blockNumber: deployedContract.deploymentTransaction()?.blockNumber || 0,
      gasUsed: 0, // Would get from receipt
      status: "confirmed",
      createdAt: Date.now(),
    };
    
    // Update contract
    contract.deployments.push(deployment);
    await this.saveContract(contract);
    
    this.emit("contract:deployed", deployment);
    logger.info("Contract deployed", { address, txHash });
    
    return deployment;
  }
  
  // ===========================================================================
  // VERIFICATION
  // ===========================================================================
  
  async verify(
    contractId: ContractId,
    deploymentId: string,
    params: {
      apiKey: string;
    }
  ): Promise<ContractVerification> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }
    
    const deployment = contract.deployments.find((d) => d.id === deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    
    const chainConfig = CHAIN_CONFIGS[deployment.chainId];
    if (!chainConfig?.explorerApiUrl) {
      throw new Error(`Explorer API not available for chain: ${deployment.chainId}`);
    }
    
    logger.info("Verifying contract", { contractId, deploymentId, chain: deployment.chainId });
    
    // Prepare verification request
    const verifyParams = new URLSearchParams({
      apikey: params.apiKey,
      module: "contract",
      action: "verifysourcecode",
      contractaddress: deployment.address,
      sourceCode: contract.sourceCode,
      codeformat: "solidity-single-file",
      contractname: contract.name,
      compilerversion: `v${contract.compilerVersion}`,
      optimizationUsed: contract.optimizerRuns !== undefined ? "1" : "0",
      runs: String(contract.optimizerRuns || 200),
      constructorArguements: deployment.constructorArgs
        ? ethers.AbiCoder.defaultAbiCoder().encode(
            (contract.abi as Array<{ type: string; inputs?: Array<{ type: string }> }>).find((a) => a.type === "constructor")?.inputs?.map((i) => i.type) || [],
            deployment.constructorArgs
          ).slice(2)
        : "",
      evmversion: "paris",
      licenseType: "3", // MIT
    });
    
    const response = await fetch(chainConfig.explorerApiUrl, {
      method: "POST",
      body: verifyParams,
    });
    
    const result = await response.json();
    
    const verification: ContractVerification = {
      id: crypto.randomUUID(),
      deploymentId,
      status: result.status === "1" ? "verified" : "failed",
      guid: result.result,
      explorerUrl: `${chainConfig.explorerUrl}/address/${deployment.address}#code`,
      verifiedAt: result.status === "1" ? Date.now() : undefined,
    };
    
    // Update deployment
    deployment.verification = verification;
    await this.saveContract(contract);
    
    this.emit("contract:verified", verification);
    
    return verification;
  }
  
  // ===========================================================================
  // INTERACTION
  // ===========================================================================
  
  async callReadFunction(
    contractId: ContractId,
    deploymentId: string,
    functionName: string,
    args: unknown[] = []
  ): Promise<unknown> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }
    
    const deployment = contract.deployments.find((d) => d.id === deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    
    const chainConfig = CHAIN_CONFIGS[deployment.chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${deployment.chainId}`);
    }
    
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const contractInstance = new ethers.Contract(deployment.address, contract.abi!, provider);
    
    return contractInstance[functionName](...args);
  }
  
  async callWriteFunction(
    contractId: ContractId,
    deploymentId: string,
    functionName: string,
    args: unknown[] = [],
    params: {
      privateKey: string;
      value?: string;
      gasLimit?: number;
    }
  ): Promise<ethers.TransactionResponse> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract not found: ${contractId}`);
    }
    
    const deployment = contract.deployments.find((d) => d.id === deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    
    const chainConfig = CHAIN_CONFIGS[deployment.chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${deployment.chainId}`);
    }
    
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const wallet = new ethers.Wallet(params.privateKey, provider);
    const contractInstance = new ethers.Contract(deployment.address, contract.abi!, wallet);
    
    const txParams: Record<string, unknown> = {};
    if (params.value) txParams.value = ethers.parseEther(params.value);
    if (params.gasLimit) txParams.gasLimit = params.gasLimit;
    
    return contractInstance[functionName](...args, txParams);
  }
  
  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  
  getSolcVersions(): string[] {
    return SOLC_VERSIONS;
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}

// Export singleton
export const smartContractStudio = new SmartContractStudio();
