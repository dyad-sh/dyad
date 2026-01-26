/**
 * JCN Bundle Builder Service
 * Creates deterministic, verifiable bundles from assets.
 * 
 * Features:
 * - Canonical tar format with stable ordering
 * - Deterministic manifest.json generation
 * - Merkle tree computation over chunks/files
 * - Publisher signature generation
 */

import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import * as tar from "tar";
import log from "electron-log";
import { ethers } from "ethers";

import type {
  BundleType,
  BundleFile,
  BundleChunk,
  BundleManifest,
  BundleVerification,
  MerkleRoot,
  Sha256Hash,
  WalletAddress,
  StoreId,
} from "@/types/jcn_types";

const logger = log.scope("jcn_bundle_builder");

// Constants
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MANIFEST_VERSION = "1.0.0" as const;

// =============================================================================
// MERKLE TREE UTILITIES
// =============================================================================

/**
 * Compute SHA256 hash of data
 */
export function sha256(data: Buffer | string): Sha256Hash {
  return crypto
    .createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
    .digest("hex");
}

/**
 * Compute SHA256 hash of a file
 */
export async function sha256File(filePath: string): Promise<Sha256Hash> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Compute Merkle root from an array of hashes
 * Uses simple binary Merkle tree construction
 */
export function computeMerkleRoot(hashes: Sha256Hash[]): MerkleRoot {
  if (hashes.length === 0) {
    return sha256("");
  }
  
  if (hashes.length === 1) {
    return hashes[0];
  }
  
  // Pad to even length by duplicating last hash
  let level = [...hashes];
  if (level.length % 2 !== 0) {
    level.push(level[level.length - 1]);
  }
  
  // Build tree bottom-up
  while (level.length > 1) {
    const nextLevel: Sha256Hash[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const combined = level[i] + level[i + 1];
      nextLevel.push(sha256(combined));
    }
    level = nextLevel;
    if (level.length > 1 && level.length % 2 !== 0) {
      level.push(level[level.length - 1]);
    }
  }
  
  return level[0];
}

/**
 * Generate Merkle proof for a specific leaf
 */
export function generateMerkleProof(
  hashes: Sha256Hash[],
  leafIndex: number
): { proof: Sha256Hash[]; root: MerkleRoot } {
  if (leafIndex >= hashes.length) {
    throw new Error("Leaf index out of bounds");
  }
  
  const proof: Sha256Hash[] = [];
  let level = [...hashes];
  let index = leafIndex;
  
  if (level.length % 2 !== 0) {
    level.push(level[level.length - 1]);
  }
  
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(level[siblingIndex]);
    
    const nextLevel: Sha256Hash[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const combined = level[i] + level[i + 1];
      nextLevel.push(sha256(combined));
    }
    
    level = nextLevel;
    index = Math.floor(index / 2);
    
    if (level.length > 1 && level.length % 2 !== 0) {
      level.push(level[level.length - 1]);
    }
  }
  
  return { proof, root: level[0] };
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  leafHash: Sha256Hash,
  proof: Sha256Hash[],
  root: MerkleRoot,
  leafIndex: number
): boolean {
  let hash = leafHash;
  let index = leafIndex;
  
  for (const sibling of proof) {
    if (index % 2 === 0) {
      hash = sha256(hash + sibling);
    } else {
      hash = sha256(sibling + hash);
    }
    index = Math.floor(index / 2);
  }
  
  return hash === root;
}

// =============================================================================
// BUNDLE BUILDER
// =============================================================================

