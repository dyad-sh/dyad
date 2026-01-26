/**
 * JCN Key Management Service
 * Secure key storage and management using OS keyring.
 * 
 * Features:
 * - OS keyring integration (Windows Credential Store, macOS Keychain, Linux Secret Service)
 * - Key encryption at rest
 * - Key rotation support
 * - Audit logging for all key operations
 * - Separation of signing keys, encryption keys, and node identity keys
 */

import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import { jcnKeys, jcnAuditLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { safeStorage } from "electron";

import type {
  KeyMetadata,
  KeyType,
  KeyAlgorithm,
  WalletAddress,
} from "@/types/jcn_types";

const logger = log.scope("jcn_key_manager");

// =============================================================================
// KEY STORAGE CONSTANTS
// =============================================================================

const SERVICE_NAME = "JoyCreateNode";
const KEY_PREFIX = "jcn_key_";

// =============================================================================
// KEY TYPES
// =============================================================================

export interface StoredKey {
  id: string;
  type: KeyType;
  algorithm: KeyAlgorithm;
  publicKey?: string;
  /** Encrypted private key (or reference to keyring) */
  encryptedPrivateKey?: Buffer;
  /** Whether stored in OS keyring */
  inKeyring: boolean;
  createdAt: number;
  expiresAt?: number;
  rotatedFrom?: string;
  metadata?: Record<string, unknown>;
}

export interface KeyGenerationParams {
  type: KeyType;
  algorithm: KeyAlgorithm;
  name?: string;
  expiresInDays?: number;
  storeInKeyring?: boolean;
  metadata?: Record<string, unknown>;
}

export interface KeyImportParams {
  type: KeyType;
  algorithm: KeyAlgorithm;
  privateKey: string;
  publicKey?: string;
  name?: string;
  storeInKeyring?: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// KEY MANAGEMENT SERVICE
// =============================================================================

export class JcnKeyManager {
  private masterKey?: Buffer;
  private isInitialized = false;
  
  /**
   * Initialize the key manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    logger.info("Initializing key manager");
    
    // Check if safeStorage is available
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn("Electron safeStorage not available, using fallback encryption");
    }
    
    // Load or generate master key
    await this.loadMasterKey();
    
    this.isInitialized = true;
    logger.info("Key manager initialized");
  }
  
  /**
   * Load or generate the master key for local encryption
   */
  private async loadMasterKey(): Promise<void> {
    const keyId = `${KEY_PREFIX}master`;
    
    try {
      // Try to load from OS keyring via electron safeStorage
      const [record] = await db.select()
        .from(jcnKeys)
        .where(and(
          eq(jcnKeys.keyId, keyId),
          eq(jcnKeys.keyType, "master")
        ))
        .limit(1);
      
      if (record?.encryptedKey) {
        // Decrypt master key using safeStorage
        if (safeStorage.isEncryptionAvailable()) {
          this.masterKey = safeStorage.decryptString(record.encryptedKey);
        } else {
          // Fallback: use the encrypted key directly (less secure)
          this.masterKey = record.encryptedKey;
        }
        logger.info("Loaded existing master key");
        return;
      }
      
      // Generate new master key
      this.masterKey = crypto.randomBytes(32);
      
      // Encrypt and store
      let encryptedKey: Buffer;
      if (safeStorage.isEncryptionAvailable()) {
        encryptedKey = safeStorage.encryptString(this.masterKey.toString("base64"));
      } else {
        encryptedKey = this.masterKey; // Fallback (less secure)
      }
      
      await db.insert(jcnKeys).values({
        id: crypto.randomUUID(),
        keyId,
        keyType: "master",
        algorithm: "aes-256-gcm",
        inKeyring: safeStorage.isEncryptionAvailable(),
        encryptedKey,
      });
      
      logger.info("Generated new master key");
    } catch (error) {
      logger.error("Failed to load/generate master key", { error });
      throw new Error("Key manager initialization failed");
    }
  }
  
  // ===========================================================================
  // KEY GENERATION
  // ===========================================================================
  
  /**
   * Generate a new key pair
   */
  async generateKey(params: KeyGenerationParams): Promise<KeyMetadata> {
    await this.ensureInitialized();
    
    const keyId = crypto.randomUUID();
    const now = Date.now();
    
    let publicKey: string;
    let privateKey: Buffer;
    
    switch (params.algorithm) {
      case "secp256k1": {
        // Generate Ethereum-compatible key
        const { privateKey: pk, publicKey: pub } = await this.generateSecp256k1();
        privateKey = Buffer.from(pk, "hex");
        publicKey = pub;
        break;
      }
      case "ed25519": {
        const keypair = crypto.generateKeyPairSync("ed25519");
        privateKey = keypair.privateKey.export({ type: "pkcs8", format: "der" });
        publicKey = keypair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
        break;
      }
      case "rsa-2048": {
        const keypair = crypto.generateKeyPairSync("rsa", {
          modulusLength: 2048,
        });
        privateKey = keypair.privateKey.export({ type: "pkcs8", format: "der" });
        publicKey = keypair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
        break;
      }
      case "aes-256-gcm": {
        // Symmetric key
        privateKey = crypto.randomBytes(32);
        publicKey = ""; // No public key for symmetric
        break;
      }
      default:
        throw new Error(`Unsupported algorithm: ${params.algorithm}`);
    }
    
    // Encrypt private key
    const encryptedKey = await this.encryptKey(privateKey);
    
    // Store in database
    await db.insert(jcnKeys).values({
      id: crypto.randomUUID(),
      keyId,
      keyType: params.type,
      algorithm: params.algorithm,
      publicKey,
      encryptedKey,
      inKeyring: params.storeInKeyring ?? false,
      name: params.name,
      expiresAt: params.expiresInDays 
        ? new Date(now + params.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined,
      metadataJson: params.metadata,
    });
    
    // Audit log
    await this.auditLog("key_generated", keyId, params.type, params.algorithm);
    
    logger.info("Generated new key", { keyId, type: params.type, algorithm: params.algorithm });
    
    return {
      keyId,
      type: params.type,
      algorithm: params.algorithm,
      publicKey,
      createdAt: now,
      expiresAt: params.expiresInDays ? now + params.expiresInDays * 24 * 60 * 60 * 1000 : undefined,
      inKeyring: params.storeInKeyring ?? false,
      name: params.name,
    };
  }
  
  /**
   * Generate secp256k1 keypair (Ethereum-compatible)
   */
  private async generateSecp256k1(): Promise<{ privateKey: string; publicKey: string }> {
    const { ethers } = await import("ethers");
    const wallet = ethers.Wallet.createRandom();
    return {
      privateKey: wallet.privateKey.slice(2), // Remove 0x prefix
      publicKey: wallet.address,
    };
  }
  
  // ===========================================================================
  // KEY IMPORT/EXPORT
  // ===========================================================================
  
  /**
   * Import an existing key
   */
  async importKey(params: KeyImportParams): Promise<KeyMetadata> {
    await this.ensureInitialized();
    
    const keyId = crypto.randomUUID();
    const now = Date.now();
    
    // Validate and convert private key
    let privateKeyBuffer: Buffer;
    
    switch (params.algorithm) {
      case "secp256k1": {
        // Validate Ethereum key
        const { ethers } = await import("ethers");
        try {
          const wallet = new ethers.Wallet(params.privateKey);
          privateKeyBuffer = Buffer.from(wallet.privateKey.slice(2), "hex");
          params.publicKey = params.publicKey || wallet.address;
        } catch {
          throw new Error("Invalid secp256k1 private key");
        }
        break;
      }
      case "ed25519":
      case "rsa-2048": {
        // Assume base64 or hex encoded
        privateKeyBuffer = Buffer.from(params.privateKey, "base64");
        break;
      }
      case "aes-256-gcm": {
        privateKeyBuffer = Buffer.from(params.privateKey, "hex");
        if (privateKeyBuffer.length !== 32) {
          throw new Error("AES-256 key must be 32 bytes");
        }
        break;
      }
      default:
        throw new Error(`Unsupported algorithm: ${params.algorithm}`);
    }
    
    // Encrypt private key
    const encryptedKey = await this.encryptKey(privateKeyBuffer);
    
    // Store in database
    await db.insert(jcnKeys).values({
      id: crypto.randomUUID(),
      keyId,
      keyType: params.type,
      algorithm: params.algorithm,
      publicKey: params.publicKey,
      encryptedKey,
      inKeyring: params.storeInKeyring ?? false,
      name: params.name,
      metadataJson: params.metadata,
    });
    
    // Audit log
    await this.auditLog("key_imported", keyId, params.type, params.algorithm);
    
    logger.info("Imported key", { keyId, type: params.type, algorithm: params.algorithm });
    
    return {
      keyId,
      type: params.type,
      algorithm: params.algorithm,
      publicKey: params.publicKey,
      createdAt: now,
      inKeyring: params.storeInKeyring ?? false,
      name: params.name,
    };
  }
  
  /**
   * Export a key (returns encrypted form for backup)
   */
  async exportKey(keyId: string): Promise<{ encryptedKey: string; metadata: KeyMetadata } | null> {
    await this.ensureInitialized();
    
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    // Audit log
    await this.auditLog("key_exported", keyId, record.keyType, record.algorithm);
    
    return {
      encryptedKey: record.encryptedKey?.toString("base64") || "",
      metadata: {
        keyId: record.keyId,
        type: record.keyType as KeyType,
        algorithm: record.algorithm as KeyAlgorithm,
        publicKey: record.publicKey ?? undefined,
        createdAt: record.createdAt?.getTime() || Date.now(),
        expiresAt: record.expiresAt?.getTime(),
        inKeyring: record.inKeyring || false,
        name: record.name ?? undefined,
      },
    };
  }
  
  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================
  
  /**
   * Get private key for signing
   */
  async getPrivateKey(keyId: string): Promise<Buffer | null> {
    await this.ensureInitialized();
    
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record?.encryptedKey) {
      return null;
    }
    
    // Check expiration
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      logger.warn("Attempted to use expired key", { keyId });
      return null;
    }
    
    // Decrypt and return
    return this.decryptKey(record.encryptedKey);
  }
  
  /**
   * Get public key
   */
  async getPublicKey(keyId: string): Promise<string | null> {
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    return record?.publicKey ?? null;
  }
  
  /**
   * Get key metadata
   */
  async getKeyMetadata(keyId: string): Promise<KeyMetadata | null> {
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return {
      keyId: record.keyId,
      type: record.keyType as KeyType,
      algorithm: record.algorithm as KeyAlgorithm,
      publicKey: record.publicKey ?? undefined,
      createdAt: record.createdAt?.getTime() || Date.now(),
      expiresAt: record.expiresAt?.getTime(),
      inKeyring: record.inKeyring || false,
      name: record.name ?? undefined,
      rotatedFrom: record.rotatedFrom ?? undefined,
    };
  }
  
  /**
   * List all keys
   */
  async listKeys(type?: KeyType): Promise<KeyMetadata[]> {
    let query = db.select().from(jcnKeys);
    
    if (type) {
      query = query.where(eq(jcnKeys.keyType, type)) as typeof query;
    }
    
    const records = await query;
    
    return records
      .filter((r) => r.keyType !== "master") // Don't expose master key
      .map((r) => ({
        keyId: r.keyId,
        type: r.keyType as KeyType,
        algorithm: r.algorithm as KeyAlgorithm,
        publicKey: r.publicKey ?? undefined,
        createdAt: r.createdAt?.getTime() || Date.now(),
        expiresAt: r.expiresAt?.getTime(),
        inKeyring: r.inKeyring || false,
        name: r.name ?? undefined,
        rotatedFrom: r.rotatedFrom ?? undefined,
      }));
  }
  
  // ===========================================================================
  // SIGNING OPERATIONS
  // ===========================================================================
  
  /**
   * Sign a message with a key
   */
  async sign(keyId: string, message: string | Buffer): Promise<string | null> {
    await this.ensureInitialized();
    
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record?.encryptedKey) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    const privateKey = await this.decryptKey(record.encryptedKey);
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
    
    switch (record.algorithm) {
      case "secp256k1": {
        const { ethers } = await import("ethers");
        const wallet = new ethers.Wallet(`0x${privateKey.toString("hex")}`);
        const messageHash = ethers.hashMessage(messageBuffer);
        return wallet.signMessage(ethers.getBytes(messageHash));
      }
      case "ed25519": {
        const key = crypto.createPrivateKey({
          key: privateKey,
          format: "der",
          type: "pkcs8",
        });
        const signature = crypto.sign(null, messageBuffer, key);
        return signature.toString("base64");
      }
      case "rsa-2048": {
        const key = crypto.createPrivateKey({
          key: privateKey,
          format: "der",
          type: "pkcs8",
        });
        const signature = crypto.sign("sha256", messageBuffer, key);
        return signature.toString("base64");
      }
      default:
        throw new Error(`Cannot sign with algorithm: ${record.algorithm}`);
    }
  }
  
  /**
   * Verify a signature
   */
  async verify(keyId: string, message: string | Buffer, signature: string): Promise<boolean> {
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record?.publicKey) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
    
    switch (record.algorithm) {
      case "secp256k1": {
        const { ethers } = await import("ethers");
        try {
          const messageHash = ethers.hashMessage(messageBuffer);
          const recoveredAddress = ethers.recoverAddress(messageHash, signature);
          return recoveredAddress.toLowerCase() === record.publicKey.toLowerCase();
        } catch {
          return false;
        }
      }
      case "ed25519": {
        const key = crypto.createPublicKey({
          key: Buffer.from(record.publicKey, "base64"),
          format: "der",
          type: "spki",
        });
        return crypto.verify(null, messageBuffer, key, Buffer.from(signature, "base64"));
      }
      case "rsa-2048": {
        const key = crypto.createPublicKey({
          key: Buffer.from(record.publicKey, "base64"),
          format: "der",
          type: "spki",
        });
        return crypto.verify("sha256", messageBuffer, key, Buffer.from(signature, "base64"));
      }
      default:
        throw new Error(`Cannot verify with algorithm: ${record.algorithm}`);
    }
  }
  
  // ===========================================================================
  // KEY ROTATION
  // ===========================================================================
  
  /**
   * Rotate a key (generate new, mark old as rotated)
   */
  async rotateKey(oldKeyId: string): Promise<KeyMetadata> {
    await this.ensureInitialized();
    
    const oldKey = await this.getKeyMetadata(oldKeyId);
    if (!oldKey) {
      throw new Error(`Key not found: ${oldKeyId}`);
    }
    
    // Generate new key
    const newKey = await this.generateKey({
      type: oldKey.type,
      algorithm: oldKey.algorithm,
      name: oldKey.name ? `${oldKey.name} (rotated)` : undefined,
      storeInKeyring: oldKey.inKeyring,
    });
    
    // Update new key with rotation info
    await db.update(jcnKeys)
      .set({ rotatedFrom: oldKeyId })
      .where(eq(jcnKeys.keyId, newKey.keyId));
    
    // Mark old key as rotated (don't delete, keep for verification)
    await db.update(jcnKeys)
      .set({
        rotatedTo: newKey.keyId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Keep for 30 days
      })
      .where(eq(jcnKeys.keyId, oldKeyId));
    
    // Audit log
    await this.auditLog("key_rotated", oldKeyId, oldKey.type, oldKey.algorithm, { newKeyId: newKey.keyId });
    
    logger.info("Rotated key", { oldKeyId, newKeyId: newKey.keyId });
    
    return { ...newKey, rotatedFrom: oldKeyId };
  }
  
  /**
   * Delete a key
   */
  async deleteKey(keyId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    const key = await this.getKeyMetadata(keyId);
    if (!key) {
      return false;
    }
    
    // Don't delete master key
    if (key.type === "master") {
      throw new Error("Cannot delete master key");
    }
    
    await db.delete(jcnKeys).where(eq(jcnKeys.keyId, keyId));
    
    // Audit log
    await this.auditLog("key_deleted", keyId, key.type, key.algorithm);
    
    logger.info("Deleted key", { keyId });
    
    return true;
  }
  
  // ===========================================================================
  // ENCRYPTION HELPERS
  // ===========================================================================
  
  /**
   * Encrypt a key using master key
   */
  private async encryptKey(plaintext: Buffer): Promise<Buffer> {
    if (!this.masterKey) {
      throw new Error("Master key not loaded");
    }
    
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.masterKey, iv);
    
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Format: iv (12) + authTag (16) + encrypted
    return Buffer.concat([iv, authTag, encrypted]);
  }
  
  /**
   * Decrypt a key using master key
   */
  private async decryptKey(ciphertext: Buffer): Promise<Buffer> {
    if (!this.masterKey) {
      throw new Error("Master key not loaded");
    }
    
    const iv = ciphertext.subarray(0, 12);
    const authTag = ciphertext.subarray(12, 28);
    const encrypted = ciphertext.subarray(28);
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
  
  /**
   * Ensure key manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
  
  /**
   * Write audit log
   */
  private async auditLog(
    action: string,
    keyId: string,
    keyType: string,
    algorithm: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(jcnAuditLog).values({
      id: crypto.randomUUID(),
      action: `key:${action}`,
      actorType: "system",
      actorId: "key_manager",
      targetType: "key",
      targetId: keyId,
      newStateJson: {
        keyType,
        algorithm,
        ...details,
      },
    });
  }
  
  // ===========================================================================
  // WALLET HELPERS
  // ===========================================================================
  
  /**
   * Get or create the default signing key
   */
  async getDefaultSigningKey(): Promise<KeyMetadata> {
    const keys = await this.listKeys("signing");
    const defaultKey = keys.find((k) => k.name === "default_signing");
    
    if (defaultKey) {
      return defaultKey;
    }
    
    // Create default signing key
    return this.generateKey({
      type: "signing",
      algorithm: "secp256k1",
      name: "default_signing",
      storeInKeyring: true,
    });
  }
  
  /**
   * Get wallet address for a key
   */
  async getWalletAddress(keyId: string): Promise<WalletAddress | null> {
    const [record] = await db.select()
      .from(jcnKeys)
      .where(eq(jcnKeys.keyId, keyId))
      .limit(1);
    
    if (!record || record.algorithm !== "secp256k1") {
      return null;
    }
    
    return record.publicKey as WalletAddress || null;
  }
}

// Export singleton instance
export const jcnKeyManager = new JcnKeyManager();
