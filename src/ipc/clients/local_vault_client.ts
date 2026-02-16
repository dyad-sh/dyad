// =============================================================================
// Local Vault IPC Client — Renderer-side API for the sovereign data vault
// =============================================================================

import type {
  VaultStatus,
  VaultConfig,
  ConnectorConfig,
  ConnectorType,
  VaultAsset,
  TransformJob,
  TransformStageConfig,
  VaultAuditEntry,
} from "../../types/local_vault";

/**
 * Singleton IPC client for the Local Vault system.
 * Access via LocalVaultClient.getInstance()
 */
export class LocalVaultClient {
  private static instance: LocalVaultClient;

  static getInstance(): LocalVaultClient {
    if (!LocalVaultClient.instance) {
      LocalVaultClient.instance = new LocalVaultClient();
    }
    return LocalVaultClient.instance;
  }

  private invoke(channel: string, ...args: unknown[]): Promise<any> {
    return window.electron.ipcRenderer.invoke(channel, ...args);
  }

  // ---- Vault Core ----

  getVaultStatus(): Promise<VaultStatus> {
    return this.invoke("local-vault:status");
  }

  initializeVault(passphrase?: string): Promise<VaultStatus> {
    return this.invoke("local-vault:initialize", passphrase);
  }

  unlockVault(passphrase: string): Promise<VaultStatus> {
    return this.invoke("local-vault:unlock", passphrase);
  }

  lockVault(): Promise<VaultStatus> {
    return this.invoke("local-vault:lock");
  }

  getVaultConfig(): Promise<VaultConfig> {
    return this.invoke("local-vault:get-config");
  }

  updateVaultConfig(config: Partial<VaultConfig>): Promise<VaultConfig> {
    return this.invoke("local-vault:update-config", config);
  }

  // ---- Connectors ----

  listConnectors(): Promise<ConnectorConfig[]> {
    return this.invoke("local-vault:connector:list");
  }

  getConnector(id: string): Promise<ConnectorConfig> {
    return this.invoke("local-vault:connector:get", id);
  }

  addConnector(config: {
    type: ConnectorType;
    name: string;
    description?: string;
    sourcePath?: string;
    sourceUrl?: string;
    watchPattern?: string;
    autoImport?: boolean;
    requirePreview?: boolean;
    allowedMimeTypes?: string[];
    maxFileSize?: number;
    excludePatterns?: string[];
    syncIntervalMinutes?: number;
  }): Promise<ConnectorConfig> {
    return this.invoke("local-vault:connector:add", config);
  }

  updateConnector(
    id: string,
    updates: Partial<{ name: string; description: string; status: string; autoImport: boolean }>,
  ): Promise<ConnectorConfig> {
    return this.invoke("local-vault:connector:update", id, updates);
  }

  removeConnector(id: string): Promise<void> {
    return this.invoke("local-vault:connector:remove", id);
  }

  enableConnector(id: string): Promise<ConnectorConfig> {
    return this.invoke("local-vault:connector:enable", id);
  }

  disableConnector(id: string): Promise<ConnectorConfig> {
    return this.invoke("local-vault:connector:disable", id);
  }

  // ---- Asset Import ----

  importFile(filePath: string, connectorId?: string): Promise<VaultAsset> {
    return this.invoke("local-vault:import:file", filePath, connectorId);
  }

  importFilesDialog(): Promise<VaultAsset[]> {
    return this.invoke("local-vault:import:files-dialog");
  }

  importFolder(
    folderPath: string,
    connectorId?: string,
    options?: { recursive?: boolean; allowedExtensions?: string[] },
  ): Promise<VaultAsset[]> {
    return this.invoke("local-vault:import:folder", folderPath, connectorId, options);
  }

  importFolderDialog(options?: { recursive?: boolean }): Promise<VaultAsset[]> {
    return this.invoke("local-vault:import:folder-dialog", options);
  }

  importText(name: string, content: string, connectorId?: string): Promise<VaultAsset> {
    return this.invoke("local-vault:import:text", name, content, connectorId);
  }

  // ---- Asset CRUD ----

  listAssets(filters?: {
    status?: string;
    modality?: string;
    connectorId?: string;
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ assets: VaultAsset[]; total: number }> {
    return this.invoke("local-vault:asset:list", filters);
  }

  getAsset(id: string): Promise<VaultAsset> {
    return this.invoke("local-vault:asset:get", id);
  }

  getAssetContent(id: string): Promise<string> {
    return this.invoke("local-vault:asset:content", id);
  }

  updateAsset(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      tags: string[];
      collections: string[];
      status: string;
    }>,
  ): Promise<VaultAsset> {
    return this.invoke("local-vault:asset:update", id, updates);
  }

  deleteAsset(id: string): Promise<void> {
    return this.invoke("local-vault:asset:delete", id);
  }

  // ---- Transform Pipeline ----

  createTransformJob(config: {
    name: string;
    inputAssetIds: string[];
    inputDatasetId?: string;
    stages: TransformStageConfig[];
  }): Promise<TransformJob> {
    return this.invoke("local-vault:transform:create", config);
  }

  getTransformJob(id: string): Promise<TransformJob> {
    return this.invoke("local-vault:transform:get", id);
  }

  listTransformJobs(limit?: number): Promise<TransformJob[]> {
    return this.invoke("local-vault:transform:list", limit);
  }

  runTransformJob(id: string): Promise<TransformJob> {
    return this.invoke("local-vault:transform:run", id);
  }

  // ---- Packaging ----

  createPackage(config: {
    name: string;
    version: string;
    description?: string;
    datasetId?: string;
    assetIds: string[];
    publisherWallet?: string;
  }): Promise<any> {
    return this.invoke("local-vault:package:create", config);
  }

  listPackages(limit?: number): Promise<any[]> {
    return this.invoke("local-vault:package:list", limit);
  }

  getPackage(id: string): Promise<any> {
    return this.invoke("local-vault:package:get", id);
  }

  // ---- Policy ----

  createPolicy(config: {
    manifestId: string;
    licenseTiers: Array<{
      tier: string;
      enabled: boolean;
      price?: number;
      currency?: string;
      maxAccesses?: number;
      expirationDays?: number;
      description: string;
    }>;
    allowedUses?: string[];
    restrictions?: string[];
    pricingModel?: string;
    priceAmount?: number;
    priceCurrency?: string;
    btcTaprootAddress?: string;
    sovereignExitEnabled?: boolean;
    publisherWallet?: string;
  }): Promise<any> {
    return this.invoke("local-vault:policy:create", config);
  }

  getPolicy(id: string): Promise<any> {
    return this.invoke("local-vault:policy:get", id);
  }

  getPolicyByManifest(manifestId: string): Promise<any> {
    return this.invoke("local-vault:policy:get-by-manifest", manifestId);
  }

  // ---- Publish Bundle ----

  createPublishBundle(config: {
    manifestId: string;
    policyId: string;
    listing: {
      name: string;
      description?: string;
      category?: string;
      tags?: string[];
      license?: string;
      pricingModel?: string;
      price?: number;
      currency?: string;
    };
    publisherWallet: string;
  }): Promise<any> {
    return this.invoke("local-vault:publish:create-bundle", config);
  }

  listPublishBundles(limit?: number): Promise<any[]> {
    return this.invoke("local-vault:publish:list-bundles", limit);
  }

  getPublishBundle(id: string): Promise<any> {
    return this.invoke("local-vault:publish:get-bundle", id);
  }

  // ---- Audit Log ----

  getAuditLog(limit?: number): Promise<VaultAuditEntry[]> {
    return this.invoke("local-vault:audit:list", limit);
  }
}