export interface BuildBundleOptions {
  /** Source directory path */
  sourcePath: string;
  /** Bundle type */
  bundleType: BundleType;
  /** Bundle name */
  name: string;
  /** Bundle version */
  version: string;
  /** Description */
  description?: string;
  /** Creator wallet address */
  creator: WalletAddress;
  /** Store ID */
  storeId?: StoreId;
  /** Entry point (for agents) */
  entryPoint?: string;
  /** License type */
  license: string;
  /** License URL */
  licenseUrl?: string;
  /** Dependencies */
  dependencies?: Record<string, string>;
  /** Runtime requirements */
  runtime?: {
    minMemoryMb?: number;
    minCpuCores?: number;
    gpuRequired?: boolean;
    gpuMemoryMb?: number;
  };
  /** Output directory */
  outputDir: string;
  /** Enable chunking */
  enableChunking?: boolean;
  /** Chunk size override */
  chunkSize?: number;
}

export interface BuildBundleResult {
  /** Bundle tar file path */
  bundlePath: string;
  /** Manifest */
  manifest: BundleManifest;
  /** Manifest JSON path */
  manifestPath: string;
  /** Merkle root */
  merkleRoot: MerkleRoot;
  /** Manifest hash */
  manifestHash: Sha256Hash;
  /** Total size */
  totalSize: number;
  /** Chunk paths (if chunked) */
  chunkPaths?: string[];
}

/**
 * JCN Bundle Builder Service
 */
export class JcnBundleBuilder {
  /**
   * Build a bundle from source directory
   */
  async buildBundle(options: BuildBundleOptions): Promise<BuildBundleResult> {
    logger.info("Building bundle", { 
      name: options.name, 
      type: options.bundleType,
      source: options.sourcePath 
    });
    
    // Validate source exists
    if (!await fs.pathExists(options.sourcePath)) {
      throw new Error(`Source path does not exist: ${options.sourcePath}`);
    }
    
    // Ensure output directory exists
    await fs.ensureDir(options.outputDir);
    
    // Collect and hash all files
    const files = await this.collectFiles(options.sourcePath);
    
    // Sort files by path for determinism
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    // Calculate total size
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    
    // Compute file hashes as leaves for Merkle tree
    const fileHashes = files.map((f) => f.sha256);
    const merkleRoot = computeMerkleRoot(fileHashes);
    
    // Create manifest (without hash first)
    const manifest: BundleManifest = {
      version: MANIFEST_VERSION,
      type: options.bundleType,
      name: options.name,
      bundleVersion: options.version,
      description: options.description,
      creator: options.creator,
      storeId: options.storeId,
      files,
      totalSize,
      entryPoint: options.entryPoint,
      dependencies: options.dependencies,
      runtime: options.runtime,
      license: {
        type: options.license,
        url: options.licenseUrl,
      },
      merkleRoot,
      createdAt: new Date().toISOString(),
    };
    
    // Compute manifest hash (canonical JSON, excluding manifestHash field)
    const manifestForHashing = { ...manifest };
    delete manifestForHashing.manifestHash;
    const canonicalJson = this.canonicalJsonStringify(manifestForHashing);
    const manifestHash = sha256(canonicalJson);
    manifest.manifestHash = manifestHash;
    
    // Write manifest
    const manifestPath = path.join(options.outputDir, "manifest.json");
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
    
    // Create tar bundle
    const bundlePath = path.join(options.outputDir, `${options.name}-${options.version}.tar`);
    await this.createTarBundle(options.sourcePath, manifestPath, bundlePath);
    
    // Optional: Create chunks
    let chunkPaths: string[] | undefined;
    if (options.enableChunking && totalSize > (options.chunkSize || CHUNK_SIZE)) {
      chunkPaths = await this.createChunks(
        bundlePath, 
        options.outputDir, 
        options.chunkSize || CHUNK_SIZE
      );
    }
    
    logger.info("Bundle built successfully", {
      name: options.name,
      merkleRoot,
      manifestHash,
      totalSize,
      fileCount: files.length,
    });
    
    return {
      bundlePath,
      manifest,
      manifestPath,
      merkleRoot,
      manifestHash,
      totalSize,
      chunkPaths,
    };
  }
  
