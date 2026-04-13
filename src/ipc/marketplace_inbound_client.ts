/**
 * Marketplace Inbound Client
 * Renderer-side API for receiving inbound sync events from Joy Marketplace.
 *
 * Usage in any React component:
 *
 *   import { MarketplaceInboundClient } from "@/ipc/marketplace_inbound_client";
 *
 *   useEffect(() => {
 *     const unsub = MarketplaceInboundClient.onListingCreated((e) => {
 *       console.log("New listing from bot:", e.botId);
 *     });
 *     return unsub; // cleanup on unmount
 *   }, []);
 */

import type { IpcRenderer } from "electron";
import type { MarketplaceInboundEvent } from "./handlers/marketplace_inbound_handlers";

function getIpc(): IpcRenderer {
  const ipc = (window as any).electron?.ipcRenderer;
  if (!ipc) throw new Error("IPC not available — are you running in Electron?");
  return ipc;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListingCreatedEvent {
  assetId: string;
  botId?: string;
  storeId?: string;
  timestamp: string;
}

export interface ListingUpdatedEvent {
  assetId: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface AssetSoldEvent {
  assetId: string;
  amountUsd?: number;
  currency?: string;
  buyerId?: string;
  txHash?: string;
  timestamp: string;
}

export interface RoyaltyPaidEvent {
  assetId: string;
  amountUsd?: number;
  currency?: string;
  txHash?: string;
  timestamp: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export const MarketplaceInboundClient = {
  /**
   * Subscribe to any inbound marketplace event (raw).
   * Returns an unsubscribe function.
   */
  onEvent(callback: (event: MarketplaceInboundEvent) => void): () => void {
    const ipc = getIpc();
    const handler = (_: unknown, event: MarketplaceInboundEvent) => callback(event);
    ipc.on("marketplace:inbound:event", handler);
    return () => ipc.removeListener("marketplace:inbound:event", handler);
  },

  /** Subscribe to new listing / asset synced events. Returns unsubscribe fn. */
  onListingCreated(callback: (event: ListingCreatedEvent) => void): () => void {
    const ipc = getIpc();
    const handler = (_: unknown, event: ListingCreatedEvent) => callback(event);
    ipc.on("marketplace:inbound:listing-created", handler);
    return () => ipc.removeListener("marketplace:inbound:listing-created", handler);
  },

  /** Subscribe to listing updated events. Returns unsubscribe fn. */
  onListingUpdated(callback: (event: ListingUpdatedEvent) => void): () => void {
    const ipc = getIpc();
    const handler = (_: unknown, event: ListingUpdatedEvent) => callback(event);
    ipc.on("marketplace:inbound:listing-updated", handler);
    return () => ipc.removeListener("marketplace:inbound:listing-updated", handler);
  },

  /** Subscribe to asset sold events. Returns unsubscribe fn. */
  onAssetSold(callback: (event: AssetSoldEvent) => void): () => void {
    const ipc = getIpc();
    const handler = (_: unknown, event: AssetSoldEvent) => callback(event);
    ipc.on("marketplace:inbound:asset-sold", handler);
    return () => ipc.removeListener("marketplace:inbound:asset-sold", handler);
  },

  /** Subscribe to royalty paid events. Returns unsubscribe fn. */
  onRoyaltyPaid(callback: (event: RoyaltyPaidEvent) => void): () => void {
    const ipc = getIpc();
    const handler = (_: unknown, event: RoyaltyPaidEvent) => callback(event);
    ipc.on("marketplace:inbound:royalty-paid", handler);
    return () => ipc.removeListener("marketplace:inbound:royalty-paid", handler);
  },

  /**
   * Manually process an inbound event (triggers the main-process handler).
   * Useful for testing from the renderer devtools.
   */
  async processEvent(event: MarketplaceInboundEvent): Promise<{ success: boolean; processed: boolean }> {
    return getIpc().invoke("marketplace-inbound:process", event);
  },

  /** Fire a test event to verify the UI wiring works. */
  async testEvent(): Promise<{ success: boolean; processed: boolean }> {
    return getIpc().invoke("marketplace-inbound:test");
  },
};
