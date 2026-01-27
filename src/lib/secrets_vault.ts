/**
 * Local Secrets Vault
 * Secure, encrypted local storage for API keys and credentials
 */

import { randomUUID, createCipheriv, createDecipheriv, scrypt, randomBytes } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { app } from "electron";
import { EventEmitter } from "node:events";

// =============================================================================
// TYPES
// =============================================================================

export type SecretId = string & { __brand: "SecretId" };
export type VaultId = string & { __brand: "VaultId" };

export type SecretType = "api_key" | "password" | "token" | "certificate" | "ssh_key" | "oauth" | "custom";
export type SecretCategory = "ai" | "cloud" | "database" | "service" | "personal" | "other";

export interface Secret {
  id: SecretId;
  name: string;
  type: SecretType;
  category: SecretCategory;
  description?: string;
  value: string; // Encrypted in storage, decrypted when retrieved
  metadata: SecretMetadata;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
  expiresAt?: number;
  tags: string[];
}

export interface SecretMetadata {
  service?: string;
  username?: string;
  url?: string;
  notes?: string;
  autoRotate?: boolean;
  rotationInterval?: number; // days
  lastRotated?: number;
}

export interface VaultConfig {
  id: VaultId;
  name: string;
  algorithm: "aes-256-gcm" | "chacha20-poly1305";
  keyDerivation: "scrypt" | "argon2";
  autoLockTimeout: number; // minutes, 0 = never
  backupEnabled: boolean;
  backupInterval: number; // hours
  createdAt: number;
}

export interface VaultStats {
  totalSecrets: number;
  secretsByType: Record<SecretType, number>;
  secretsByCategory: Record<SecretCategory, number>;
  lastBackup?: number;
  storageSize: number;
}

export interface SecretEntry {
  id: SecretId;
  name: string;
  type: SecretType;
  category: SecretCategory;
  encryptedValue: string;
  iv: string;
  authTag: string;
  metadata: SecretMetadata;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
  expiresAt?: number;
  tags: string[];
}

export interface VaultBackup {
  id: string;
  vaultId: VaultId;
  timestamp: number;
  secretCount: number;
  checksum: string;
  filePath: string;
}

export type VaultEventType =
  | "vault:created"
  | "vault:unlocked"
  | "vault:locked"
  | "vault:deleted"
  | "secret:created"
  | "secret:updated"
  | "secret:deleted"
  | "secret:accessed"
  | "backup:created"
  | "backup:restored"
  | "error";

