/**
 * Sovereign Data Client
 * Renderer-side API for local-first encrypted data management
 */

import type {
  SovereignData,
  SovereignMetadata,
  ContentHash,
  StorageNetwork,
  DataType,
  DataVisibility,
  DataVault,
  LocalInference,
  DataListing,
  DataPurchase,
  DataLicense,
  DataPricing,
  OutboxJob,
  PolicyAuditEvent,
} from "../types/sovereign_data";

// ============================================================================
// IPC Helper
// ============================================================================

function getIpcRenderer() {
  return (window as any).electron.ipcRenderer;
}

// ============================================================================
// Singleton Client
// ============================================================================

export class SovereignDataClient {
  private static instance: SovereignDataClient;

  private constructor() {}

  public static getInstance(): SovereignDataClient {
    if (!SovereignDataClient.instance) {
      SovereignDataClient.instance = new SovereignDataClient();
    }
    return SovereignDataClient.instance;
  }

  // ===========================================================================
  // Vault Management
  // ===========================================================================

  /**
   * Get the user's data vault configuration
   */
  async getVault(): Promise<DataVault> {
    return getIpcRenderer().invoke("sovereign:get-vault");
  }

  /**
   * Update vault configuration
   */
  async updateVaultConfig(config: Partial<DataVault>): Promise<DataVault> {
    return getIpcRenderer().invoke("sovereign:update-vault-config", config);
  }

  /**
   * Enable or disable a storage network
   */
  async enableNetwork(network: StorageNetwork, enabled: boolean): Promise<DataVault> {
    return getIpcRenderer().invoke("sovereign:enable-network", network, enabled);
  }

  // ===========================================================================
  // Data Storage (Local-First)
  // ===========================================================================

  /**
   * Store data locally with encryption
   * Data is encrypted before storage and content-addressed
   */
  async storeData(params: {
    data: ArrayBuffer | Blob | string;
    dataType: DataType;
    metadata: SovereignMetadata;
    visibility?: DataVisibility;
    encrypt?: boolean;
  }): Promise<SovereignData> {
    // Convert data to base64
    let base64Data: string;
    
    if (typeof params.data === "string") {
      base64Data = btoa(params.data);
    } else if (params.data instanceof Blob) {
      const buffer = await params.data.arrayBuffer();
      base64Data = this.arrayBufferToBase64(buffer);
    } else {
      base64Data = this.arrayBufferToBase64(params.data);
    }

    return getIpcRenderer().invoke("sovereign:store-data", {
      data: base64Data,
      dataType: params.dataType,
      metadata: params.metadata,
      visibility: params.visibility,
      encrypt: params.encrypt,
    });
  }

  /**
   * Store a JSON object
   */
  async storeJSON<T>(
    data: T,
    dataType: DataType,
    metadata: SovereignMetadata,
    options?: { visibility?: DataVisibility; encrypt?: boolean }
  ): Promise<SovereignData> {
    const jsonString = JSON.stringify(data);
    return this.storeData({
      data: jsonString,
      dataType,
      metadata,
      ...options,
    });
  }

  /**
   * Store a file
   */
  async storeFile(
    file: File,
    dataType: DataType,
    metadata?: Partial<SovereignMetadata>,
    options?: { visibility?: DataVisibility; encrypt?: boolean }
  ): Promise<SovereignData> {
    const buffer = await file.arrayBuffer();
    return this.storeData({
      data: buffer,
      dataType,
      metadata: {
        name: file.name,
        description: `Uploaded file: ${file.name}`,
        tags: [file.type],
        category: dataType,
        ...metadata,
      },
      ...options,
    });
  }

  /**
   * Retrieve data by ID
   */
  async retrieveData<T = unknown>(dataId: string): Promise<SovereignData & { data?: string }> {
    const result = await getIpcRenderer().invoke("sovereign:retrieve-data", dataId);
    
    // Decode base64 data if present
    if (result.data) {
      try {
        const decoded = atob(result.data);
        result.data = JSON.parse(decoded);
      } catch {
        // Keep as base64 if not JSON
      }
    }
    
    return result;
  }

