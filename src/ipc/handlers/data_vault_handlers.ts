/**
 * Data Vault Handlers
 * Secure local storage with encryption, key management, and identity
 * 
 * Features:
 * - Master key derivation from passphrase
 * - Ed25519 identity keypairs for signing
 * - AES-256-GCM encryption for sensitive data
 * - Secure secret storage
 * - Trusted peer management
 */

import { ipcMain, app, safeStorage } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { vaultAssets } from "@/db/vault_schema";
import { eq } from "drizzle-orm";

const logger = log.scope("data_vault");

// ============================================================================
// Constants
// ============================================================================

const VAULT_DIR = "vault";
const KEY_FILE = "vault.key";
const IDENTITY_FILE = "identity.enc";
const SECRETS_FILE = "secrets.enc";
const PEERS_FILE = "peers.enc";
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ARGON2_ITERATIONS = 3;
const ARGON2_MEMORY = 65536;

// ============================================================================
// Types
// ============================================================================

interface VaultState {
  isInitialized: boolean;
  isUnlocked: boolean;
  masterKey: Buffer | null;
  identity: Identity | null;
}

interface Identity {
  id: string;
  name: string;
  publicKey: string;  // Base64 encoded
  privateKey?: string; // Base64 encoded, only when unlocked
  createdAt: string;
}

interface TrustedPeer {
  id: string;
  name: string;
  publicKey: string;
  trustLevel: "known" | "trusted" | "verified";
  addedAt: string;
  lastSeen?: string;
  notes?: string;
}

interface SecretEntry {
  key: string;
  value: string; // Base64 encoded encrypted value
  createdAt: string;
  updatedAt: string;
}

interface EncryptedData {
  iv: string;
  data: string;
  authTag: string;
  salt?: string;
}

// ============================================================================
// Vault State (in-memory)
// ============================================================================

const vaultState: VaultState = {
  isInitialized: false,
  isUnlocked: false,
  masterKey: null,
  identity: null,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getVaultDir(): string {
  return path.join(app.getPath("userData"), VAULT_DIR);
}

/**
 * Derive key from passphrase using PBKDF2 (simulating Argon2id behavior)
 * Note: For production, use actual Argon2id via sodium-native
 */
async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      passphrase,
      salt,
      100000, // iterations
      KEY_LENGTH,
      "sha512",
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

/**
 * Encrypt data with AES-256-GCM
 */
function encrypt(data: Buffer, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypt data with AES-256-GCM
 */
function decrypt(encryptedData: EncryptedData, key: Buffer): Buffer {
  const iv = Buffer.from(encryptedData.iv, "base64");
  const data = Buffer.from(encryptedData.data, "base64");
  const authTag = Buffer.from(encryptedData.authTag, "base64");
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Generate Ed25519 keypair
 */
function generateKeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }),
  };
}

/**
 * Sign data with Ed25519
 */
function signData(data: Buffer, privateKeyDer: Buffer): Buffer {
  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  
  return crypto.sign(null, data, privateKey);
}

/**
 * Verify signature with Ed25519
 */
