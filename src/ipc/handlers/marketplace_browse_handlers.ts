/**
 * Marketplace Browse IPC Handlers
 * Handles browsing, searching, and installing assets from JoyMarketplace
 */

import { ipcMain, app } from "electron";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import type {
  MarketplaceBrowseParams,
  MarketplaceBrowseResult,
  MarketplaceAssetDetail,
  InstallAssetRequest,
  InstallAssetResult,
} from "@/types/publish_types";

const logger = log.scope("marketplace_browse");

const MARKETPLACE_API_URL =
  process.env.JOYMARKETPLACE_API_URL || "https://api.joymarketplace.io";

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

/**
 * Unauthenticated marketplace GET — browsing is public
 */
async function browseRequest<T>(
  endpoint: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${MARKETPLACE_API_URL}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Attach auth if available (for personalized results like "installed")
  const apiKey = await getApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Marketplace API error: ${response.status} — ${body}`
    );
  }

  return response.json();
}

export function registerMarketplaceBrowseHandlers() {
  // Browse / search marketplace assets
  ipcMain.handle(
    "marketplace:browse",
    async (_, params: MarketplaceBrowseParams): Promise<MarketplaceBrowseResult> => {
      logger.info("Browsing marketplace", params);
      return browseRequest<MarketplaceBrowseResult>("/v1/assets/browse", {
        q: params.query,
        category: params.category,
        type: params.assetType,
        pricing: params.pricingModel,
        sort: params.sortBy,
        page: params.page,
        pageSize: params.pageSize,
      });
    }
  );

  // Get full detail for a single asset
  ipcMain.handle(
    "marketplace:asset-detail",
    async (_, assetId: string): Promise<MarketplaceAssetDetail> => {
      if (!assetId) throw new Error("assetId is required");
      return browseRequest<MarketplaceAssetDetail>(`/v1/assets/${encodeURIComponent(assetId)}`);
    }
  );

  // Install an asset from the marketplace into the local environment
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

      // Download the asset bundle from marketplace
      const url = `${MARKETPLACE_API_URL}/v1/assets/${encodeURIComponent(request.assetId)}/download`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Download failed: ${response.status} — ${body}`);
      }

      const bundle = (await response.json()) as {
        files?: { path: string; content: string }[];
        config?: Record<string, unknown>;
        localId?: string | number;
      };

      // The actual installation is asset-type-specific. For now we persist the
      // downloaded bundle to a staging folder and return the reference so the
      // renderer can redirect the user to the appropriate editor.
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
        bundle,
      });

      logger.info(`Asset ${request.assetId} staged at ${stagingDir}`);

      return {
        installed: true,
        localId: bundle.localId ?? request.assetId,
        message: `${request.assetType} installed successfully`,
      };
    }
  );

  // Get featured / editorial picks
  ipcMain.handle("marketplace:featured", async () => {
    return browseRequest<MarketplaceBrowseResult>("/v1/assets/featured");
  });

  // Get categories with counts
  ipcMain.handle("marketplace:categories", async () => {
    return browseRequest<{ category: string; count: number }[]>(
      "/v1/assets/categories"
    );
  });
}
