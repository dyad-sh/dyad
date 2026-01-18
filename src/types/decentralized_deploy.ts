/**
 * Decentralized Deployment Types
 * Support for 4everland, Fleek, IPFS, Arweave, Filecoin, and other Web3 hosting platforms
 */

// Supported decentralized deployment platforms
export type DecentralizedPlatform = 
  | "4everland"
  | "fleek"
  | "ipfs-pinata"
  | "ipfs-infura"
  | "ipfs-web3storage"
  | "arweave"
  | "filecoin"
  | "skynet"
  | "spheron"
  | "filebase";

// Platform configuration
export interface PlatformConfig {
  id: DecentralizedPlatform;
  name: string;
  description: string;
  icon: string;
  website: string;
  features: string[];
  pricing: "free" | "freemium" | "paid";
  permanence: "permanent" | "pinned" | "temporary";
  supportsCustomDomains: boolean;
  supportsENS: boolean;
  supportsIPNS: boolean;
  requiresApiKey: boolean;
  chainSupport?: string[];
}

// Platform credentials
export interface PlatformCredentials {
  platform: DecentralizedPlatform;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  projectId?: string;
  bucketName?: string;
  walletAddress?: string;
  privateKey?: string; // Encrypted
  additionalConfig?: Record<string, string>;
}

// Deployment request
export interface DecentralizedDeployRequest {
  appId: number;
  platform: DecentralizedPlatform;
  buildCommand?: string;
  outputDir?: string;
  envVars?: Record<string, string>;
  customDomain?: string;
  ensName?: string;
  ipnsKey?: string;
  permanentStorage?: boolean;
  metadata?: DeploymentMetadata;
}

// Deployment metadata
export interface DeploymentMetadata {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  license?: string;
}

// Deployment result
export interface DecentralizedDeployResult {
  success: boolean;
  platform: DecentralizedPlatform;
  deploymentId: string;
  cid?: string; // IPFS Content ID
  txId?: string; // Arweave Transaction ID
  url: string;
  gatewayUrls: string[];
  ipnsName?: string;
  ensName?: string;
  timestamp: number;
  size?: number;
  cost?: {
    amount: string;
    currency: string;
    usdEquivalent?: number;
  };
  error?: string;
}

// Deployment status
export type DeploymentStatus = 
  | "pending"
  | "building"
  | "uploading"
  | "pinning"
  | "propagating"
  | "live"
  | "failed"
  | "archived";

// Deployment record
export interface DecentralizedDeployment {
  id: string;
  appId: number;
  platform: DecentralizedPlatform;
  status: DeploymentStatus;
  cid?: string;
  txId?: string;
  url: string;
  gatewayUrls: string[];
  ipnsName?: string;
  ensName?: string;
  customDomain?: string;
  metadata?: DeploymentMetadata;
  size?: number;
  cost?: {
    amount: string;
    currency: string;
  };
  createdAt: number;
  updatedAt: number;
  buildLogs?: string[];
}

// IPFS Pin status
export interface IPFSPinStatus {
  cid: string;
  status: "pinned" | "pinning" | "unpinned" | "failed";
  providers: string[];
  size?: number;
  createdAt: number;
}

// Arweave transaction
export interface ArweaveTransaction {
  id: string;
  owner: string;
  tags: { name: string; value: string }[];
  data_size: number;
  reward: string;
  status: "pending" | "confirmed" | "failed";
  block_height?: number;
  confirmations?: number;
}

// Gateway configuration
export interface GatewayConfig {
  name: string;
  url: string;
  type: "ipfs" | "arweave" | "custom";
  isPublic: boolean;
  rateLimit?: number;
}

// Default IPFS gateways
export const DEFAULT_IPFS_GATEWAYS: GatewayConfig[] = [
  { name: "ipfs.io", url: "https://ipfs.io/ipfs/", type: "ipfs", isPublic: true },
  { name: "dweb.link", url: "https://dweb.link/ipfs/", type: "ipfs", isPublic: true },
  { name: "cloudflare-ipfs", url: "https://cloudflare-ipfs.com/ipfs/", type: "ipfs", isPublic: true },
  { name: "4everland", url: "https://4everland.io/ipfs/", type: "ipfs", isPublic: true },
  { name: "fleek", url: "https://fleek.cool/ipfs/", type: "ipfs", isPublic: true },
  { name: "pinata", url: "https://gateway.pinata.cloud/ipfs/", type: "ipfs", isPublic: true },
  { name: "w3s.link", url: "https://w3s.link/ipfs/", type: "ipfs", isPublic: true },
];

// Default Arweave gateways
export const DEFAULT_ARWEAVE_GATEWAYS: GatewayConfig[] = [
  { name: "arweave.net", url: "https://arweave.net/", type: "arweave", isPublic: true },
  { name: "arweave.dev", url: "https://arweave.dev/", type: "arweave", isPublic: true },
  { name: "viewblock", url: "https://viewblock.io/arweave/tx/", type: "arweave", isPublic: true },
];

