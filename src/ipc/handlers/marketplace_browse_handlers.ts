/**
 * Marketplace Browse IPC Handlers
 *
 * Fire-and-forget architecture — browse data comes from Goldsky subgraphs,
 * not a backend API. Assets are indexed on-chain after lazy-mint + listing.
 */

import { ipcMain, app } from "electron";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import {
  getMarketplaceAssets,
  getMarketplaceListings,
  getMarketplaceStats,
  getAIModels,
} from "@/lib/subgraph_client";
import type {
  InstallAssetRequest,
  InstallAssetResult,
} from "@/types/publish_types";

const logger = log.scope("marketplace_browse");

/**
 * Load cached credentials (same store as marketplace_handlers.ts)
 */
async function getApiKey(): Promise<string | null> {
  try {
    const credPath = path.join(
      app.getPath("userData"),
      "marketplace-credentials.json"
    );
    if (await fs.pathExists(credPath)) {
      const data = await fs.readJson(credPath);
      return data?.apiKey ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function registerMarketplaceBrowseHandlers() {
  // Browse / search marketplace assets — reads from Goldsky marketplace subgraph
  ipcMain.handle(
    "marketplace:browse",
    async (_, params: {
      query?: string;
      category?: string;
      assetType?: string;
      page?: number;
      pageSize?: number;
    }) => {
      logger.info("Browsing marketplace via subgraph", params);
      const pageSize = params.pageSize ?? 20;
      const page = params.page ?? 1;
      const skip = (page - 1) * pageSize;

      const [assets, listings, stats] = await Promise.all([
        getMarketplaceAssets({
          first: pageSize,
          skip,
          ...(params.assetType ? { assetType: params.assetType } : {}),
        }),
        getMarketplaceListings({ first: pageSize, skip, activeOnly: true }),
        getMarketplaceStats(),
      ]);

      return {
        assets,
        listings,
        total: stats?.totalListings ?? assets.length,
        page,
        pageSize,
      };
    }
  );

  // Get full detail for a single asset — from subgraph
  ipcMain.handle(
    "marketplace:asset-detail",
    async (_, assetId: string) => {
      if (!assetId) throw new Error("assetId is required");
      const assets = await getMarketplaceAssets();
      const asset = assets.find((a) => a.id === assetId || a.tokenId === assetId);
      if (!asset) throw new Error(`Asset not found: ${assetId}`);
      return asset;
    }
  );

  // Install an asset — download from IPFS using the asset's contentCid
  ipcMain.handle(
    "marketplace:install-asset",
    async (_, request: InstallAssetRequest): Promise<InstallAssetResult> => {
      if (!request.assetId) throw new Error("assetId is required");

      logger.info(`Installing asset ${request.assetId} (type: ${request.assetType})`);

      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new Error(
          "Not authenticated with JoyMarketplace. Connect your account first."
        );
      }

      // In fire-and-forget architecture, asset content lives on IPFS.
      // The renderer should resolve the asset's contentCid from the subgraph
      // and fetch directly from IPFS gateway. This handler stages metadata.
      const stagingDir = path.join(
        app.getPath("userData"),
        "marketplace-installs",
        request.assetId
      );
      await fs.ensureDir(stagingDir);
      await fs.writeJson(path.join(stagingDir, "manifest.json"), {
        assetId: request.assetId,
        assetType: request.assetType,
        installedAt: new Date().toISOString(),
      });

      logger.info(`Asset ${request.assetId} staged at ${stagingDir}`);

      return {
        installed: true,
        localId: request.assetId,
        message: `${request.assetType} install staged. Fetch content from IPFS.`,
      };
    }
  );

  // Get featured — top assets by totalSales from subgraph
  ipcMain.handle("marketplace:featured", async () => {
    const [assets, models] = await Promise.all([
      getMarketplaceAssets({ first: 12, orderBy: "totalSales", orderDirection: "desc" }),
      getAIModels({ first: 12, orderBy: "usageCount", orderDirection: "desc" }),
    ]);
    return { assets, models };
  });

  // Get categories with counts — derived from subgraph data
  ipcMain.handle("marketplace:categories", async () => {
    const assets = await getMarketplaceAssets({ first: 1000 });
    const counts = new Map<string, number>();
    for (const a of assets) {
      const cat = a.assetType || "other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
    }));
  });
}