  /**
   * Retrieve raw binary data
   */
  async retrieveRawData(dataId: string): Promise<ArrayBuffer> {
    const result = await getIpcRenderer().invoke("sovereign:retrieve-data", dataId);
    if (!result.data) {
      throw new Error("No data content available");
    }
    return this.base64ToArrayBuffer(result.data);
  }

  /**
   * List all stored data with optional filters
   */
  async listData(filters?: {
    dataType?: DataType;
    visibility?: DataVisibility;
    network?: StorageNetwork;
  }): Promise<SovereignData[]> {
    return getIpcRenderer().invoke("sovereign:list-data", filters);
  }

  /**
   * Delete data from local storage
   */
  async deleteData(dataId: string): Promise<void> {
    return getIpcRenderer().invoke("sovereign:delete-data", dataId);
  }

  // ===========================================================================
  // Decentralized Network Sync
  // ===========================================================================

  /**
   * Sync data to a decentralized network
   */
  async syncToNetwork(dataId: string, network: StorageNetwork): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:sync-to-network", dataId, network);
  }

  /**
   * Pin data to IPFS network
   */
  async pinToIPFS(dataId: string): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:pin-to-ipfs", dataId);
  }

  /**
   * Store permanently on Arweave
   */
  async storeOnArweave(dataId: string): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:store-on-arweave", dataId);
  }

  /**
   * Store on Filecoin for cost-effective long-term storage
   */
  async storeOnFilecoin(dataId: string): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:sync-to-network", dataId, "filecoin");
  }

  /**
   * Get content hash for a specific network
   */
  getNetworkHash(data: SovereignData, network: StorageNetwork): ContentHash | undefined {
    return data.hashes.find((h) => h.network === network);
  }

  /**
   * Get IPFS CID for data
   */
  getIPFSCID(data: SovereignData): string | undefined {
    return this.getNetworkHash(data, "ipfs")?.hash;
  }

  /**
   * Get Arweave transaction ID for data
   */
  getArweaveTxId(data: SovereignData): string | undefined {
    return this.getNetworkHash(data, "arweave")?.hash;
  }

  // ===========================================================================
  // Local Inference
  // ===========================================================================

  /**
   * Run local AI inference with verification
   */
  async runLocalInference(params: {
    modelId: string;
    input: ArrayBuffer | string;
    options?: Record<string, unknown>;
  }): Promise<LocalInference> {
    let inputBase64: string;
    
    if (typeof params.input === "string") {
      inputBase64 = btoa(params.input);
    } else {
      inputBase64 = this.arrayBufferToBase64(params.input);
    }

    return getIpcRenderer().invoke("sovereign:run-local-inference", {
      modelId: params.modelId,
      input: inputBase64,
      options: params.options,
    });
  }

  /**
   * Run inference with JSON input/output
   */
  async runInferenceJSON<TInput, TOutput>(
    modelId: string,
    input: TInput,
    options?: Record<string, unknown>
  ): Promise<LocalInference & { result?: TOutput }> {
    const result = await this.runLocalInference({
      modelId,
      input: JSON.stringify(input),
      options,
    });
    return result as LocalInference & { result?: TOutput };
  }

  // ===========================================================================
  // Data Sharing & Access Control
  // ===========================================================================

  /**
   * Share data with another user
   */
  async shareData(
    dataId: string,
    recipientPublicKey: string,
    permissions: string[]
  ): Promise<{
    dataId: string;
    sharedKeyId: string;
    recipientPublicKey: string;
    permissions: string[];
    grantedAt: string;
  }> {
    return getIpcRenderer().invoke("sovereign:share-data", dataId, recipientPublicKey, permissions);
  }

  /**
   * Revoke access from a user
   */
  async revokeAccess(dataId: string, recipientPublicKey: string): Promise<void> {
    return getIpcRenderer().invoke("sovereign:revoke-access", dataId, recipientPublicKey);
  }

  async updateConsent(
    dataId: string,
    params: { outboundGranted: boolean; paymentTxHash?: string }
  ): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:update-consent", dataId, params);
  }

  // ========================================================================
  // Offline-first Outbox
  // ========================================================================

  async queueSync(dataId: string, network: StorageNetwork): Promise<OutboxJob> {
    return getIpcRenderer().invoke("sovereign:queue-sync", dataId, network);
  }

  async queueShare(
    dataId: string,
    recipientPublicKey: string,
    permissions: string[]
  ): Promise<OutboxJob> {
    return getIpcRenderer().invoke("sovereign:queue-share", dataId, recipientPublicKey, permissions);
  }

  async listOutbox(): Promise<OutboxJob[]> {
    return getIpcRenderer().invoke("sovereign:list-outbox");
  }

  async processOutbox(): Promise<OutboxJob[]> {
    return getIpcRenderer().invoke("sovereign:process-outbox");
  }

  async listPolicyAudit(): Promise<PolicyAuditEvent[]> {
    return getIpcRenderer().invoke("sovereign:policy-audit");
  }

  // ===========================================================================
  // Marketplace Operations
  // ===========================================================================

  /**
   * Create a listing to sell/license data
   */
  async createListing(params: {
    dataId: string;
    dataHash: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    pricing: DataPricing;
    license: DataLicense;
    previewHash?: string;
  }): Promise<DataListing> {
    return getIpcRenderer().invoke("sovereign:create-listing", {
      ...params,
      seller: { did: "" }, // Will be filled by handler
      listedOn: [],
      status: "draft",
    });
  }

  /**
   * Get all listings
   */
  async getListings(): Promise<DataListing[]> {
    return getIpcRenderer().invoke("sovereign:get-listings");
  }

  async getPurchases(): Promise<DataPurchase[]> {
    return getIpcRenderer().invoke("sovereign:get-purchases");
  }

  /**
   * Record a purchase transaction
   */
  async recordPurchase(params: {
    listingId: string;
    dataHash: string;
    buyer: { did: string; publicKey: string };
    amount: number;
    currency: string;
    transactionHash?: string;
    encryptedAccessKey: string;
    license: DataLicense;
    status: DataPurchase["status"];
  }): Promise<DataPurchase> {
    return getIpcRenderer().invoke("sovereign:record-purchase", params);
  }

  // ===========================================================================
  // Export & Import
  // ===========================================================================

  /**
   * Export data for backup or transfer
   */
  async exportData(
    dataId: string,
    format: "json" | "encrypted-bundle" = "encrypted-bundle"
  ): Promise<unknown> {
    return getIpcRenderer().invoke("sovereign:export-data", dataId, format);
  }

  /**
   * Import data from a bundle
   */
  async importData(bundle: unknown): Promise<SovereignData> {
    return getIpcRenderer().invoke("sovereign:import-data", bundle);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Calculate hash of data (client-side)
   */
  async calculateHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Verify data integrity
   */
  async verifyIntegrity(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
    const actualHash = await this.calculateHash(data);
    return actualHash === expectedHash;
  }
}