// Platform configurations
export const PLATFORM_CONFIGS: Record<DecentralizedPlatform, PlatformConfig> = {
  "4everland": {
    id: "4everland",
    name: "4EVERLAND",
    description: "Web3 cloud computing platform with IPFS hosting, Arweave storage, and more",
    icon: "4everland",
    website: "https://4everland.org",
    features: ["IPFS Hosting", "Arweave Storage", "Custom Domains", "ENS Support", "CI/CD", "Serverless Functions"],
    pricing: "freemium",
    permanence: "permanent",
    supportsCustomDomains: true,
    supportsENS: true,
    supportsIPNS: true,
    requiresApiKey: true,
    chainSupport: ["ethereum", "polygon", "bsc", "arbitrum"],
  },
  "fleek": {
    id: "fleek",
    name: "Fleek",
    description: "Web3 development platform for hosting, storage, and edge functions",
    icon: "fleek",
    website: "https://fleek.xyz",
    features: ["IPFS Hosting", "Custom Domains", "ENS Support", "Edge Functions", "CI/CD"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: true,
    supportsENS: true,
    supportsIPNS: true,
    requiresApiKey: true,
  },
  "ipfs-pinata": {
    id: "ipfs-pinata",
    name: "Pinata",
    description: "IPFS pinning service with easy-to-use API and gateway",
    icon: "pinata",
    website: "https://pinata.cloud",
    features: ["IPFS Pinning", "Dedicated Gateway", "SDK", "NFT Tools"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: true,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: true,
  },
  "ipfs-infura": {
    id: "ipfs-infura",
    name: "Infura IPFS",
    description: "Enterprise-grade IPFS infrastructure by ConsenSys",
    icon: "infura",
    website: "https://infura.io",
    features: ["IPFS API", "High Availability", "Enterprise Support"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: false,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: true,
  },
  "ipfs-web3storage": {
    id: "ipfs-web3storage",
    name: "web3.storage",
    description: "Free decentralized storage powered by Filecoin",
    icon: "web3storage",
    website: "https://web3.storage",
    features: ["IPFS + Filecoin", "Free Tier", "JavaScript SDK", "Content Addressing"],
    pricing: "free",
    permanence: "permanent",
    supportsCustomDomains: false,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: true,
  },
  "arweave": {
    id: "arweave",
    name: "Arweave",
    description: "Permanent, decentralized data storage on the Arweave network",
    icon: "arweave",
    website: "https://arweave.org",
    features: ["Permanent Storage", "Pay Once", "Permaweb", "Smart Contracts"],
    pricing: "paid",
    permanence: "permanent",
    supportsCustomDomains: true,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: false,
    chainSupport: ["arweave"],
  },
  "filecoin": {
    id: "filecoin",
    name: "Filecoin",
    description: "Decentralized storage network with crypto-economic incentives",
    icon: "filecoin",
    website: "https://filecoin.io",
    features: ["Decentralized Storage", "Storage Deals", "Retrieval Market"],
    pricing: "paid",
    permanence: "pinned",
    supportsCustomDomains: false,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: true,
    chainSupport: ["filecoin"],
  },
  "skynet": {
    id: "skynet",
    name: "Skynet (Sia)",
    description: "Decentralized CDN and file sharing platform on Sia",
    icon: "skynet",
    website: "https://siasky.net",
    features: ["Skylinks", "Fast Uploads", "Free Tier", "MySky Identity"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: true,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: false,
  },
  "spheron": {
    id: "spheron",
    name: "Spheron",
    description: "Web3 infrastructure platform for decentralized hosting",
    icon: "spheron",
    website: "https://spheron.network",
    features: ["Multi-chain", "CI/CD", "Custom Domains", "Compute"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: true,
    supportsENS: true,
    supportsIPNS: true,
    requiresApiKey: true,
    chainSupport: ["ethereum", "polygon", "filecoin", "arweave"],
  },
  "filebase": {
    id: "filebase",
    name: "Filebase",
    description: "S3-compatible object storage on IPFS, Filecoin, and more",
    icon: "filebase",
    website: "https://filebase.com",
    features: ["S3 Compatible", "Multi-Network", "Enterprise Ready", "IPFS Pinning"],
    pricing: "freemium",
    permanence: "pinned",
    supportsCustomDomains: true,
    supportsENS: false,
    supportsIPNS: false,
    requiresApiKey: true,
    chainSupport: ["ipfs", "filecoin", "sia", "storj"],
  },
};

// Build configuration
export interface DecentralizedBuildConfig {
  framework?: "react" | "vue" | "svelte" | "next" | "astro" | "static" | "custom";
  buildCommand: string;
  outputDir: string;
  installCommand?: string;
  nodeVersion?: string;
  envVars?: Record<string, string>;
}

// Auto-detect build config from project
export function detectBuildConfig(packageJson: any): DecentralizedBuildConfig {
  const scripts = packageJson.scripts || {};
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  // Detect framework
  let framework: DecentralizedBuildConfig["framework"] = "static";
  let buildCommand = scripts.build || "npm run build";
  let outputDir = "dist";
  
  if (deps["next"]) {
    framework = "next";
    outputDir = "out"; // For static export
    buildCommand = "next build && next export";
  } else if (deps["react"]) {
    framework = "react";
    outputDir = deps["vite"] ? "dist" : "build";
  } else if (deps["vue"]) {
    framework = "vue";
    outputDir = "dist";
  } else if (deps["svelte"]) {
    framework = "svelte";
    outputDir = "build";
  } else if (deps["astro"]) {
    framework = "astro";
    outputDir = "dist";
  }
  
  return {
    framework,
    buildCommand,
    outputDir,
    installCommand: "npm install",
    nodeVersion: "18",
  };
}
