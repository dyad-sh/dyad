/**
 * JCN Storage Adapter Service
 * Handles IPFS pinning with multiple providers, retries, and verification.
 * 
 * Features:
 * - Multi-provider pinning (IPFS local, remote, Web3.Storage, Pinata, 4everland)
 * - Exponential backoff retries
 * - Content verification after pin
 * - Unified interface for all storage operations
 */

import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
// @ts-ignore - formdata-node types not properly exported
import { FormData, File } from "formdata-node";
// @ts-ignore - formdata-node types not properly exported
import { fileFromPath } from "formdata-node/file-from-path";

import { sha256, sha256File } from "./jcn_bundle_builder";
import { PINNING_CONFIG } from "@/config/joymarketplace";

import type {
  StorageProvider,
  PinRequest,
  PinResult,
  StorageStatus,
  Cid,
  Sha256Hash,
} from "@/types/jcn_types";

const logger = log.scope("jcn_storage_adapter");

// =============================================================================
// RETRY UTILITIES
// =============================================================================

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < options.maxRetries) {
        const delay = Math.min(
          options.baseDelayMs * Math.pow(2, attempt),
          options.maxDelayMs
        );
        logger.warn(`Retry attempt ${attempt + 1}/${options.maxRetries} after ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// =============================================================================
// PROVIDER IMPLEMENTATIONS
// =============================================================================

interface StorageCredentials {
  foureverland?: {
    apiKey: string;
    projectId?: string;
  };
  pinata?: {
    apiKey: string;
    secretKey: string;
  };
  web3Storage?: {
    token: string;
  };
  ipfsLocal?: {
    apiUrl: string;
  };
  ipfsRemote?: {
    apiUrl: string;
    authToken?: string;
  };
}

/**
 * Pin to 4everland
 */
async function pinTo4everland(
  content: Buffer | string,
  name: string,
  credentials: StorageCredentials["foureverland"]
): Promise<PinResult> {
  if (!credentials?.apiKey) {
    return {
      provider: "4everland",
      success: false,
      error: "4everland credentials not configured",
    };
  }
  
  try {
    const formData = new FormData();
    
    // If content is a file path, read it
    const data = typeof content === "string" && await fs.pathExists(content)
      ? await fs.readFile(content)
      : typeof content === "string"
        ? Buffer.from(content)
        : content;
    
    formData.set("file", new File([data], name));
    formData.set("name", name);
    
    const response = await fetch(`${PINNING_CONFIG.foureverland.apiUrl}${PINNING_CONFIG.foureverland.pinningEndpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${credentials.apiKey}`,
      },
      body: formData as unknown as BodyInit,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`4everland pin failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json() as { cid: string; pinId?: string };
    
    return {
      provider: "4everland",
      success: true,
      cid: result.cid,
      pinId: result.pinId,
      gatewayUrl: `${PINNING_CONFIG.foureverland.gateway}/${result.cid}`,
    };
  } catch (error) {
    logger.error("4everland pin error:", error);
    return {
      provider: "4everland",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pin to Pinata
 */
async function pinToPinata(
  content: Buffer | string,
  name: string,
  credentials: StorageCredentials["pinata"]
): Promise<PinResult> {
  if (!credentials?.apiKey || !credentials?.secretKey) {
    return {
      provider: "pinata",
      success: false,
      error: "Pinata credentials not configured",
    };
  }
  
  try {
    const formData = new FormData();
    
    // If content is a file path, read it
    const data = typeof content === "string" && await fs.pathExists(content)
      ? await fs.readFile(content)
      : typeof content === "string"
        ? Buffer.from(content)
        : content;
    
    formData.set("file", new File([data], name));
    formData.set("pinataMetadata", JSON.stringify({ name }));
    
    const response = await fetch(`${PINNING_CONFIG.pinata.apiUrl}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: {
        "pinata_api_key": credentials.apiKey,
        "pinata_secret_api_key": credentials.secretKey,
      },
      body: formData as unknown as BodyInit,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata pin failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json() as { IpfsHash: string; PinSize: number };
    
    return {
      provider: "pinata",
      success: true,
      cid: result.IpfsHash,
      size: result.PinSize,
      gatewayUrl: `${PINNING_CONFIG.pinata.gateway}/${result.IpfsHash}`,
    };
  } catch (error) {
    logger.error("Pinata pin error:", error);
    return {
      provider: "pinata",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pin to Web3.Storage
 */
async function pinToWeb3Storage(
  content: Buffer | string,
  name: string,
  credentials: StorageCredentials["web3Storage"]
): Promise<PinResult> {
  if (!credentials?.token) {
    return {
      provider: "web3_storage",
      success: false,
      error: "Web3.Storage token not configured",
    };
  }
  
  try {
    // If content is a file path, read it
    const data = typeof content === "string" && await fs.pathExists(content)
      ? await fs.readFile(content)
      : typeof content === "string"
        ? Buffer.from(content)
        : content;
    
    const response = await fetch("https://api.web3.storage/upload", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${credentials.token}`,
        "X-Name": encodeURIComponent(name),
      },
      body: new Uint8Array(data),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Web3.Storage upload failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json() as { cid: string };
    
    return {
      provider: "web3_storage",
      success: true,
      cid: result.cid,
      gatewayUrl: `https://w3s.link/ipfs/${result.cid}`,
    };
  } catch (error) {
    logger.error("Web3.Storage pin error:", error);
    return {
      provider: "web3_storage",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pin to local IPFS node
 */
async function pinToLocalIPFS(
  content: Buffer | string,
  name: string,
  credentials: StorageCredentials["ipfsLocal"]
): Promise<PinResult> {
  const apiUrl = credentials?.apiUrl || "http://127.0.0.1:5001";
  
  try {
    const formData = new FormData();
    
    // If content is a file path, read it
    const data = typeof content === "string" && await fs.pathExists(content)
      ? await fs.readFile(content)
      : typeof content === "string"
        ? Buffer.from(content)
        : content;
    
    formData.set("file", new File([data], name));
    
    // Add to IPFS
    const addResponse = await fetch(`${apiUrl}/api/v0/add?pin=true&quieter=true`, {
      method: "POST",
      body: formData as unknown as BodyInit,
    });
    
    if (!addResponse.ok) {
      throw new Error(`Local IPFS add failed: ${addResponse.status}`);
    }
    
    const result = await addResponse.json() as { Hash: string; Size: string };
    
    return {
      provider: "ipfs_local",
      success: true,
      cid: result.Hash,
      size: parseInt(result.Size, 10),
      gatewayUrl: `http://127.0.0.1:8080/ipfs/${result.Hash}`,
    };
  } catch (error) {
    logger.error("Local IPFS pin error:", error);
    return {
      provider: "ipfs_local",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// JCN STORAGE ADAPTER
// =============================================================================

export class JcnStorageAdapter {
  private credentials: StorageCredentials = {};
  private primaryProvider: StorageProvider = "4everland";
  private retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS;
  
  /**
   * Configure credentials for a provider
   */
  configureProvider(provider: StorageProvider, config: unknown): void {
    switch (provider) {
      case "4everland":
        this.credentials.foureverland = config as StorageCredentials["foureverland"];
        break;
      case "pinata":
        this.credentials.pinata = config as StorageCredentials["pinata"];
        break;
      case "web3_storage":
        this.credentials.web3Storage = config as StorageCredentials["web3Storage"];
        break;
      case "ipfs_local":
        this.credentials.ipfsLocal = config as StorageCredentials["ipfsLocal"];
        break;
      case "ipfs_remote":
        this.credentials.ipfsRemote = config as StorageCredentials["ipfsRemote"];
        break;
    }
    logger.info(`Configured storage provider: ${provider}`);
  }
  
  /**
   * Set primary provider
   */
  setPrimaryProvider(provider: StorageProvider): void {
    this.primaryProvider = provider;
  }
  
  /**
   * Set retry options
   */
  setRetryOptions(options: Partial<RetryOptions>): void {
    this.retryOptions = { ...this.retryOptions, ...options };
  }
  
  /**
   * Pin content to specified providers
   */
  async pin(request: PinRequest): Promise<PinResult[]> {
    const results: PinResult[] = [];
    const content = request.content;
    const name = request.name || `jcn-${Date.now()}`;
    
    // Determine content to pin
    let dataToPin: Buffer;
    let expectedHash: Sha256Hash | undefined = request.verification?.expectedHash;
    
    if (typeof content === "string") {
      // Check if it's a CID (already pinned elsewhere) or file path
      if (await fs.pathExists(content)) {
        dataToPin = await fs.readFile(content);
        if (!expectedHash && request.verification?.enabled) {
          expectedHash = await sha256File(content);
        }
      } else {
        // Assume it's raw content
        dataToPin = Buffer.from(content);
        if (!expectedHash && request.verification?.enabled) {
          expectedHash = sha256(dataToPin);
        }
      }
    } else {
      dataToPin = content;
      if (!expectedHash && request.verification?.enabled) {
        expectedHash = sha256(dataToPin);
      }
    }
    
    // Pin to each provider
    for (const provider of request.providers) {
      logger.info(`Pinning to ${provider}`, { name, size: dataToPin.length });
      
      try {
        const result = await withRetry(
          async () => this.pinToProvider(provider, dataToPin, name),
          this.retryOptions
        );
        
        // Verify if enabled
        if (result.success && request.verification?.enabled && result.cid) {
          const verified = await this.verifyPin(provider, result.cid, expectedHash);
          result.verified = verified;
          
          if (!verified) {
            logger.warn(`Pin verification failed for ${provider}`, { cid: result.cid });
          }
        }
        
        results.push(result);
      } catch (error) {
        results.push({
          provider,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    return results;
  }
  
  /**
   * Pin to a specific provider
   */
  private async pinToProvider(
    provider: StorageProvider,
    data: Buffer,
    name: string
  ): Promise<PinResult> {
    switch (provider) {
      case "4everland":
        return pinTo4everland(data, name, this.credentials.foureverland);
      case "pinata":
        return pinToPinata(data, name, this.credentials.pinata);
      case "web3_storage":
        return pinToWeb3Storage(data, name, this.credentials.web3Storage);
      case "ipfs_local":
        return pinToLocalIPFS(data, name, this.credentials.ipfsLocal);
      case "ipfs_remote":
        // Similar to local but with different URL
        return pinToLocalIPFS(data, name, this.credentials.ipfsRemote);
      default:
        return {
          provider,
          success: false,
          error: `Unknown provider: ${provider}`,
        };
    }
  }
  
  /**
   * Verify pinned content by fetching and hashing
   */
  async verifyPin(
    provider: StorageProvider,
    cid: Cid,
    expectedHash?: Sha256Hash
  ): Promise<boolean> {
    try {
      // Get gateway URL for provider
      const gatewayUrl = this.getGatewayUrl(provider, cid);
      
      // Fetch content
      const response = await fetch(gatewayUrl);
      if (!response.ok) {
        logger.warn(`Failed to fetch for verification: ${response.status}`);
        return false;
      }
      
      const data = Buffer.from(await response.arrayBuffer());
      
      // If we have expected hash, verify it
      if (expectedHash) {
        const actualHash = sha256(data);
        return actualHash === expectedHash;
      }
      
      // Otherwise just verify we got data
      return data.length > 0;
    } catch (error) {
      logger.error("Pin verification error:", error);
      return false;
    }
  }
  
  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(provider: StorageProvider, cid: Cid): string {
    switch (provider) {
      case "4everland":
        return `${PINNING_CONFIG.foureverland.gateway}/${cid}`;
      case "pinata":
        return `${PINNING_CONFIG.pinata.gateway}/${cid}`;
      case "web3_storage":
        return `https://w3s.link/ipfs/${cid}`;
      case "ipfs_local":
        return `http://127.0.0.1:8080/ipfs/${cid}`;
      case "ipfs_remote":
        return `https://ipfs.io/ipfs/${cid}`;
      default:
        return `https://ipfs.io/ipfs/${cid}`;
    }
  }
  
  /**
   * Unpin content from a provider
   */
  async unpin(provider: StorageProvider, cid: Cid): Promise<{ success: boolean; error?: string }> {
    try {
      switch (provider) {
        case "pinata":
          if (!this.credentials.pinata) {
            throw new Error("Pinata credentials not configured");
          }
          const response = await fetch(`${PINNING_CONFIG.pinata.apiUrl}/pinning/unpin/${cid}`, {
            method: "DELETE",
            headers: {
              "pinata_api_key": this.credentials.pinata.apiKey,
              "pinata_secret_api_key": this.credentials.pinata.secretKey,
            },
          });
          if (!response.ok) {
            throw new Error(`Unpin failed: ${response.status}`);
          }
          return { success: true };
          
        case "ipfs_local":
          const apiUrl = this.credentials.ipfsLocal?.apiUrl || "http://127.0.0.1:5001";
          const unpinResponse = await fetch(`${apiUrl}/api/v0/pin/rm?arg=${cid}`, {
            method: "POST",
          });
          if (!unpinResponse.ok) {
            throw new Error(`Unpin failed: ${unpinResponse.status}`);
          }
          return { success: true };
          
        default:
          return { success: false, error: `Unpin not supported for ${provider}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Check provider status
   */
  async checkStatus(provider: StorageProvider): Promise<StorageStatus> {
    const startTime = Date.now();
    
    try {
      switch (provider) {
        case "4everland":
          // Ping 4everland API
          const fourResponse = await fetch(`${PINNING_CONFIG.foureverland.apiUrl}/health`, {
            method: "GET",
          });
          return {
            provider,
            connected: fourResponse.ok,
            lastPingMs: Date.now() - startTime,
          };
          
        case "pinata":
          if (!this.credentials.pinata) {
            return { provider, connected: false };
          }
          const pinataResponse = await fetch(`${PINNING_CONFIG.pinata.apiUrl}/data/testAuthentication`, {
            headers: {
              "pinata_api_key": this.credentials.pinata.apiKey,
              "pinata_secret_api_key": this.credentials.pinata.secretKey,
            },
          });
          return {
            provider,
            connected: pinataResponse.ok,
            lastPingMs: Date.now() - startTime,
          };
          
        case "ipfs_local":
          const apiUrl = this.credentials.ipfsLocal?.apiUrl || "http://127.0.0.1:5001";
          const localResponse = await fetch(`${apiUrl}/api/v0/id`, { method: "POST" });
          return {
            provider,
            connected: localResponse.ok,
            lastPingMs: Date.now() - startTime,
          };
          
        default:
          return { provider, connected: false };
      }
    } catch (error) {
      return {
        provider,
        connected: false,
        lastPingMs: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Fetch content by CID
   */
  async fetch(cid: Cid, preferredProvider?: StorageProvider): Promise<Buffer | null> {
    const providers = preferredProvider 
      ? [preferredProvider, ...Object.keys(this.credentials).filter(p => p !== preferredProvider)]
      : ["4everland", "pinata", "web3_storage", "ipfs_local"] as StorageProvider[];
    
    for (const provider of providers) {
      try {
        const gatewayUrl = this.getGatewayUrl(provider as StorageProvider, cid);
        const response = await fetch(gatewayUrl);
        
        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
      } catch (error) {
        logger.debug(`Fetch from ${provider} failed:`, error);
      }
    }
    
    return null;
  }
  
  /**
   * Pin a file from filesystem
   */
  async pinFile(
    filePath: string,
    providers: StorageProvider[],
    options?: { name?: string; verify?: boolean }
  ): Promise<PinResult[]> {
    if (!await fs.pathExists(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const name = options?.name || path.basename(filePath);
    const hash = await sha256File(filePath);
    
    return this.pin({
      content: await fs.readFile(filePath),
      name,
      providers,
      verification: {
        enabled: options?.verify ?? true,
        expectedHash: hash,
        maxRetries: this.retryOptions.maxRetries,
      },
    });
  }
  
  /**
   * Pin JSON data
   */
  async pinJson(
    data: unknown,
    providers: StorageProvider[],
    options?: { name?: string; verify?: boolean }
  ): Promise<PinResult[]> {
    const json = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(json, "utf8");
    const name = options?.name || `json-${Date.now()}.json`;
    
    return this.pin({
      content: buffer,
      name,
      providers,
      verification: {
        enabled: options?.verify ?? true,
        expectedHash: sha256(buffer),
        maxRetries: this.retryOptions.maxRetries,
      },
    });
  }
}

// Export singleton instance
export const jcnStorageAdapter = new JcnStorageAdapter();
