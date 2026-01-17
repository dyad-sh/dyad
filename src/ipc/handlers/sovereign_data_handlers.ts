/**
 * Sovereign Data IPC Handlers
 * Handles local-first encrypted storage with decentralized network replication
 */

import { ipcMain } from "electron";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "electron";
import type {
  SovereignData,
  SovereignMetadata,
  ContentHash,
  EncryptedContent,
  StorageNetwork,
  DataType,
  DataVisibility,
  DataVault,
  LocalInference,
  DataListing,
  DataPurchase,
  OutboxJob,
  PolicyAuditEvent,
} from "../../types/sovereign_data";

// ============================================================================
// Constants & Configuration
// ============================================================================

const SOVEREIGN_DATA_DIR = path.join(app.getPath("userData"), "sovereign-data");
const VAULT_FILE = path.join(SOVEREIGN_DATA_DIR, "vault.json");
const INDEX_FILE = path.join(SOVEREIGN_DATA_DIR, "index.json");
const KEYS_DIR = path.join(SOVEREIGN_DATA_DIR, "keys");
const CONTENT_DIR = path.join(SOVEREIGN_DATA_DIR, "content");
const OUTBOX_FILE = path.join(SOVEREIGN_DATA_DIR, "outbox.json");
const POLICY_AUDIT_FILE = path.join(SOVEREIGN_DATA_DIR, "policy_audit.json");

// Encryption settings
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ============================================================================
// Initialization
// ============================================================================

async function ensureDirectories(): Promise<void> {
  const dirs = [SOVEREIGN_DATA_DIR, KEYS_DIR, CONTENT_DIR];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function initializeVault(): Promise<DataVault> {
  try {
    const data = await fs.readFile(VAULT_FILE, "utf-8");
    const existing = JSON.parse(data);
    const updated = applyVaultDefaults(existing);
    if (JSON.stringify(updated) !== JSON.stringify(existing)) {
      await fs.writeFile(VAULT_FILE, JSON.stringify(updated, null, 2));
    }
    return updated;
  } catch {
    // Create new vault with generated keys
    const keyPair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const vault: DataVault = {
      did: `did:joy:${crypto.randomBytes(16).toString("hex")}`,
      publicKey: keyPair.publicKey,
      keyPaths: [],
      indexHash: "",
      storageConfig: [
        { network: "local", enabled: true, autoSync: true, encryptionRequired: true },
        { network: "ipfs", enabled: false, autoSync: false, encryptionRequired: true },
        { network: "arweave", enabled: false, autoSync: false, encryptionRequired: true },
        { network: "filecoin", enabled: false, autoSync: false, encryptionRequired: true },
      ],
      defaults: {
        visibility: "private",
        storageTier: "hot",
        replicationCount: 1,
      },
      policies: {
        training: {
          requireConsent: true,
          requirePayment: false,
        },
        outbound: {
          requireConsent: true,
          requirePayment: true,
        },
      },
      stats: {
        totalItems: 0,
        totalSize: 0,
        totalRevenue: 0,
        networkUsage: [],
      },
    };

    // Save private key separately (never leaves device)
    await fs.writeFile(
      path.join(KEYS_DIR, "master.key"),
      keyPair.privateKey,
      { mode: 0o600 }
    );

    await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
    return vault;
  }
}

function applyVaultDefaults(vault: DataVault): DataVault {
  return {
    ...vault,
    policies: {
      training: {
        requireConsent: vault.policies?.training?.requireConsent ?? true,
        requirePayment: vault.policies?.training?.requirePayment ?? false,
      },
      outbound: {
        requireConsent: vault.policies?.outbound?.requireConsent ?? true,
        requirePayment: vault.policies?.outbound?.requirePayment ?? true,
      },
    },
  };
}

// ============================================================================
// Encryption Utilities
// ============================================================================

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, "sha512");
}

function generateDataKey(): { key: Buffer; keyId: string } {
  const key = crypto.randomBytes(KEY_LENGTH);
  const keyId = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return { key, keyId };
}

