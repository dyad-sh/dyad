import { IpcClient } from "@/ipc/ipc_client";

/**
 * Service for syncing listings to joymarketplace.io.
 * Delegates to IPC marketplace-sync handlers.
 */
export class MarketplaceListingService {
  static async createListing(params: {
    name: string;
    description: string;
    category: string;
    contentCid: string;
    price: number;
    currency: string;
    royaltyPercent: number;
    tokenId?: string;
    contractAddress?: string;
  }) {
    const ipc = IpcClient.getInstance();
    return ipc.invoke("marketplace-sync:sync-listing", params);
  }

  /** Full listing call used by the CreateAssetWizard (fire-and-forget DB cache). */
  static async listAsset(params: Record<string, unknown>) {
    try {
      const ipc = IpcClient.getInstance();
      const result = await ipc.invoke("marketplace-sync:sync-listing", params);
      return { success: true, assetId: (result as Record<string, unknown>)?.assetId ?? "unknown" };
    } catch (e: unknown) {
      console.warn("[MarketplaceListingService] listAsset failed:", e);
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  static async getStoreListing(storeId: string) {
    const ipc = IpcClient.getInstance();
    return ipc.invoke("marketplace-sync:get-store-from-domain", { domain: storeId });
  }
}