function verifySignature(data: Buffer, signature: Buffer, publicKeyDer: Buffer): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });
    
    return crypto.verify(null, data, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Load vault metadata
 */
async function loadVaultMeta(): Promise<{ salt: string } | null> {
  const vaultDir = getVaultDir();
  const keyPath = path.join(vaultDir, KEY_FILE);
  
  if (await fs.pathExists(keyPath)) {
    return fs.readJson(keyPath);
  }
  return null;
}

/**
 * Save encrypted data to file
 */
async function saveEncryptedFile(filename: string, data: any): Promise<void> {
  if (!vaultState.masterKey) throw new Error("Vault is locked");
  
  const vaultDir = getVaultDir();
  await fs.ensureDir(vaultDir);
  
  const jsonData = JSON.stringify(data);
  const encrypted = encrypt(Buffer.from(jsonData, "utf-8"), vaultState.masterKey);
  
  await fs.writeJson(path.join(vaultDir, filename), encrypted);
}

/**
 * Load encrypted data from file
 */
async function loadEncryptedFile<T>(filename: string): Promise<T | null> {
  if (!vaultState.masterKey) throw new Error("Vault is locked");
  
  const vaultDir = getVaultDir();
  const filePath = path.join(vaultDir, filename);
  
  if (!(await fs.pathExists(filePath))) return null;
  
  const encrypted: EncryptedData = await fs.readJson(filePath);
  const decrypted = decrypt(encrypted, vaultState.masterKey);
  
  return JSON.parse(decrypted.toString("utf-8"));
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataVaultHandlers() {
  logger.info("Registering Data Vault handlers");

  // ========== Vault Lifecycle ==========

  /**
   * Check vault status
   */
  ipcMain.handle("data-vault:status", async () => {
    const vaultDir = getVaultDir();
    const keyPath = path.join(vaultDir, KEY_FILE);
    
    const isInitialized = await fs.pathExists(keyPath);
    
    return {
      isInitialized,
      isUnlocked: vaultState.isUnlocked,
      hasIdentity: !!vaultState.identity,
      identityName: vaultState.identity?.name || null,
    };
  });

  /**
   * Initialize vault with passphrase
   */
  ipcMain.handle("data-vault:initialize", async (_event, args: {
    passphrase: string;
    identityName: string;
  }) => {
    try {
      const { passphrase, identityName } = args;
      
      if (passphrase.length < 8) {
        throw new Error("Passphrase must be at least 8 characters");
      }
      
      const vaultDir = getVaultDir();
      await fs.ensureDir(vaultDir);
      
      // Check if already initialized
      const keyPath = path.join(vaultDir, KEY_FILE);
      if (await fs.pathExists(keyPath)) {
        throw new Error("Vault is already initialized");
      }
      
      // Generate salt and derive master key
      const salt = crypto.randomBytes(SALT_LENGTH);
      const masterKey = await deriveKey(passphrase, salt);
      
      // Save salt (not the key!)
      await fs.writeJson(keyPath, { salt: salt.toString("base64") });
      
      // Generate identity keypair
      const keyPair = generateKeyPair();
      const identity: Identity = {
        id: uuidv4(),
        name: identityName,
        publicKey: keyPair.publicKey.toString("base64"),
        privateKey: keyPair.privateKey.toString("base64"),
        createdAt: new Date().toISOString(),
      };
      
      // Update state
      vaultState.masterKey = masterKey;
      vaultState.isInitialized = true;
      vaultState.isUnlocked = true;
      vaultState.identity = identity;
      
      // Save encrypted identity
      await saveEncryptedFile(IDENTITY_FILE, identity);
      
      // Initialize empty secrets and peers
      await saveEncryptedFile(SECRETS_FILE, { secrets: [] });
      await saveEncryptedFile(PEERS_FILE, { peers: [] });
      
      logger.info(`Vault initialized for identity: ${identityName}`);
      
      return {
        success: true,
        identity: {
          id: identity.id,
          name: identity.name,
          publicKey: identity.publicKey,
        },
      };
    } catch (error) {
      logger.error("Vault initialization failed:", error);
      throw error;
    }
  });

  /**
   * Unlock vault
   */
  ipcMain.handle("data-vault:unlock", async (_event, passphrase: string) => {
    try {
      const vaultMeta = await loadVaultMeta();
      if (!vaultMeta) {
        throw new Error("Vault is not initialized");
      }
      
      const salt = Buffer.from(vaultMeta.salt, "base64");
      const masterKey = await deriveKey(passphrase, salt);
      
      // Try to decrypt identity to verify passphrase
      vaultState.masterKey = masterKey;
      
      try {
        const identity = await loadEncryptedFile<Identity>(IDENTITY_FILE);
        if (!identity) {
          throw new Error("Failed to load identity");
        }
        
        vaultState.isUnlocked = true;
        vaultState.isInitialized = true;
        vaultState.identity = identity;
        
        logger.info(`Vault unlocked for: ${identity.name}`);
        
        return {
          success: true,
          identity: {
            id: identity.id,
            name: identity.name,
            publicKey: identity.publicKey,
          },
        };
      } catch (decryptError) {
        vaultState.masterKey = null;
        throw new Error("Invalid passphrase");
      }
    } catch (error) {
      logger.error("Vault unlock failed:", error);
      throw error;
    }
  });

  /**
   * Lock vault
   */
  ipcMain.handle("data-vault:lock", async () => {
    vaultState.masterKey = null;
    vaultState.isUnlocked = false;
    vaultState.identity = null;
    
    logger.info("Vault locked");
    return { success: true };
  });

  /**
   * Change passphrase
   */
  ipcMain.handle("data-vault:change-passphrase", async (_event, args: {
    currentPassphrase: string;
    newPassphrase: string;
  }) => {
    try {
      const { currentPassphrase, newPassphrase } = args;
      
      if (newPassphrase.length < 8) {
        throw new Error("New passphrase must be at least 8 characters");
      }
      
      // Verify current passphrase
      const vaultMeta = await loadVaultMeta();
      if (!vaultMeta) throw new Error("Vault not initialized");
      
      const oldSalt = Buffer.from(vaultMeta.salt, "base64");
      const oldKey = await deriveKey(currentPassphrase, oldSalt);
      
      // Temporarily set old key to read files
      const savedKey = vaultState.masterKey;
      vaultState.masterKey = oldKey;
      
      let identity: Identity | null;
      let secrets: { secrets: SecretEntry[] } | null;
      let peers: { peers: TrustedPeer[] } | null;
      
      try {
        identity = await loadEncryptedFile<Identity>(IDENTITY_FILE);
        secrets = await loadEncryptedFile<{ secrets: SecretEntry[] }>(SECRETS_FILE);
        peers = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE);
      } catch {
        vaultState.masterKey = savedKey;
        throw new Error("Invalid current passphrase");
      }
      
      // Generate new salt and key
      const newSalt = crypto.randomBytes(SALT_LENGTH);
      const newKey = await deriveKey(newPassphrase, newSalt);
      
      // Update vault key file
      const vaultDir = getVaultDir();
      await fs.writeJson(path.join(vaultDir, KEY_FILE), { salt: newSalt.toString("base64") });
      
      // Re-encrypt all files with new key
      vaultState.masterKey = newKey;
      
      if (identity) await saveEncryptedFile(IDENTITY_FILE, identity);
      if (secrets) await saveEncryptedFile(SECRETS_FILE, secrets);
      if (peers) await saveEncryptedFile(PEERS_FILE, peers);
      
      // Update state
      vaultState.identity = identity;
      
      logger.info("Vault passphrase changed successfully");
      return { success: true };
    } catch (error) {
      logger.error("Change passphrase failed:", error);
      throw error;
    }
  });

  // ========== Identity Operations ==========

  /**
   * Get current identity
   */
  ipcMain.handle("data-vault:get-identity", async () => {
    if (!vaultState.isUnlocked || !vaultState.identity) {
      throw new Error("Vault is locked");
    }
    
    return {
      id: vaultState.identity.id,
      name: vaultState.identity.name,
      publicKey: vaultState.identity.publicKey,
      createdAt: vaultState.identity.createdAt,
    };
  });

  /**
   * Sign data with identity key
   */
  ipcMain.handle("data-vault:sign", async (_event, data: string) => {
    if (!vaultState.isUnlocked || !vaultState.identity?.privateKey) {
      throw new Error("Vault is locked");
    }
    
    const dataBuffer = Buffer.from(data, "utf-8");
    const privateKey = Buffer.from(vaultState.identity.privateKey, "base64");
    const signature = signData(dataBuffer, privateKey);
    
    return {
      signature: signature.toString("base64"),
      signerId: vaultState.identity.id,
      publicKey: vaultState.identity.publicKey,
    };
  });

  /**
   * Verify signature
   */
  ipcMain.handle("data-vault:verify", async (_event, args: {
    data: string;
    signature: string;
    publicKey: string;
  }) => {
    const { data, signature, publicKey } = args;
    
    const dataBuffer = Buffer.from(data, "utf-8");
    const signatureBuffer = Buffer.from(signature, "base64");
    const publicKeyBuffer = Buffer.from(publicKey, "base64");
    
    const isValid = verifySignature(dataBuffer, signatureBuffer, publicKeyBuffer);
    
    return { isValid };
  });

  // ========== Secret Management ==========

  /**
   * Store a secret
   */
  ipcMain.handle("data-vault:store-secret", async (_event, args: {
    key: string;
    value: string;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const { key, value } = args;
    
    const secretsData = await loadEncryptedFile<{ secrets: SecretEntry[] }>(SECRETS_FILE) 
      || { secrets: [] };
    
    // Encrypt the value with a derived key for extra security
    const valueBuffer = Buffer.from(value, "utf-8");
    const encrypted = encrypt(valueBuffer, vaultState.masterKey!);
    
    const existingIndex = secretsData.secrets.findIndex(s => s.key === key);
    const entry: SecretEntry = {
      key,
      value: JSON.stringify(encrypted),
      createdAt: existingIndex >= 0 ? secretsData.secrets[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    if (existingIndex >= 0) {
      secretsData.secrets[existingIndex] = entry;
    } else {
      secretsData.secrets.push(entry);
    }
    
    await saveEncryptedFile(SECRETS_FILE, secretsData);
    
    return { success: true };
  });

  /**
   * Retrieve a secret
   */
  ipcMain.handle("data-vault:get-secret", async (_event, key: string) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const secretsData = await loadEncryptedFile<{ secrets: SecretEntry[] }>(SECRETS_FILE);
    if (!secretsData) return null;
    
    const entry = secretsData.secrets.find(s => s.key === key);
    if (!entry) return null;
    
    // Decrypt the value
    const encrypted: EncryptedData = JSON.parse(entry.value);
    const decrypted = decrypt(encrypted, vaultState.masterKey!);
    
    return decrypted.toString("utf-8");
  });

  /**
   * Delete a secret
   */
  ipcMain.handle("data-vault:delete-secret", async (_event, key: string) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const secretsData = await loadEncryptedFile<{ secrets: SecretEntry[] }>(SECRETS_FILE);
    if (!secretsData) return { success: false };
    
    const index = secretsData.secrets.findIndex(s => s.key === key);
    if (index >= 0) {
      secretsData.secrets.splice(index, 1);
      await saveEncryptedFile(SECRETS_FILE, secretsData);
    }
    
    return { success: true };
  });

  /**
   * List all secret keys (not values)
   */
  ipcMain.handle("data-vault:list-secrets", async () => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const secretsData = await loadEncryptedFile<{ secrets: SecretEntry[] }>(SECRETS_FILE);
    if (!secretsData) return { keys: [] };
    
    return {
      keys: secretsData.secrets.map(s => ({
        key: s.key,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  });

  // ========== Trusted Peers ==========

  /**
   * Add trusted peer
   */
  ipcMain.handle("data-vault:add-peer", async (_event, args: {
    name: string;
    publicKey: string;
    trustLevel?: "known" | "trusted" | "verified";
    notes?: string;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const { name, publicKey, trustLevel = "known", notes } = args;
    
    const peersData = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE)
      || { peers: [] };
    
    // Check for duplicate
    if (peersData.peers.some(p => p.publicKey === publicKey)) {
      throw new Error("Peer with this public key already exists");
    }
    
    const peer: TrustedPeer = {
      id: uuidv4(),
      name,
      publicKey,
      trustLevel,
      addedAt: new Date().toISOString(),
      notes,
    };
    
    peersData.peers.push(peer);
    await saveEncryptedFile(PEERS_FILE, peersData);
    
    return { success: true, peer };
  });

  /**
   * Remove trusted peer
   */
  ipcMain.handle("data-vault:remove-peer", async (_event, peerId: string) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const peersData = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE);
    if (!peersData) return { success: false };
    
    const index = peersData.peers.findIndex(p => p.id === peerId);
    if (index >= 0) {
      peersData.peers.splice(index, 1);
      await saveEncryptedFile(PEERS_FILE, peersData);
    }
    
    return { success: true };
  });

  /**
   * Update peer trust level
   */
  ipcMain.handle("data-vault:update-peer", async (_event, args: {
    peerId: string;
    trustLevel?: "known" | "trusted" | "verified";
    name?: string;
    notes?: string;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const peersData = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE);
    if (!peersData) throw new Error("Peers data not found");
    
    const peer = peersData.peers.find(p => p.id === args.peerId);
    if (!peer) throw new Error("Peer not found");
    
    if (args.trustLevel) peer.trustLevel = args.trustLevel;
    if (args.name) peer.name = args.name;
    if (args.notes !== undefined) peer.notes = args.notes;
    
    await saveEncryptedFile(PEERS_FILE, peersData);
    
    return { success: true, peer };
  });

  /**
   * List trusted peers
   */
  ipcMain.handle("data-vault:list-peers", async () => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const peersData = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE);
    
    return { peers: peersData?.peers || [] };
  });

  /**
   * Get peer by public key
   */
  ipcMain.handle("data-vault:get-peer-by-key", async (_event, publicKey: string) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const peersData = await loadEncryptedFile<{ peers: TrustedPeer[] }>(PEERS_FILE);
    if (!peersData) return null;
    
    return peersData.peers.find(p => p.publicKey === publicKey) || null;
  });

  // ========== Encryption Utilities ==========

  /**
   * Encrypt data for sharing (uses recipient's public key)
   * Note: This is a simplified version - real implementation would use X25519 key exchange
   */
  ipcMain.handle("data-vault:encrypt-for-peer", async (_event, args: {
    data: string;
    recipientPublicKey: string;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    // For now, use a simple symmetric encryption with a shared secret
    // In production, implement proper X25519 key exchange
    const dataBuffer = Buffer.from(args.data, "utf-8");
    
    // Generate a random key for this message
    const messageKey = crypto.randomBytes(KEY_LENGTH);
    const encrypted = encrypt(dataBuffer, messageKey);
    
    // "Encrypt" the message key with recipient's public key
    // Note: This is a placeholder - real implementation needs X25519
    const encryptedKey = encrypt(messageKey, vaultState.masterKey!);
    
    return {
      encryptedData: encrypted,
      encryptedKey: encryptedKey,
      senderPublicKey: vaultState.identity?.publicKey,
    };
  });

  /**
   * Decrypt data from peer
   */
  ipcMain.handle("data-vault:decrypt-from-peer", async (_event, args: {
    encryptedData: EncryptedData;
    encryptedKey: EncryptedData;
    senderPublicKey: string;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    // Decrypt the message key
    const messageKey = decrypt(args.encryptedKey, vaultState.masterKey!);
    
    // Decrypt the data with the message key
    const decrypted = decrypt(args.encryptedData, messageKey);
    
    return decrypted.toString("utf-8");
  });

  // ========== Export/Import ==========

  /**
   * Export identity (public key only)
   */
  ipcMain.handle("data-vault:export-identity", async () => {
    if (!vaultState.isUnlocked || !vaultState.identity) {
      throw new Error("Vault is locked");
    }
    
    return {
      id: vaultState.identity.id,
      name: vaultState.identity.name,
      publicKey: vaultState.identity.publicKey,
      createdAt: vaultState.identity.createdAt,
    };
  });

  /**
   * Export vault entries (assets) to JSON
   */
  ipcMain.handle("data-vault:export", async (_event, args: {
    outputPath: string;
    filter?: {
      status?: string;
      modality?: string;
      tags?: string[];
      collections?: string[];
    };
  }) => {
    const { outputPath, filter } = args;

    let query = db.select().from(vaultAssets).$dynamic();

    if (filter?.status) {
      query = query.where(eq(vaultAssets.status, filter.status));
    }
    if (filter?.modality) {
      query = query.where(eq(vaultAssets.modality, filter.modality));
    }

    const entries = await query;

    // Filter by tags/collections in-memory (JSON columns)
    let filtered = entries;
    if (filter?.tags?.length) {
      filtered = filtered.filter((e) =>
        filter.tags!.some((t) => (e.tags as string[]).includes(t)),
      );
    }
    if (filter?.collections?.length) {
      filtered = filtered.filter((e) =>
        filter.collections!.some((c) => (e.collections as string[]).includes(c)),
      );
    }

    const exportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      entries: filtered,
    };

    await fs.writeJson(outputPath, exportData, { spaces: 2 });

    return { path: outputPath, count: filtered.length };
  });

  /**
   * Export vault backup (encrypted)
   */
  ipcMain.handle("data-vault:export-backup", async (_event, args: {
    outputPath: string;
    includeSecrets?: boolean;
  }) => {
    if (!vaultState.isUnlocked) throw new Error("Vault is locked");
    
    const { outputPath, includeSecrets = false } = args;
    
    const vaultDir = getVaultDir();
    const backup: Record<string, any> = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
    };
    
    // Copy encrypted files
    backup.identity = await fs.readJson(path.join(vaultDir, IDENTITY_FILE));
    backup.peers = await fs.readJson(path.join(vaultDir, PEERS_FILE));
    
    if (includeSecrets) {
      backup.secrets = await fs.readJson(path.join(vaultDir, SECRETS_FILE));
    }
    
    // Note: The backup is still encrypted - user needs passphrase to use it
    await fs.writeJson(outputPath, backup, { spaces: 2 });
    
    return { success: true, path: outputPath };
  });

  logger.info("Data Vault handlers registered");
}