function encrypt(data: Buffer, key: Buffer): EncryptedContent {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(data),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    ciphertext: encrypted.toString("base64"),
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(encrypted: EncryptedContent, key: Buffer): Buffer {
  const iv = Buffer.from(encrypted.iv, "base64");
  const authTag = encrypted.authTag ? Buffer.from(encrypted.authTag, "base64") : undefined;
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  if (authTag) {
    decipher.setAuthTag(authTag);
  }
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

function computeHash(data: Buffer, algorithm: "sha256" | "sha3-256" | "blake3" = "sha256"): string {
  // Note: blake3 would require additional library
  const hashAlgo = algorithm === "sha3-256" ? "sha3-256" : "sha256";
  return crypto.createHash(hashAlgo).update(data).digest("hex");
}

function hasTrainingConsent(data: SovereignData): boolean {
  if (data.metadata.consent?.training?.granted) {
    return true;
  }
  if (data.metadata.license?.permissions?.includes("train-ai")) {
    return true;
  }
  if (data.metadata.license?.restrictions?.includes("no-ai-training")) {
    return false;
  }
  return false;
}

async function requireTrainingConsent(
  data: SovereignData,
  vault: DataVault,
  action: PolicyAuditEvent["action"]
): Promise<void> {
  if (data.dataType !== "training-data") {
    return;
  }
  if (!vault.policies?.training?.requireConsent) {
    return;
  }
  if (!hasTrainingConsent(data)) {
    await appendPolicyAudit({
      id: crypto.randomBytes(8).toString("hex"),
      dataId: data.id,
      policy: "training-consent",
      action,
      message: "Training consent required for training data exports",
      createdAt: new Date().toISOString(),
    });
    throw new Error("Training consent required for training data exports");
  }
}

function hasOutboundConsent(data: SovereignData): boolean {
  return data.metadata.consent?.outbound?.granted === true;
}

function hasOutboundPayment(data: SovereignData): boolean {
  return !!data.metadata.consent?.outbound?.paymentTxHash;
}

async function requireOutboundApproval(
  data: SovereignData,
  vault: DataVault,
  action: PolicyAuditEvent["action"]
): Promise<void> {
  if (vault.policies?.outbound?.requireConsent && !hasOutboundConsent(data)) {
    await appendPolicyAudit({
      id: crypto.randomBytes(8).toString("hex"),
      dataId: data.id,
      policy: "outbound-consent",
      action,
      message: "Outbound consent required before data can leave this device",
      createdAt: new Date().toISOString(),
    });
    throw new Error("Outbound consent required before data can leave this device");
  }
  if (vault.policies?.outbound?.requirePayment && !hasOutboundPayment(data)) {
    await appendPolicyAudit({
      id: crypto.randomBytes(8).toString("hex"),
      dataId: data.id,
      policy: "outbound-payment",
      action,
      message: "Outbound payment proof required before data can leave this device",
      createdAt: new Date().toISOString(),
    });
    throw new Error("Outbound payment proof required before data can leave this device");
  }
}

function createSharePackage(params: {
  dataHash: string;
  recipientPublicKey: string;
  permissions: string[];
  encryptedKey: EncryptedContent;
}): Record<string, unknown> {
  return {
    type: "sovereign-share",
    dataHash: params.dataHash,
    recipientPublicKey: params.recipientPublicKey,
    permissions: params.permissions,
    encryptedKey: params.encryptedKey,
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// Local Storage Operations
// ============================================================================

async function loadIndex(): Promise<Map<string, SovereignData>> {
  try {
    const data = await fs.readFile(INDEX_FILE, "utf-8");
    const entries = JSON.parse(data);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

async function saveIndex(index: Map<string, SovereignData>): Promise<void> {
  const entries = Array.from(index.entries());
  await fs.writeFile(INDEX_FILE, JSON.stringify(entries, null, 2));
}

async function loadOutbox(): Promise<OutboxJob[]> {
  try {
    const data = await fs.readFile(OUTBOX_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveOutbox(outbox: OutboxJob[]): Promise<void> {
  await fs.writeFile(OUTBOX_FILE, JSON.stringify(outbox, null, 2));
}

async function loadPolicyAudit(): Promise<PolicyAuditEvent[]> {
  try {
    const data = await fs.readFile(POLICY_AUDIT_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function appendPolicyAudit(event: PolicyAuditEvent): Promise<void> {
  const events = await loadPolicyAudit();
  events.unshift(event);
  await fs.writeFile(POLICY_AUDIT_FILE, JSON.stringify(events, null, 2));
}

async function enqueueSyncJob(dataId: string, network: StorageNetwork): Promise<OutboxJob> {
  const index = await loadIndex();
  const data = index.get(dataId);
  if (!data) throw new Error(`Data not found: ${dataId}`);
  const vault = await initializeVault();
  await requireTrainingConsent(data, vault, "outbox");
  await requireOutboundApproval(data, vault, "outbox");

  const job: OutboxJob = {
    id: crypto.randomBytes(8).toString("hex"),
    type: "sync",
    dataId,
    network,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const outbox = await loadOutbox();
  outbox.unshift(job);
  await saveOutbox(outbox);
  return job;
}

async function enqueueShareJob(
  dataId: string,
  recipientPublicKey: string,
  permissions: string[]
): Promise<OutboxJob> {
  const index = await loadIndex();
  const data = index.get(dataId);
  if (!data) throw new Error(`Data not found: ${dataId}`);
  const vault = await initializeVault();
  await requireTrainingConsent(data, vault, "outbox");
  await requireOutboundApproval(data, vault, "outbox");

  const job: OutboxJob = {
    id: crypto.randomBytes(8).toString("hex"),
    type: "share",
    dataId,
    recipientPublicKey,
    permissions,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const outbox = await loadOutbox();
  outbox.unshift(job);
  await saveOutbox(outbox);
  return job;
}

async function processOutbox(): Promise<OutboxJob[]> {
  const outbox = await loadOutbox();
  const index = await loadIndex();
  const vault = await initializeVault();
  const updated: OutboxJob[] = [];

  for (const job of outbox) {
    if (job.status !== "queued") {
      updated.push(job);
      continue;
    }

    const working: OutboxJob = {
      ...job,
      status: "processing",
      updatedAt: new Date().toISOString(),
    };
    try {
      const data = index.get(job.dataId);
      if (!data) {
        throw new Error(`Data not found: ${job.dataId}`);
      }
      await requireTrainingConsent(data, vault, "outbox");
      await requireOutboundApproval(data, vault, "outbox");

      if (job.type === "sync") {
        if (!job.network) {
          throw new Error("Missing network for sync job");
        }
        await syncToNetwork(job.dataId, job.network);
      }

      if (job.type === "share") {
        if (!job.recipientPublicKey || !job.permissions) {
          throw new Error("Missing share parameters");
        }

        const payload = await buildSharePayload({
          data,
          recipientPublicKey: job.recipientPublicKey,
          permissions: job.permissions,
        });

        data.encryptionMetadata = {
          ...data.encryptionMetadata,
          sharedWith: [
            ...(data.encryptionMetadata?.sharedWith || []),
            job.recipientPublicKey,
          ],
        };
        data.visibility = "shared";
        data.updatedAt = new Date().toISOString();
        index.set(job.dataId, data);
        await saveIndex(index);

        working.payload = payload;
      }

      working.status = "completed";
      working.updatedAt = new Date().toISOString();
    } catch (error) {
      working.status = "failed";
      working.error = error instanceof Error ? error.message : "Unknown error";
      working.updatedAt = new Date().toISOString();
    }

    updated.push(working);
  }

  await saveOutbox(updated);
  return updated;
}

async function storeContent(hash: string, content: EncryptedContent): Promise<void> {
  const contentPath = path.join(CONTENT_DIR, hash);
  await fs.writeFile(contentPath, JSON.stringify(content));
}

async function loadContent(hash: string): Promise<EncryptedContent | null> {
  try {
    const contentPath = path.join(CONTENT_DIR, hash);
    const data = await fs.readFile(contentPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function storeDataKey(keyId: string, encryptedKey: string): Promise<void> {
  const keyPath = path.join(KEYS_DIR, `${keyId}.key`);
  await fs.writeFile(keyPath, encryptedKey, { mode: 0o600 });
}

async function loadDataKey(keyId: string): Promise<string | null> {
  try {
    const keyPath = path.join(KEYS_DIR, `${keyId}.key`);
    return await fs.readFile(keyPath, "utf-8");
  } catch {
    return null;
  }
}

async function syncToNetwork(dataId: string, network: StorageNetwork): Promise<SovereignData> {
  const index = await loadIndex();
  const data = index.get(dataId);
  
  if (!data) {
    throw new Error(`Data not found: ${dataId}`);
  }

  const vault = await initializeVault();
  await requireTrainingConsent(data, vault, "sync");
  await requireOutboundApproval(data, vault, "sync");
  
  // Get local content
  const localHash = data.hashes.find((h) => h.network === "local");
  if (!localHash) {
    throw new Error("No local copy to sync");
  }
  
  const encrypted = await loadContent(localHash.hash);
  if (!encrypted) {
    throw new Error("Local content not found");
  }
  
  // Sync to the specified network
  // This would integrate with actual IPFS/Arweave/Filecoin clients
  let networkHash: ContentHash;
  
  switch (network) {
    case "ipfs": {
      // TODO: Integrate with Helia/IPFS
      // const cid = await ipfs.add(JSON.stringify(encrypted));
      const mockCid = `Qm${crypto.randomBytes(22).toString("base64").replace(/[+/=]/g, "")}`;
      networkHash = {
        hash: mockCid,
        algorithm: "cid-v1",
        network: "ipfs",
        size: localHash.size,
        timestamp: new Date().toISOString(),
      };
      break;
    }
    
    case "arweave": {
      // TODO: Integrate with Arweave
      const mockTxId = crypto.randomBytes(32).toString("base64").replace(/[+/=]/g, "");
      networkHash = {
        hash: mockTxId,
        algorithm: "sha256",
        network: "arweave",
        size: localHash.size,
        timestamp: new Date().toISOString(),
      };
      break;
    }
    
    case "filecoin": {
      // TODO: Integrate with Filecoin
      const mockDealId = `bafy${crypto.randomBytes(28).toString("base64").replace(/[+/=]/g, "")}`;
      networkHash = {
        hash: mockDealId,
        algorithm: "cid-v1",
        network: "filecoin",
        size: localHash.size,
        timestamp: new Date().toISOString(),
      };
      break;
    }
    
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
  
  // Update data record
  data.hashes.push(networkHash);
  data.replication.push({
    network,
    status: "synced",
    lastSync: networkHash.timestamp,
    pinned: true,
  });
  data.updatedAt = new Date().toISOString();
  
  index.set(dataId, data);
  await saveIndex(index);
  
  return data;
}

async function buildSharePayload(params: {
  data: SovereignData;
  recipientPublicKey: string;
  permissions: string[];
}): Promise<Record<string, unknown>> {
  const localHash = params.data.hashes.find((h) => h.network === "local");
  if (!localHash || !params.data.encryptionMetadata) {
    throw new Error("Data not available for sharing");
  }

  const encryptedKeyData = await loadDataKey(params.data.encryptionMetadata.keyId);
  if (!encryptedKeyData) {
    throw new Error("Encryption key not found");
  }

  const keyData = JSON.parse(encryptedKeyData);
  const masterKeyPath = path.join(KEYS_DIR, "master.key");
  const masterKey = await fs.readFile(masterKeyPath, "utf-8");
  const salt = Buffer.from(keyData.salt, "base64");
  const derivedMasterKey = deriveKey(masterKey, salt);
  const dataKey = decrypt(keyData, derivedMasterKey);

  const recipientSalt = crypto.randomBytes(16);
  const recipientKey = deriveKey(params.recipientPublicKey, recipientSalt);
  const encryptedKey = encrypt(dataKey, recipientKey);
  encryptedKey.keyDerivation = {
    algorithm: "pbkdf2",
    salt: recipientSalt.toString("base64"),
    iterations: 100000,
  };

  return createSharePackage({
    dataHash: localHash.hash,
    recipientPublicKey: params.recipientPublicKey,
    permissions: params.permissions,
    encryptedKey,
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function registerSovereignDataHandlers(): void {
  // Initialize directories
  ensureDirectories();

  // -------------------------------------------------------------------------
  // Vault Management
  // -------------------------------------------------------------------------

  ipcMain.handle("sovereign:get-vault", async () => {
    return await initializeVault();
  });

  ipcMain.handle("sovereign:update-vault-config", async (_event, config: Partial<DataVault>) => {
    const vault = await initializeVault();
    const updated = { ...vault, ...config };
    await fs.writeFile(VAULT_FILE, JSON.stringify(updated, null, 2));
    return updated;
  });

  ipcMain.handle("sovereign:enable-network", async (_event, network: StorageNetwork, enabled: boolean) => {
    const vault = await initializeVault();
    const configIndex = vault.storageConfig.findIndex((c) => c.network === network);
    
    if (configIndex >= 0) {
      vault.storageConfig[configIndex].enabled = enabled;
    } else {
      vault.storageConfig.push({
        network,
        enabled,
        autoSync: false,
        encryptionRequired: true,
      });
    }
    
    await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
    return vault;
  });

  // -------------------------------------------------------------------------
  // Data Creation & Storage
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:store-data",
    async (
      _event,
      params: {
        data: string; // Base64 encoded data
        dataType: DataType;
        metadata: SovereignMetadata;
        visibility?: DataVisibility;
        encrypt?: boolean;
      }
    ) => {
      await ensureDirectories();
      const vault = await initializeVault();
      const index = await loadIndex();

      const rawData = Buffer.from(params.data, "base64");
      const timestamp = new Date().toISOString();
      
      // Generate content hash
      const contentHash = computeHash(rawData);
      
      // Generate encryption key for this data
      const { key: dataKey, keyId } = generateDataKey();
      
      // Encrypt the data
      const encrypted = encrypt(rawData, dataKey);
      
      // Encrypt and store the data key with master key
      // In production, this would use the master private key
      const masterKeyPath = path.join(KEYS_DIR, "master.key");
      const masterKey = await fs.readFile(masterKeyPath, "utf-8");
      const salt = crypto.randomBytes(16);
      const derivedMasterKey = deriveKey(masterKey, salt);
      const encryptedDataKey = encrypt(dataKey, derivedMasterKey);
      
      await storeDataKey(keyId, JSON.stringify({
        ...encryptedDataKey,
        salt: salt.toString("base64"),
      }));
      
      // Store encrypted content
      await storeContent(contentHash, encrypted);
      
      // Create sovereign data record
      const sovereignData: SovereignData = {
        id: contentHash.slice(0, 16),
        hashes: [{
          hash: contentHash,
          algorithm: "sha256",
          network: "local",
          size: rawData.length,
          timestamp,
        }],
        primaryNetwork: "local",
        replication: [{
          network: "local",
          status: "synced",
          lastSync: timestamp,
        }],
        encrypted: params.encrypt !== false,
        encryptionMetadata: {
          algorithm: ENCRYPTION_ALGORITHM,
          keyId,
        },
        dataType: params.dataType,
        visibility: params.visibility || vault.defaults.visibility,
        owner: {
          did: vault.did,
          publicKey: vault.publicKey,
          signature: "", // Would be actual signature
        },
        version: 1,
        metadata: params.metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      
      // Update index
      index.set(sovereignData.id, sovereignData);
      await saveIndex(index);
      
      // Update vault stats
      vault.stats.totalItems += 1;
      vault.stats.totalSize += rawData.length;
      await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
      
      return sovereignData;
    }
  );

  ipcMain.handle("sovereign:retrieve-data", async (_event, dataId: string) => {
    const index = await loadIndex();
    const sovereignData = index.get(dataId);
    
    if (!sovereignData) {
      throw new Error(`Data not found: ${dataId}`);
    }
    
    // Get the content hash from local storage
    const localHash = sovereignData.hashes.find((h) => h.network === "local");
    if (!localHash) {
      throw new Error("No local copy available");
    }
    
    // Load encrypted content
    const encrypted = await loadContent(localHash.hash);
    if (!encrypted) {
      throw new Error("Content not found locally");
    }
    
    // Load and decrypt the data key
    if (sovereignData.encryptionMetadata) {
      const encryptedKeyData = await loadDataKey(sovereignData.encryptionMetadata.keyId);
      if (!encryptedKeyData) {
        throw new Error("Encryption key not found");
      }
      
      const keyData = JSON.parse(encryptedKeyData);
      const masterKeyPath = path.join(KEYS_DIR, "master.key");
      const masterKey = await fs.readFile(masterKeyPath, "utf-8");
      const salt = Buffer.from(keyData.salt, "base64");
      const derivedMasterKey = deriveKey(masterKey, salt);
      
      const dataKey = decrypt(keyData, derivedMasterKey);
      const decrypted = decrypt(encrypted, dataKey);
      
      return {
        ...sovereignData,
        data: decrypted.toString("base64"),
      };
    }
    
    return sovereignData;
  });

  ipcMain.handle("sovereign:list-data", async (_event, filters?: {
    dataType?: DataType;
    visibility?: DataVisibility;
    network?: StorageNetwork;
  }) => {
    const index = await loadIndex();
    let results = Array.from(index.values());
    
    if (filters?.dataType) {
      results = results.filter((d) => d.dataType === filters.dataType);
    }
    if (filters?.visibility) {
      results = results.filter((d) => d.visibility === filters.visibility);
    }
    if (filters?.network) {
      results = results.filter((d) => 
        d.hashes.some((h) => h.network === filters.network)
      );
    }
    
    return results;
  });

  ipcMain.handle("sovereign:delete-data", async (_event, dataId: string) => {
    const index = await loadIndex();
    const data = index.get(dataId);
    
    if (!data) {
      throw new Error(`Data not found: ${dataId}`);
    }
    
    // Delete content files
    for (const hash of data.hashes) {
      if (hash.network === "local") {
        try {
          await fs.unlink(path.join(CONTENT_DIR, hash.hash));
        } catch {
          // File may not exist
        }
      }
    }
    
    // Delete encryption key
    if (data.encryptionMetadata) {
      try {
        await fs.unlink(path.join(KEYS_DIR, `${data.encryptionMetadata.keyId}.key`));
      } catch {
        // Key may not exist
      }
    }
    
    // Remove from index
    index.delete(dataId);
    await saveIndex(index);
    
    // Update vault stats
    const vault = await initializeVault();
    vault.stats.totalItems -= 1;
    const localHash = data.hashes.find((h) => h.network === "local");
    if (localHash) {
      vault.stats.totalSize -= localHash.size;
    }
    await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
    
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Decentralized Network Sync
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:sync-to-network",
    async (_event, dataId: string, network: StorageNetwork) => {
      return syncToNetwork(dataId, network);
    }
  );

  ipcMain.handle(
    "sovereign:pin-to-ipfs",
    async (_event, dataId: string) => {
      // This would use Helia for local IPFS node
      // or connect to pinning services like Pinata, Web3.Storage
      // Reuse the sync-to-network logic by calling it directly
      return syncToNetwork(dataId, "ipfs");
    }
  );

  ipcMain.handle(
    "sovereign:store-on-arweave",
    async (_event, dataId: string) => {
      // This would use Arweave SDK for permanent storage
      return syncToNetwork(dataId, "arweave");
    }
  );

  // -------------------------------------------------------------------------
  // Local Inference
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:run-local-inference",
    async (
      _event,
      params: {
        modelId: string;
        input: string; // Base64 encoded
        options?: Record<string, unknown>;
      }
    ): Promise<LocalInference> => {
      const index = await loadIndex();
      const vault = await initializeVault();
      
      const model = index.get(params.modelId);
      if (!model) {
        throw new Error(`Model not found: ${params.modelId}`);
      }
      
      const inferenceId = crypto.randomBytes(8).toString("hex");
      const startTime = new Date().toISOString();
      
      // Store input data
      const inputData = Buffer.from(params.input, "base64");
      const inputHash = computeHash(inputData);
      
      const inference: LocalInference = {
        id: inferenceId,
        modelHash: model.hashes[0].hash,
        modelNetwork: model.primaryNetwork,
        inputHash,
        inputType: "raw",
        status: "pending",
        startTime,
      };
      
      try {
        // This would integrate with local inference engines:
        // - llama.cpp for LLMs
        // - ONNX Runtime for general ML
        // - TensorFlow Lite for mobile-optimized models
        // - Custom WASM modules
        
        inference.status = "running";
        
        // Simulated inference (replace with actual local inference)
        const result = {
          output: "Local inference result placeholder",
          confidence: 0.95,
        };
        
        const outputData = Buffer.from(JSON.stringify(result));
        const outputHash = computeHash(outputData);
        
        inference.outputHash = outputHash;
        inference.result = result;
        inference.status = "completed";
        inference.endTime = new Date().toISOString();
        inference.computeTime = Date.now() - new Date(startTime).getTime();
        
        // Generate proof (simplified)
        inference.proof = {
          type: "signature",
          proof: crypto.createSign("SHA256")
            .update(`${inputHash}:${outputHash}`)
            .sign(await fs.readFile(path.join(KEYS_DIR, "master.key"), "utf-8"), "base64"),
          publicInputs: [inputHash, outputHash],
          verifier: {
            endpoint: `local://verify/${inferenceId}`,
          },
          verified: true,
          verifiedAt: inference.endTime,
          verifiedBy: vault.did,
        };
        
        return inference;
      } catch (error) {
        inference.status = "failed";
        inference.error = error instanceof Error ? error.message : "Unknown error";
        inference.endTime = new Date().toISOString();
        return inference;
      }
    }
  );

  // -------------------------------------------------------------------------
  // Data Sharing & Access Control
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:share-data",
    async (
      _event,
      dataId: string,
      recipientPublicKey: string,
      permissions: string[]
    ) => {
      const index = await loadIndex();
      const data = index.get(dataId);
      
      if (!data) {
        throw new Error(`Data not found: ${dataId}`);
      }

      const vault = await initializeVault();
      await requireTrainingConsent(data, vault, "share");
      await requireOutboundApproval(data, vault, "share");
      
      if (!data.encryptionMetadata) {
        throw new Error("Data is not encrypted, cannot share securely");
      }
      
      // Load the data key
      const encryptedKeyData = await loadDataKey(data.encryptionMetadata.keyId);
      if (!encryptedKeyData) {
        throw new Error("Encryption key not found");
      }
      
      // Re-encrypt the data key with recipient's public key
      // This would use actual public key cryptography
      const sharedKeyId = crypto.randomBytes(8).toString("hex");
      
      // Add recipient to shared list
      data.encryptionMetadata.sharedWith = [
        ...(data.encryptionMetadata.sharedWith || []),
        recipientPublicKey,
      ];
      data.visibility = "shared";
      data.updatedAt = new Date().toISOString();
      
      index.set(dataId, data);
      await saveIndex(index);
      
      return {
        dataId,
        sharedKeyId,
        recipientPublicKey,
        permissions,
        grantedAt: data.updatedAt,
      };
    }
  );

  ipcMain.handle(
    "sovereign:revoke-access",
    async (_event, dataId: string, recipientPublicKey: string) => {
      const index = await loadIndex();
      const data = index.get(dataId);
      
      if (!data) {
        throw new Error(`Data not found: ${dataId}`);
      }
      
      if (data.encryptionMetadata?.sharedWith) {
        data.encryptionMetadata.sharedWith = data.encryptionMetadata.sharedWith.filter(
          (pk) => pk !== recipientPublicKey
        );
        
        if (data.encryptionMetadata.sharedWith.length === 0) {
          data.visibility = "private";
        }
      }
      
      data.updatedAt = new Date().toISOString();
      index.set(dataId, data);
      await saveIndex(index);
      
      return { success: true };
    }
  );

  // -------------------------------------------------------------------------
  // Consent Updates
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:update-consent",
    async (
      _event,
      dataId: string,
      params: { outboundGranted: boolean; paymentTxHash?: string }
    ) => {
      const index = await loadIndex();
      const data = index.get(dataId);

      if (!data) {
        throw new Error(`Data not found: ${dataId}`);
      }

      data.metadata = {
        ...data.metadata,
        consent: {
          ...data.metadata.consent,
          outbound: {
            granted: params.outboundGranted,
            grantedAt: params.outboundGranted ? new Date().toISOString() : undefined,
            paymentTxHash: params.paymentTxHash,
          },
        },
      };
      data.updatedAt = new Date().toISOString();
      index.set(dataId, data);
      await saveIndex(index);

      return data;
    }
  );

  // -------------------------------------------------------------------------
  // Offline Outbox
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:queue-sync",
    async (_event, dataId: string, network: StorageNetwork) => {
      return enqueueSyncJob(dataId, network);
    }
  );

  ipcMain.handle(
    "sovereign:queue-share",
    async (
      _event,
      dataId: string,
      recipientPublicKey: string,
      permissions: string[]
    ) => {
      return enqueueShareJob(dataId, recipientPublicKey, permissions);
    }
  );

  ipcMain.handle("sovereign:list-outbox", async () => {
    return loadOutbox();
  });

  ipcMain.handle("sovereign:process-outbox", async () => {
    return processOutbox();
  });

  ipcMain.handle("sovereign:policy-audit", async () => {
    return loadPolicyAudit();
  });

  // -------------------------------------------------------------------------
  // Marketplace Operations
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:create-listing",
    async (_event, params: Omit<DataListing, "id" | "createdAt" | "updatedAt" | "views" | "purchases">) => {
      const index = await loadIndex();
      const data = index.get(params.dataId);
      
      if (!data) {
        throw new Error(`Data not found: ${params.dataId}`);
      }

      const vault = await initializeVault();
      await requireTrainingConsent(data, vault, "listing");
      await requireOutboundApproval(data, vault, "listing");
      
      const listing: DataListing = {
        ...params,
        id: crypto.randomBytes(8).toString("hex"),
        views: 0,
        purchases: 0,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      // Update data visibility
      data.visibility = "marketplace";
      data.metadata.license = params.license;
      data.metadata.pricing = params.pricing;
      data.updatedAt = listing.updatedAt;
      
      index.set(data.id, data);
      await saveIndex(index);
      
      // Store listing separately
      const listingsPath = path.join(SOVEREIGN_DATA_DIR, "listings.json");
      let listings: DataListing[] = [];
      try {
        const listingsData = await fs.readFile(listingsPath, "utf-8");
        listings = JSON.parse(listingsData);
      } catch {
        // No existing listings
      }
      
      listings.push(listing);
      await fs.writeFile(listingsPath, JSON.stringify(listings, null, 2));
      
      return listing;
    }
  );

  ipcMain.handle("sovereign:get-listings", async () => {
    const listingsPath = path.join(SOVEREIGN_DATA_DIR, "listings.json");
    try {
      const data = await fs.readFile(listingsPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  });

  ipcMain.handle("sovereign:get-purchases", async () => {
    const purchasesPath = path.join(SOVEREIGN_DATA_DIR, "purchases.json");
    try {
      const data = await fs.readFile(purchasesPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "sovereign:record-purchase",
    async (_event, params: Omit<DataPurchase, "id" | "purchasedAt">) => {
      const purchase: DataPurchase = {
        ...params,
        id: crypto.randomBytes(8).toString("hex"),
        purchasedAt: new Date().toISOString(),
      };
      
      // Store purchase record
      const purchasesPath = path.join(SOVEREIGN_DATA_DIR, "purchases.json");
      let purchases: DataPurchase[] = [];
      try {
        const data = await fs.readFile(purchasesPath, "utf-8");
        purchases = JSON.parse(data);
      } catch {
        // No existing purchases
      }
      
      purchases.push(purchase);
      await fs.writeFile(purchasesPath, JSON.stringify(purchases, null, 2));
      
      // Update vault revenue
      const vault = await initializeVault();
      vault.stats.totalRevenue += params.amount;
      await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
      
      return purchase;
    }
  );

  // -------------------------------------------------------------------------
  // Export & Import
  // -------------------------------------------------------------------------

  ipcMain.handle(
    "sovereign:export-data",
    async (_event, dataId: string, format: "json" | "encrypted-bundle") => {
      const index = await loadIndex();
      const data = index.get(dataId);
      
      if (!data) {
        throw new Error(`Data not found: ${dataId}`);
      }

      const vault = await initializeVault();
      await requireTrainingConsent(data, vault, "export");
      await requireOutboundApproval(data, vault, "export");
      
      if (format === "json") {
        // Export metadata only (no sensitive data)
        return {
          metadata: data.metadata,
          hashes: data.hashes,
          dataType: data.dataType,
          owner: data.owner,
        };
      }
      
      // Export full encrypted bundle
      const localHash = data.hashes.find((h) => h.network === "local");
      if (!localHash) {
        throw new Error("No local content to export");
      }
      
      const content = await loadContent(localHash.hash);
      const encryptedKey = data.encryptionMetadata
        ? await loadDataKey(data.encryptionMetadata.keyId)
        : null;
      
      return {
        data,
        content,
        encryptedKey,
        exportedAt: new Date().toISOString(),
      };
    }
  );

  ipcMain.handle(
    "sovereign:import-data",
    async (_event, bundle: {
      data: SovereignData;
      content: EncryptedContent;
      encryptedKey?: string;
    }) => {
      await ensureDirectories();
      const index = await loadIndex();
      const vault = await initializeVault();
      
      // Generate new ID to avoid conflicts
      const newId = crypto.randomBytes(8).toString("hex");
      const timestamp = new Date().toISOString();
      
      // Store content
      const contentHash = computeHash(Buffer.from(bundle.content.ciphertext, "base64"));
      await storeContent(contentHash, bundle.content);
      
      // Store encryption key if provided
      if (bundle.encryptedKey && bundle.data.encryptionMetadata) {
        await storeDataKey(bundle.data.encryptionMetadata.keyId, bundle.encryptedKey);
      }
      
      // Create new sovereign data record
      const imported: SovereignData = {
        ...bundle.data,
        id: newId,
        hashes: [{
          hash: contentHash,
          algorithm: "sha256",
          network: "local",
          size: Buffer.from(bundle.content.ciphertext, "base64").length,
          timestamp,
        }],
        primaryNetwork: "local",
        replication: [{
          network: "local",
          status: "synced",
          lastSync: timestamp,
        }],
        previousVersion: bundle.data.id, // Track origin
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      
      index.set(newId, imported);
      await saveIndex(index);
      
      // Update vault stats
      vault.stats.totalItems += 1;
      await fs.writeFile(VAULT_FILE, JSON.stringify(vault, null, 2));
      
      return imported;
    }
  );
}