// ===========================================================================
// Convenience Hooks for React
// ===========================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const client = SovereignDataClient.getInstance();

export const SOVEREIGN_QUERY_KEYS = {
  vault: ["sovereign", "vault"] as const,
  data: (id: string) => ["sovereign", "data", id] as const,
  dataList: (filters?: Record<string, unknown>) => ["sovereign", "data-list", filters] as const,
  listings: ["sovereign", "listings"] as const,
  outbox: ["sovereign", "outbox"] as const,
  policyAudit: ["sovereign", "policy-audit"] as const,
  purchases: ["sovereign", "purchases"] as const,
};

/**
 * Hook to get the user's data vault
 */
export function useDataVault() {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.vault,
    queryFn: () => client.getVault(),
  });
}

/**
 * Hook to update vault configuration
 */
export function useUpdateVaultConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: Partial<DataVault>) => client.updateVaultConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.vault });
    },
  });
}

/**
 * Hook to list sovereign data
 */
export function useSovereignDataList(filters?: {
  dataType?: DataType;
  visibility?: DataVisibility;
  network?: StorageNetwork;
}) {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.dataList(filters),
    queryFn: () => client.listData(filters),
  });
}

/**
 * Hook to retrieve a specific data item
 */
export function useSovereignData<T = unknown>(dataId: string | undefined) {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.data(dataId || ""),
    queryFn: () => client.retrieveData<T>(dataId!),
    enabled: !!dataId,
  });
}