  /**
   * Collect all files from source directory
   */
  private async collectFiles(sourcePath: string): Promise<BundleFile[]> {
    const files: BundleFile[] = [];
    
    const walk = async (dir: string, baseDir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
        
        if (entry.isDirectory()) {
          // Skip hidden directories and common excludes
          if (!entry.name.startsWith(".") && 
              entry.name !== "node_modules" &&
              entry.name !== "__pycache__") {
            await walk(fullPath, baseDir);
          }
        } else if (entry.isFile()) {
          // Skip hidden files
          if (!entry.name.startsWith(".")) {
            const stat = await fs.stat(fullPath);
            const hash = await sha256File(fullPath);
            const mimeType = this.getMimeType(entry.name);
            
            files.push({
              path: relativePath,
              sha256: hash,
              size: stat.size,
              mimeType,
              executable: (stat.mode & 0o111) !== 0,
            });
          }
        }
      }
    };
    
    await walk(sourcePath, sourcePath);
    return files;
  }
  
  /**
   * Create tar bundle with deterministic ordering
   */
  private async createTarBundle(
    sourcePath: string,
    manifestPath: string,
    outputPath: string
  ): Promise<void> {
    // Get all files sorted for determinism
    const files: string[] = [];
    
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && 
              entry.name !== "node_modules" &&
              entry.name !== "__pycache__") {
            await walk(fullPath);
          }
        } else if (entry.isFile() && !entry.name.startsWith(".")) {
          files.push(path.relative(sourcePath, fullPath).replace(/\\/g, "/"));
        }
      }
    };
    
    await walk(sourcePath);
    
    // Create tar with sorted files
    await tar.create(
      {
        file: outputPath,
        cwd: sourcePath,
        gzip: false, // Don't gzip for content-addressing
        portable: true, // Use portable format
        // Set fixed timestamps for determinism
        mtime: new Date("2020-01-01T00:00:00Z"),
      },
      files
    );
    
    // Append manifest to tar
    const manifestContent = await fs.readFile(manifestPath);
    const tempManifestDir = path.dirname(manifestPath);
    
    await tar.update(
      {
        file: outputPath,
        cwd: tempManifestDir,
        mtime: new Date("2020-01-01T00:00:00Z"),
      },
      ["manifest.json"]
    );
  }
  
  /**
   * Create chunks from bundle
   */
  private async createChunks(
    bundlePath: string,
    outputDir: string,
    chunkSize: number
  ): Promise<string[]> {
    const chunkPaths: string[] = [];
    const bundleData = await fs.readFile(bundlePath);
    
    let offset = 0;
    let index = 0;
    
    while (offset < bundleData.length) {
      const chunk = bundleData.subarray(offset, offset + chunkSize);
      const chunkPath = path.join(outputDir, `chunk-${index.toString().padStart(6, "0")}`);
      await fs.writeFile(chunkPath, chunk);
      chunkPaths.push(chunkPath);
      
      offset += chunkSize;
      index++;
    }
    
    logger.info("Created chunks", { count: chunkPaths.length, chunkSize });
    return chunkPaths;
  }
  
  /**
   * Get MIME type from filename
   */
  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".ts": "application/typescript",
      ".json": "application/json",
      ".py": "text/x-python",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".html": "text/html",
      ".css": "text/css",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
      ".bin": "application/octet-stream",
      ".onnx": "application/octet-stream",
      ".safetensors": "application/octet-stream",
      ".gguf": "application/octet-stream",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
  
  /**
   * Canonical JSON stringify (sorted keys, no whitespace)
   */
  private canonicalJsonStringify(obj: unknown): string {
    return JSON.stringify(obj, (_, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
      }
      return value;
    });
  }
  
  /**
   * Sign a manifest with EIP-191
   */
  async signManifest(
    manifest: BundleManifest,
    privateKey: string
  ): Promise<BundleManifest> {
    const wallet = new ethers.Wallet(privateKey);
    
    // Create signing message
    const message = `JCN Bundle Signature\n` +
      `Bundle: ${manifest.bundleCid || manifest.name}\n` +
      `Merkle Root: ${manifest.merkleRoot}\n` +
      `Manifest Hash: ${manifest.manifestHash}`;
    
    const signature = await wallet.signMessage(message);
    
    return {
      ...manifest,
      signature: {
        algorithm: "eip191",
        value: signature,
        signer: wallet.address as WalletAddress,
      },
    };
  }
  
  /**
   * Verify a bundle's integrity
   */
  async verifyBundle(
    bundlePath: string,
    manifest: BundleManifest
  ): Promise<BundleVerification> {
    const errors: string[] = [];
    let manifestHashValid = false;
    let merkleRootValid = false;
    let signatureValid = false;
    let allFilesPresent = false;
    let allChunksValid = true;
    
    try {
      // Verify manifest hash
      const manifestForHashing = { ...manifest };
      delete manifestForHashing.manifestHash;
      delete manifestForHashing.signature;
      const canonicalJson = this.canonicalJsonStringify(manifestForHashing);
      const computedHash = sha256(canonicalJson);
      manifestHashValid = computedHash === manifest.manifestHash;
      
      if (!manifestHashValid) {
        errors.push(`Manifest hash mismatch: expected ${manifest.manifestHash}, got ${computedHash}`);
      }
      
      // Extract and verify files
      const extractDir = path.join(path.dirname(bundlePath), ".verify-temp");
      await fs.ensureDir(extractDir);
      
      try {
        await tar.extract({
          file: bundlePath,
          cwd: extractDir,
        });
        
        // Verify each file
        const fileHashes: Sha256Hash[] = [];
        let missingFiles = 0;
        
        for (const file of manifest.files) {
          const filePath = path.join(extractDir, file.path);
          
          if (await fs.pathExists(filePath)) {
            const hash = await sha256File(filePath);
            fileHashes.push(hash);
            
            if (hash !== file.sha256) {
              errors.push(`File hash mismatch for ${file.path}: expected ${file.sha256}, got ${hash}`);
            }
          } else {
            missingFiles++;
            errors.push(`Missing file: ${file.path}`);
          }
        }
        
        allFilesPresent = missingFiles === 0;
        
        // Verify Merkle root
        if (allFilesPresent && fileHashes.length === manifest.files.length) {
          const computedRoot = computeMerkleRoot(fileHashes);
          merkleRootValid = computedRoot === manifest.merkleRoot;
          
          if (!merkleRootValid) {
            errors.push(`Merkle root mismatch: expected ${manifest.merkleRoot}, got ${computedRoot}`);
          }
        }
      } finally {
        // Cleanup
        await fs.remove(extractDir);
      }
      
      // Verify signature if present
      if (manifest.signature) {
        try {
          const message = `JCN Bundle Signature\n` +
            `Bundle: ${manifest.bundleCid || manifest.name}\n` +
            `Merkle Root: ${manifest.merkleRoot}\n` +
            `Manifest Hash: ${manifest.manifestHash}`;
          
          const recoveredAddress = ethers.verifyMessage(message, manifest.signature.value);
          signatureValid = recoveredAddress.toLowerCase() === manifest.signature.signer.toLowerCase();
          
          if (!signatureValid) {
            errors.push(`Signature verification failed: recovered ${recoveredAddress}, expected ${manifest.signature.signer}`);
          }
        } catch (err) {
          errors.push(`Signature verification error: ${err}`);
          signatureValid = false;
        }
      } else {
        signatureValid = true; // No signature to verify
      }
    } catch (err) {
      errors.push(`Verification error: ${err}`);
    }
    
    return {
      valid: manifestHashValid && merkleRootValid && signatureValid && allFilesPresent && allChunksValid,
      manifestHashValid,
      merkleRootValid,
      signatureValid,
      allFilesPresent,
      allChunksValid,
      errors,
    };
  }
}

// Export singleton instance
export const jcnBundleBuilder = new JcnBundleBuilder();
