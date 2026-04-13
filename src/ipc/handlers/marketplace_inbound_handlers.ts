/**
 * Marketplace Inbound Sync Handlers
 *
 * Handles inbound sync events pushed FROM Joy Marketplace TO JoyCreate.
 * This is the "reverse" of joycreate-sync-listing — when Joy Bot or another
 * external publisher creates/updates an asset on Joy Marketplace, it fires a
 * webhook to this app's local HTTP server, which routes here.
 *
 * Events received:
 *   - asset_synced      : Asset created on Marketplace by Joy Bot
 *   - listing_created   : New listing added (from joy-bot-api or joycreate-sync)
 *   - listing_updated   : Existing listing updated
 *   - asset_sold        : Asset purchased by a buyer
 *   - royalty_paid      : Royalty payment processed
 *
 * On receipt, each event is:
 *   1. Logged locally
 *   2. Forwarded to the renderer via webContents.send so the UI can update
 */

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log";

const logger = log.scope("marketplace-inbound");

// ─── Types ────────────────────────────────────────────────────────────────────

export type InboundEventType =
  | "asset_synced"
  | "listing_created"
  | "listing_updated"
  | "asset_sold"
  | "royalty_paid";

export interface MarketplaceInboundEvent {
  type: InboundEventType;
  asset_id: string;
  bot_id?: string;
  store_id?: string;
  amount_usd?: number;
  currency?: string;
  tx_hash?: string;
  buyer_id?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

// ─── Broadcast helper (mirrors pattern in task_execution_handlers.ts) ─────────

function broadcastToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

// ─── Core handler ─────────────────────────────────────────────────────────────

/**
 * processInboundEvent
 *
 * Called both by the HTTP inbound route (marketplace-inbound:http-event IPC)
 * and directly from the MCP server's /sync/inbound route.
 * Returns { success, processed } — never throws.
 */
export async function processInboundEvent(
  event: MarketplaceInboundEvent,
): Promise<{ success: boolean; processed: boolean; error?: string }> {
  try {
    logger.info(`📥 Inbound marketplace event: ${event.type} | asset: ${event.asset_id}`);

    // Validate required fields
    if (!event.type || !event.asset_id || !event.timestamp) {
      logger.warn("⚠️ Invalid inbound event — missing required fields", event);
      return { success: false, processed: false, error: "Missing required fields: type, asset_id, timestamp" };
    }

    // Route by event type
    switch (event.type) {
      case "asset_synced":
      case "listing_created":
        logger.info(`✅ New listing on Marketplace: ${event.asset_id}${event.bot_id ? ` (bot: ${event.bot_id})` : ""}`);
        broadcastToRenderer("marketplace:inbound:listing-created", {
          assetId: event.asset_id,
          botId: event.bot_id,
          storeId: event.store_id,
          timestamp: event.timestamp,
        });
        break;

      case "listing_updated":
        logger.info(`🔄 Listing updated on Marketplace: ${event.asset_id}`);
        broadcastToRenderer("marketplace:inbound:listing-updated", {
          assetId: event.asset_id,
          timestamp: event.timestamp,
          payload: event.payload,
        });
        break;

      case "asset_sold":
        logger.info(`💰 Asset sold: ${event.asset_id} | amount: $${event.amount_usd ?? 0}`);
        broadcastToRenderer("marketplace:inbound:asset-sold", {
          assetId: event.asset_id,
          amountUsd: event.amount_usd,
          currency: event.currency,
          buyerId: event.buyer_id,
          txHash: event.tx_hash,
          timestamp: event.timestamp,
        });
        break;

      case "royalty_paid":
        logger.info(`👑 Royalty paid: ${event.asset_id} | amount: $${event.amount_usd ?? 0}`);
        broadcastToRenderer("marketplace:inbound:royalty-paid", {
          assetId: event.asset_id,
          amountUsd: event.amount_usd,
          currency: event.currency,
          txHash: event.tx_hash,
          timestamp: event.timestamp,
        });
        break;

      default:
        logger.warn(`⚠️ Unknown inbound event type: ${(event as any).type}`);
        return { success: true, processed: false };
    }

    // Always broadcast the raw event for any custom listeners in renderer
    broadcastToRenderer("marketplace:inbound:event", event);

    return { success: true, processed: true };
  } catch (err: any) {
    logger.error("❌ Error processing inbound marketplace event:", err);
    return { success: false, processed: false, error: err?.message ?? "Unknown error" };
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

export function registerMarketplaceInboundHandlers(): void {
  /**
   * marketplace-inbound:process
   * Called by the HTTP layer (MCP server) after receiving a /sync/inbound POST.
   * Also available for manual testing from the renderer.
   */
  ipcMain.handle(
    "marketplace-inbound:process",
    async (_event, inboundEvent: MarketplaceInboundEvent) => {
      return processInboundEvent(inboundEvent);
    },
  );

  /**
   * marketplace-inbound:test
   * Fires a synthetic inbound event for UI testing without a real webhook.
   */
  ipcMain.handle("marketplace-inbound:test", async () => {
    return processInboundEvent({
      type: "listing_created",
      asset_id: `test-${Date.now()}`,
      bot_id: "test-bot",
      store_id: "test-store",
      timestamp: new Date().toISOString(),
      payload: { source: "manual_test" },
    });
  });

  logger.info("✅ Marketplace inbound handlers registered");
}