/**
 * Hook to store new data
 */
export function useStoreData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: Parameters<typeof client.storeData>[0]) => 
      client.storeData(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sovereign", "data-list"] });
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.vault });
    },
  });
}

/**
 * Hook to store JSON data
 */
export function useStoreJSON<T>() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: {
      data: T;
      dataType: DataType;
      metadata: SovereignMetadata;
      options?: { visibility?: DataVisibility; encrypt?: boolean };
    }) => client.storeJSON(params.data, params.dataType, params.metadata, params.options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sovereign", "data-list"] });
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.vault });
    },
  });
}

/**
 * Hook to sync data to a decentralized network
 */
export function useSyncToNetwork() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: { dataId: string; network: StorageNetwork }) =>
      client.syncToNetwork(params.dataId, params.network),
    onSuccess: (_, { dataId }) => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.data(dataId) });
    },
  });
}

/**
 * Hook to run local inference
 */
export function useLocalInference() {
  return useMutation({
    mutationFn: (params: Parameters<typeof client.runLocalInference>[0]) =>
      client.runLocalInference(params),
  });
}

/**
 * Hook to delete data
 */
export function useDeleteData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dataId: string) => client.deleteData(dataId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sovereign", "data-list"] });
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.vault });
    },
  });
}

/**
 * Hook to share data
 */
export function useShareData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: { dataId: string; recipientPublicKey: string; permissions: string[] }) =>
      client.shareData(params.dataId, params.recipientPublicKey, params.permissions),
    onSuccess: (_, { dataId }) => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.data(dataId) });
    },
  });
}

/**
 * Hook to update outbound consent
 */
export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { dataId: string; outboundGranted: boolean; paymentTxHash?: string }) =>
      client.updateConsent(params.dataId, {
        outboundGranted: params.outboundGranted,
        paymentTxHash: params.paymentTxHash,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sovereign", "data-list"] });
    },
  });
}

/**
 * Hook to queue a sync job
 */
export function useQueueSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { dataId: string; network: StorageNetwork }) =>
      client.queueSync(params.dataId, params.network),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.outbox });
    },
  });
}

/**
 * Hook to queue a share job
 */
export function useQueueShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { dataId: string; recipientPublicKey: string; permissions: string[] }) =>
      client.queueShare(params.dataId, params.recipientPublicKey, params.permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.outbox });
    },
  });
}

/**
 * Hook to list outbox jobs
 */
export function useOutboxJobs() {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.outbox,
    queryFn: () => client.listOutbox(),
  });
}

/**
 * Hook to process outbox jobs
 */
export function useProcessOutbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.processOutbox(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.outbox });
    },
  });
}

export function usePolicyAudit() {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.policyAudit,
    queryFn: () => client.listPolicyAudit(),
  });
}

/**
 * Hook to create a marketplace listing
 */
export function useCreateListing() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: Parameters<typeof client.createListing>[0]) =>
      client.createListing(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SOVEREIGN_QUERY_KEYS.listings });
    },
  });
}

/**
 * Hook to get marketplace listings
 */
export function useListings() {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.listings,
    queryFn: () => client.getListings(),
  });
}

export function usePurchases() {
  return useQuery({
    queryKey: SOVEREIGN_QUERY_KEYS.purchases,
    queryFn: () => client.getPurchases(),
  });
}

export default SovereignDataClient;