export interface VaultEvent {
  type: VaultEventType;
  vaultId: VaultId;
  secretId?: SecretId;
  data?: any;
}

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function encrypt(plaintext: string, key: Buffer): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(encrypted: string, key: Buffer, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

function generateChecksum(data: string): string {
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(data).digest("hex");
}

// =============================================================================
// SECRETS VAULT
// =============================================================================

export class SecretsVault extends EventEmitter {
  private storageDir: string;
  private vaultConfig: VaultConfig | null = null;
  private masterKey: Buffer | null = null;
  private salt: Buffer | null = null;
  private secrets: Map<SecretId, SecretEntry> = new Map();
  private isLocked = true;
  private autoLockTimer: NodeJS.Timeout | null = null;

  constructor(storageDir?: string) {
    super();
    this.storageDir = storageDir || path.join(app.getPath("userData"), "secrets-vault");
  }

  // ---------------------------------------------------------------------------
  // VAULT MANAGEMENT
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.mkdir(path.join(this.storageDir, "backups"), { recursive: true });
  }

  async createVault(name: string, masterPassword: string): Promise<VaultConfig> {
    if (this.vaultConfig) {
      throw new Error("Vault already exists");
    }

    const vaultId = randomUUID() as VaultId;
    this.salt = randomBytes(32);
    this.masterKey = await deriveKey(masterPassword, this.salt);

    this.vaultConfig = {
      id: vaultId,
      name,
      algorithm: "aes-256-gcm",
      keyDerivation: "scrypt",
      autoLockTimeout: 15, // 15 minutes default
      backupEnabled: true,
      backupInterval: 24, // daily backups
      createdAt: Date.now(),
    };

    await this.saveVaultConfig();
    this.isLocked = false;
    this.startAutoLockTimer();
    this.emitEvent("vault:created", vaultId);

    return this.vaultConfig;
  }

  async unlockVault(masterPassword: string): Promise<boolean> {
    if (!this.salt) {
      await this.loadVaultConfig();
    }

    if (!this.salt || !this.vaultConfig) {
      throw new Error("Vault not found");
    }

    try {
      this.masterKey = await deriveKey(masterPassword, this.salt);
      await this.loadSecrets();
      this.isLocked = false;
      this.startAutoLockTimer();
      this.emitEvent("vault:unlocked", this.vaultConfig.id);
      return true;
    } catch {
      this.masterKey = null;
      return false;
    }
  }

  lockVault(): void {
    if (this.vaultConfig && !this.isLocked) {
      this.masterKey = null;
      this.secrets.clear();
      this.isLocked = true;
      this.stopAutoLockTimer();
      this.emitEvent("vault:locked", this.vaultConfig.id);
    }
  }

  async deleteVault(): Promise<void> {
    if (!this.vaultConfig) {
      throw new Error("Vault not found");
    }

    const vaultId = this.vaultConfig.id;
    await fs.rm(this.storageDir, { recursive: true, force: true });
    this.vaultConfig = null;
    this.masterKey = null;
    this.salt = null;
    this.secrets.clear();
    this.isLocked = true;
    this.emitEvent("vault:deleted", vaultId);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    if (!this.vaultConfig) {
      throw new Error("Vault not found");
    }

    // Verify current password
    const testKey = await deriveKey(currentPassword, this.salt!);
    const testSecret = Array.from(this.secrets.values())[0];
    if (testSecret) {
      try {
        decrypt(testSecret.encryptedValue, testKey, testSecret.iv, testSecret.authTag);
      } catch {
        return false;
      }
    }

    // Re-encrypt all secrets with new key
    const newSalt = randomBytes(32);
    const newKey = await deriveKey(newPassword, newSalt);

    for (const [id, entry] of this.secrets) {
      const plaintext = decrypt(entry.encryptedValue, this.masterKey!, entry.iv, entry.authTag);
      const { encrypted, iv, authTag } = encrypt(plaintext, newKey);
      entry.encryptedValue = encrypted;
      entry.iv = iv;
      entry.authTag = authTag;
    }

    this.salt = newSalt;
    this.masterKey = newKey;
    await this.saveVaultConfig();
    await this.saveSecrets();

    return true;
  }

  isVaultLocked(): boolean {
    return this.isLocked;
  }

  hasVault(): boolean {
    return this.vaultConfig !== null;
  }

  getVaultConfig(): VaultConfig | null {
    return this.vaultConfig ? { ...this.vaultConfig } : null;
  }

  async checkVaultExists(): Promise<boolean> {
    try {
      await this.loadVaultConfig();
      return this.vaultConfig !== null;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // SECRET MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSecret(params: {
    name: string;
    type: SecretType;
    category: SecretCategory;
    value: string;
    description?: string;
    metadata?: Partial<SecretMetadata>;
    tags?: string[];
    expiresAt?: number;
  }): Promise<Secret> {
    this.ensureUnlocked();

    const secretId = randomUUID() as SecretId;
    const { encrypted, iv, authTag } = encrypt(params.value, this.masterKey!);

    const entry: SecretEntry = {
      id: secretId,
      name: params.name,
      type: params.type,
      category: params.category,
      encryptedValue: encrypted,
      iv,
      authTag,
      metadata: params.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: params.expiresAt,
      tags: params.tags || [],
    };

    this.secrets.set(secretId, entry);
    await this.saveSecrets();
    this.resetAutoLockTimer();
    this.emitEvent("secret:created", this.vaultConfig!.id, secretId);

    return this.decryptEntry(entry);
  }

  async getSecret(secretId: SecretId): Promise<Secret | null> {
    this.ensureUnlocked();

    const entry = this.secrets.get(secretId);
    if (!entry) return null;

    entry.lastAccessedAt = Date.now();
    await this.saveSecrets();
    this.resetAutoLockTimer();
    this.emitEvent("secret:accessed", this.vaultConfig!.id, secretId);

    return this.decryptEntry(entry);
  }

  async updateSecret(
    secretId: SecretId,
    updates: Partial<{
      name: string;
      type: SecretType;
      category: SecretCategory;
      value: string;
      description: string;
      metadata: Partial<SecretMetadata>;
      tags: string[];
      expiresAt: number | null;
    }>
  ): Promise<Secret | null> {
    this.ensureUnlocked();

    const entry = this.secrets.get(secretId);
    if (!entry) return null;

    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.type !== undefined) entry.type = updates.type;
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.expiresAt !== undefined) entry.expiresAt = updates.expiresAt || undefined;
    if (updates.metadata !== undefined) {
      entry.metadata = { ...entry.metadata, ...updates.metadata };
    }

    if (updates.value !== undefined) {
      const { encrypted, iv, authTag } = encrypt(updates.value, this.masterKey!);
      entry.encryptedValue = encrypted;
      entry.iv = iv;
      entry.authTag = authTag;
    }

    entry.updatedAt = Date.now();
    await this.saveSecrets();
    this.resetAutoLockTimer();
    this.emitEvent("secret:updated", this.vaultConfig!.id, secretId);

    return this.decryptEntry(entry);
  }

  async deleteSecret(secretId: SecretId): Promise<boolean> {
    this.ensureUnlocked();

    if (!this.secrets.has(secretId)) return false;

    this.secrets.delete(secretId);
    await this.saveSecrets();
    this.resetAutoLockTimer();
    this.emitEvent("secret:deleted", this.vaultConfig!.id, secretId);

    return true;
  }

  async listSecrets(filters?: {
    type?: SecretType;
    category?: SecretCategory;
    tags?: string[];
    search?: string;
  }): Promise<Array<Omit<Secret, "value">>> {
    this.ensureUnlocked();
    this.resetAutoLockTimer();

    let entries = Array.from(this.secrets.values());

    if (filters?.type) {
      entries = entries.filter((e) => e.type === filters.type);
    }
    if (filters?.category) {
      entries = entries.filter((e) => e.category === filters.category);
    }
    if (filters?.tags?.length) {
      entries = entries.filter((e) => filters.tags!.some((t) => e.tags.includes(t)));
    }
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(search) ||
          e.metadata.service?.toLowerCase().includes(search) ||
          e.metadata.notes?.toLowerCase().includes(search)
      );
    }

    return entries.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      category: e.category,
      description: e.metadata.notes,
      metadata: e.metadata,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastAccessedAt: e.lastAccessedAt,
      expiresAt: e.expiresAt,
      tags: e.tags,
      value: "", // Don't expose value in list
    }));
  }

  async getStats(): Promise<VaultStats> {
    this.ensureUnlocked();

    const entries = Array.from(this.secrets.values());
    
    const secretsByType: Record<SecretType, number> = {
      api_key: 0,
      password: 0,
      token: 0,
      certificate: 0,
      ssh_key: 0,
      oauth: 0,
      custom: 0,
    };

    const secretsByCategory: Record<SecretCategory, number> = {
      ai: 0,
      cloud: 0,
      database: 0,
      service: 0,
      personal: 0,
      other: 0,
    };

    for (const entry of entries) {
      secretsByType[entry.type]++;
      secretsByCategory[entry.category]++;
    }

    // Get storage size
    let storageSize = 0;
    try {
      const secretsFile = path.join(this.storageDir, "secrets.enc");
      const stat = await fs.stat(secretsFile);
      storageSize = stat.size;
    } catch {
      // File doesn't exist yet
    }

    // Get last backup time
    let lastBackup: number | undefined;
    try {
      const backups = await this.listBackups();
      if (backups.length > 0) {
        lastBackup = backups[0].timestamp;
      }
    } catch {
      // No backups
    }

    return {
      totalSecrets: entries.length,
      secretsByType,
      secretsByCategory,
      lastBackup,
      storageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // BACKUP & RESTORE
  // ---------------------------------------------------------------------------

  async createBackup(): Promise<VaultBackup> {
    this.ensureUnlocked();

    const backupId = randomUUID();
    const timestamp = Date.now();
    const secretsData = JSON.stringify(Array.from(this.secrets.entries()));
    const checksum = generateChecksum(secretsData);

    // Encrypt backup with master key
    const { encrypted, iv, authTag } = encrypt(secretsData, this.masterKey!);

    const backupFile = path.join(
      this.storageDir,
      "backups",
      `backup-${timestamp}.enc`
    );

    await fs.writeFile(
      backupFile,
      JSON.stringify({ encrypted, iv, authTag, checksum, secretCount: this.secrets.size })
    );

    const backup: VaultBackup = {
      id: backupId,
      vaultId: this.vaultConfig!.id,
      timestamp,
      secretCount: this.secrets.size,
      checksum,
      filePath: backupFile,
    };

    this.emitEvent("backup:created", this.vaultConfig!.id, undefined, { backup });

    return backup;
  }

  async restoreBackup(backupPath: string): Promise<boolean> {
    this.ensureUnlocked();

    try {
      const backupData = JSON.parse(await fs.readFile(backupPath, "utf-8"));
      const decrypted = decrypt(backupData.encrypted, this.masterKey!, backupData.iv, backupData.authTag);
      const entries = JSON.parse(decrypted) as Array<[SecretId, SecretEntry]>;

      // Verify checksum
      if (generateChecksum(decrypted) !== backupData.checksum) {
        throw new Error("Backup checksum mismatch");
      }

      this.secrets = new Map(entries);
      await this.saveSecrets();
      this.emitEvent("backup:restored", this.vaultConfig!.id);

      return true;
    } catch (error) {
      this.emitEvent("error", this.vaultConfig!.id, undefined, { error: String(error) });
      return false;
    }
  }

  async listBackups(): Promise<VaultBackup[]> {
    const backupsDir = path.join(this.storageDir, "backups");
    const files = await fs.readdir(backupsDir);
    const backups: VaultBackup[] = [];

    for (const file of files) {
      if (file.startsWith("backup-") && file.endsWith(".enc")) {
        try {
          const filePath = path.join(backupsDir, file);
          const data = JSON.parse(await fs.readFile(filePath, "utf-8"));
          const timestamp = parseInt(file.replace("backup-", "").replace(".enc", ""));

          backups.push({
            id: file,
            vaultId: this.vaultConfig?.id || ("" as VaultId),
            timestamp,
            secretCount: data.secretCount || 0,
            checksum: data.checksum,
            filePath,
          });
        } catch {
          // Skip invalid backup files
        }
      }
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteBackup(backupPath: string): Promise<boolean> {
    try {
      await fs.unlink(backupPath);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // AUTO-LOCK
  // ---------------------------------------------------------------------------

  async setAutoLockTimeout(minutes: number): Promise<void> {
    if (!this.vaultConfig) return;

    this.vaultConfig.autoLockTimeout = minutes;
    await this.saveVaultConfig();

    if (minutes > 0) {
      this.resetAutoLockTimer();
    } else {
      this.stopAutoLockTimer();
    }
  }

  private startAutoLockTimer(): void {
    if (this.vaultConfig?.autoLockTimeout && this.vaultConfig.autoLockTimeout > 0) {
      this.autoLockTimer = setTimeout(
        () => this.lockVault(),
        this.vaultConfig.autoLockTimeout * 60 * 1000
      );
    }
  }

  private stopAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  private resetAutoLockTimer(): void {
    this.stopAutoLockTimer();
    this.startAutoLockTimer();
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  private ensureUnlocked(): void {
    if (this.isLocked || !this.masterKey) {
      throw new Error("Vault is locked");
    }
  }

  private decryptEntry(entry: SecretEntry): Secret {
    const value = decrypt(entry.encryptedValue, this.masterKey!, entry.iv, entry.authTag);
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      category: entry.category,
      value,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastAccessedAt: entry.lastAccessedAt,
      expiresAt: entry.expiresAt,
      tags: entry.tags,
    };
  }

  private async loadVaultConfig(): Promise<void> {
    try {
      const configPath = path.join(this.storageDir, "vault.json");
      const data = JSON.parse(await fs.readFile(configPath, "utf-8"));
      this.vaultConfig = data.config;
      this.salt = Buffer.from(data.salt, "base64");
    } catch {
      this.vaultConfig = null;
      this.salt = null;
    }
  }

  private async saveVaultConfig(): Promise<void> {
    const configPath = path.join(this.storageDir, "vault.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        config: this.vaultConfig,
        salt: this.salt?.toString("base64"),
      })
    );
  }

  private async loadSecrets(): Promise<void> {
    try {
      const secretsPath = path.join(this.storageDir, "secrets.enc");
      const data = JSON.parse(await fs.readFile(secretsPath, "utf-8"));
      const decrypted = decrypt(data.encrypted, this.masterKey!, data.iv, data.authTag);
      const entries = JSON.parse(decrypted) as Array<[SecretId, SecretEntry]>;
      this.secrets = new Map(entries);
    } catch {
      this.secrets = new Map();
    }
  }

  private async saveSecrets(): Promise<void> {
    const secretsData = JSON.stringify(Array.from(this.secrets.entries()));
    const { encrypted, iv, authTag } = encrypt(secretsData, this.masterKey!);
    const secretsPath = path.join(this.storageDir, "secrets.enc");
    await fs.writeFile(secretsPath, JSON.stringify({ encrypted, iv, authTag }));
  }

  private emitEvent(type: VaultEventType, vaultId: VaultId, secretId?: SecretId, data?: any): void {
    const event: VaultEvent = { type, vaultId, secretId, data };
    this.emit("vault:event", event);
  }

  subscribe(callback: (event: VaultEvent) => void): () => void {
    this.on("vault:event", callback);
    return () => this.off("vault:event", callback);
  }
}

// Global instance
let secretsVault: SecretsVault | null = null;

export function getSecretsVault(): SecretsVault {
  if (!secretsVault) {
    secretsVault = new SecretsVault();
  }
  return secretsVault;
}
