/**
 * JoyMarketplace IPC Handlers
 *
 * Fire-and-forget architecture:
 *   1. Verify API key via joy-create-verify edge function
 *   2. Pin to IPFS (Pinata / Helia)
 *   3. Lazy-mint DropERC1155 on Polygon Amoy
 *   4. List on MarketplaceV3
 *   5. Goldsky subgraphs index it → marketplace UI picks it up
 *
 * No backend publish/browse/earnings endpoints — those read from subgraphs.
 */

import { ipcMain, app } from "electron";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import AdmZip from "adm-zip";
import { getJoyAppPath } from "../../paths/paths";
import { JOYMARKETPLACE_API } from "@/config/joymarketplace";
import {
  getMarketplaceAssets,
  getMarketplaceListings,
  getMarketplaceStats,
  getUserDomains,
} from "@/lib/subgraph_client";
import type {
  PublishAppRequest,
  PublishAppResponse,
  MarketplaceCredentials,
  DeploymentStatus,
  AppBundle,
  PublishModelRequest,
  ModelBundle,
  BundleFile,
} from "@/types/marketplace_types";

const logger = log.scope("marketplace_handlers");

const MARKETPLACE_WEB_URL = JOYMARKETPLACE_API.webUrl;

// Store credentials in memory (should be persisted in settings)
let marketplaceCredentials: MarketplaceCredentials | null = null;

/**
 * Get the marketplace credentials file path
 */
function getCredentialsPath(): string {
  return path.join(app.getPath("userData"), "marketplace-credentials.json");
}

/**
 * Load marketplace credentials from disk
 */
async function loadCredentials(): Promise<MarketplaceCredentials | null> {
  try {
    const credPath = getCredentialsPath();
    if (await fs.pathExists(credPath)) {
      const data = await fs.readJson(credPath);
      marketplaceCredentials = data;
      return data;
    }
  } catch (error) {
    logger.error("Failed to load marketplace credentials:", error);
  }
  return null;
}

/**
 * Save marketplace credentials to disk
 */
async function saveCredentials(credentials: MarketplaceCredentials): Promise<void> {
  try {
    const credPath = getCredentialsPath();
    await fs.writeJson(credPath, credentials, { spaces: 2 });
    marketplaceCredentials = credentials;
  } catch (error) {
    logger.error("Failed to save marketplace credentials:", error);
    throw error;
  }
}

/**
 * Call the joy-create-verify edge function to verify an API key.
 * Returns { ok, user_id, scopes, network } on success.
 */
async function verifyApiKey(apiKey: string): Promise<{
  ok: boolean;
  user_id: string;
  scopes: string[];
  network: {
    chain: string;
    chain_id: number;
    drop_subgraph: string;
    marketplace_subgraph: string;
    stores_subgraph: string;
  };
}> {
  const url = `${JOYMARKETPLACE_API.baseUrl}${JOYMARKETPLACE_API.endpoints.verify}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "x-joy-api-key": apiKey,
      "apikey": JOYMARKETPLACE_API.supabaseAnonKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Verification failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error("API key verification returned ok=false");
  }
  return data;
}

/**
 * Bundle an app for upload
 */
async function bundleApp(appId: number): Promise<AppBundle> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!appRecord) {
    throw new Error("App not found");
  }

  const appPath = getJoyAppPath(appRecord.path);
  
  if (!await fs.pathExists(appPath)) {
    throw new Error("App directory not found");
  }

  const bundle: AppBundle = {
    appId,
    appName: appRecord.name,
    files: [],
    totalSize: 0,
    createdAt: new Date().toISOString(),
  };

  // Files/folders to exclude from bundle
  const excludePatterns = [
    "node_modules",
    ".git",
    ".env",
    ".env.local",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
  ];

  async function collectFiles(dir: string, relativePath: string = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      // Skip excluded patterns
      if (excludePatterns.some(pattern => entry.name === pattern || entry.name.startsWith("."))) {
        continue;
      }

      if (entry.isDirectory()) {
        await collectFiles(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath);
          const base64Content = content.toString("base64");
          bundle.files.push({
            path: relPath.replace(/\\/g, "/"),
            content: base64Content,
            size: content.length,
          });
          bundle.totalSize += content.length;
        } catch (error) {
          logger.warn(`Failed to read file ${fullPath}:`, error);
        }
      }
    }
  }

  await collectFiles(appPath);
  
  logger.info(`Bundled app ${appRecord.name}: ${bundle.files.length} files, ${(bundle.totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  return bundle;
}

/**
 * Create a ZIP file from the app
 */
async function createAppZip(appId: number): Promise<string> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!appRecord) {
    throw new Error("App not found");
  }

  const appPath = getJoyAppPath(appRecord.path);
  const tempDir = path.join(app.getPath("temp"), "joycreate-exports");
  await fs.ensureDir(tempDir);
  
  const zipPath = path.join(tempDir, `${appRecord.name.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.zip`);
  
  const zip = new AdmZip();
  
  const excludePatterns = [
    "node_modules",
    ".git",
    ".env",
    ".env.local",
    "dist",
    "build",
    ".next",
    ".cache",
  ];

  async function addFilesToZip(dir: string, zipPath: string = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      
      if (excludePatterns.some(pattern => entry.name === pattern)) {
        continue;
      }

      if (entry.isDirectory()) {
        await addFilesToZip(fullPath, entryZipPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath);
          zip.addFile(entryZipPath, content);
        } catch (error) {
          logger.warn(`Failed to add file ${fullPath} to zip:`, error);
        }
      }
    }
  }

  await addFilesToZip(appPath);
  zip.writeZip(zipPath);
  
  logger.info(`Created ZIP for app ${appRecord.name}: ${zipPath}`);
  
  return zipPath;
}

/**
 * Bundle a trained model/adapter for upload
 */
async function bundleModel(adapterPath: string, name: string, baseModelId: string): Promise<ModelBundle> {
  if (!await fs.pathExists(adapterPath)) {
    throw new Error("Adapter directory not found");
  }

  const bundle: ModelBundle = {
    name,
    baseModelId,
    files: [],
    totalSize: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
  };

  // Read adapter_config.json for metadata if present
  const configPath = path.join(adapterPath, "adapter_config.json");
  if (await fs.pathExists(configPath)) {
    try {
      const config = await fs.readJson(configPath);
      bundle.metadata = {
        peft_type: config.peft_type || "unknown",
        r: String(config.r || ""),
        lora_alpha: String(config.lora_alpha || ""),
        base_model_name_or_path: config.base_model_name_or_path || baseModelId,
      };
    } catch {
      // ignore parse errors
    }
  }

  // Collect all files in the adapter directory
  const entries = await fs.readdir(adapterPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(adapterPath, entry.name);
    try {
      const content = await fs.readFile(fullPath);
      const file: BundleFile = {
        path: entry.name,
        content: content.toString("base64"),
        size: content.length,
      };
      bundle.files.push(file);
      bundle.totalSize += content.length;
    } catch (error) {
      logger.warn(`Failed to read adapter file ${fullPath}:`, error);
    }
  }

  logger.info(`Bundled model ${name}: ${bundle.files.length} files, ${(bundle.totalSize / 1024 / 1024).toFixed(2)} MB`);
  return bundle;
}

/**
 * Register all marketplace IPC handlers
 */
export function registerMarketplaceHandlers() {
  // Check marketplace connection status
  ipcMain.handle("marketplace:status", async () => {
    try {
      await loadCredentials();
      
      if (!marketplaceCredentials?.apiKey) {
        return {
          connected: false,
          profile: null,
        };
      }

      // Re-verify credentials with the edge function
      const data = await verifyApiKey(marketplaceCredentials.apiKey);

      // Refresh domain list
      let domains: string[] = [];
      try {
        const domainRegs = await getUserDomains(data.user_id);
        domains = domainRegs.map((d) => d.fullName || `${d.name}.joy`);
      } catch {
        // Use cached domains if subgraph is unreachable
        domains = marketplaceCredentials.domains ?? [];
      }
      
      return {
        connected: true,
        profile: {
          id: data.user_id,
          scopes: data.scopes,
          network: data.network,
          hasJoyDomain: domains.length > 0,
          domains,
        },
      };
    } catch (error) {
      logger.error("Failed to check marketplace status:", error);
      return {
        connected: false,
        profile: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Connect to marketplace (authenticate via joy-create-verify)
  ipcMain.handle("marketplace:connect", async (_, apiKey: string) => {
    try {
      const data = await verifyApiKey(apiKey);
      
      // Look up .joy domains owned by this user via the stores subgraph
      let domains: string[] = [];
      try {
        const domainRegs = await getUserDomains(data.user_id);
        domains = domainRegs.map((d) => d.fullName || `${d.name}.joy`);
      } catch (err) {
        logger.warn("Failed to fetch .joy domains (non-fatal):", err);
      }

      const credentials: MarketplaceCredentials = {
        apiKey,
        publisherId: data.user_id,
        scopes: data.scopes,
        network: data.network,
        hasJoyDomain: domains.length > 0,
        domains,
      };
      
      await saveCredentials(credentials);
      
      logger.info(`Connected to JoyMarketplace (user=${data.user_id}, scopes=${data.scopes.join(",")}, domains=${domains.length})`);
      
      return {
        success: true,
        userId: data.user_id,
        scopes: data.scopes,
        network: data.network,
        hasJoyDomain: domains.length > 0,
        domains,
      };
    } catch (error) {
      logger.error("Failed to connect to marketplace:", error);
      throw error;
    }
  });

  // Disconnect from marketplace
  ipcMain.handle("marketplace:disconnect", async () => {
    try {
      const credPath = getCredentialsPath();
      if (await fs.pathExists(credPath)) {
        await fs.remove(credPath);
      }
      marketplaceCredentials = null;
      return { success: true };
    } catch (error) {
      logger.error("Failed to disconnect from marketplace:", error);
      throw error;
    }
  });

  // Get publisher profile — re-verify to get fresh scopes/network
  ipcMain.handle("marketplace:get-profile", async () => {
    await loadCredentials();
    if (!marketplaceCredentials?.apiKey) {
      throw new Error("Not connected to JoyMarketplace");
    }
    const data = await verifyApiKey(marketplaceCredentials.apiKey);
    return {
      id: data.user_id,
      scopes: data.scopes,
      network: data.network,
    };
  });

  // Get published assets — read from Goldsky marketplace subgraph
  ipcMain.handle("marketplace:list-assets", async () => {
    await loadCredentials();
    if (!marketplaceCredentials?.publisherId) {
      throw new Error("Not connected to JoyMarketplace");
    }
    // Query subgraph for assets created by this publisher
    return getMarketplaceAssets({ creator: marketplaceCredentials.publisherId });
  });

  // Get single asset details — read from subgraph
  ipcMain.handle("marketplace:get-asset", async (_, assetId: string) => {
    const assets = await getMarketplaceAssets();
    const asset = assets.find((a) => a.id === assetId || a.tokenId === assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    return asset;
  });

  // Publish app — fire-and-forget: bundle → IPFS → on-chain.
  // The actual IPFS pinning + lazy-mint + MarketplaceV3 listing is driven
  // by the renderer's CreateAssetWizard (Thirdweb SDK). This handler just
  // prepares the bundle so the wizard has the files to pin.
  ipcMain.handle("marketplace:publish", async (_, request: PublishAppRequest): Promise<PublishAppResponse> => {
    try {
      logger.info(`Bundling app ${request.appId} for marketplace publish...`);
      const bundle = await bundleApp(request.appId);

      // Return the bundle metadata — the renderer will pin to IPFS,
      // lazy-mint on DropERC1155, and list on MarketplaceV3.
      return {
        success: true,
        status: "pending-review",
        message: `App bundled (${bundle.files.length} files, ${(bundle.totalSize / 1024 / 1024).toFixed(1)} MB). Ready for on-chain publish.`,
        assetUrl: undefined,
        assetId: undefined,
      };
    } catch (error) {
      logger.error("Failed to bundle app for publish:", error);
      return {
        success: false,
        status: "rejected",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Publish trained model/adapter — same fire-and-forget pattern
  ipcMain.handle("marketplace:publish-model", async (_, request: PublishModelRequest): Promise<PublishAppResponse> => {
    try {
      logger.info(`Bundling model ${request.name} for marketplace publish...`);
      const bundle = await bundleModel(request.adapterPath, request.name, request.baseModelId);

      return {
        success: true,
        status: "pending-review",
        message: `Model bundled (${bundle.files.length} files, ${(bundle.totalSize / 1024 / 1024).toFixed(1)} MB). Ready for on-chain publish.`,
        assetUrl: undefined,
        assetId: undefined,
      };
    } catch (error) {
      logger.error("Failed to bundle model for publish:", error);
      return {
        success: false,
        status: "rejected",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Update/unpublish are on-chain operations — not backend calls
  ipcMain.handle("marketplace:update-asset", async () => {
    throw new Error("Asset updates are performed on-chain via the MarketplaceV3 contract. Use the CreateAssetWizard.");
  });

  ipcMain.handle("marketplace:unpublish", async () => {
    throw new Error("Unpublishing is performed on-chain via the MarketplaceV3 contract.");
  });

  // Pre-flight mint eligibility — verifies wallet owns a .joy domain
  // before the renderer attempts a JoyCreatorGate.mint() transaction.
  ipcMain.handle("marketplace:check-mint-eligibility", async (_, walletAddress: string) => {
    if (!walletAddress) {
      throw new Error("Wallet address is required for mint eligibility check");
    }

    const domainRegs = await getUserDomains(walletAddress);
    const domains = domainRegs.map((d) => d.fullName || `${d.name}.joy`);
    const eligible = domains.length > 0;

    if (!eligible) {
      logger.warn(`Mint pre-flight failed: wallet ${walletAddress} owns no .joy domains`);
    }

    return {
      eligible,
      domains,
      reason: eligible
        ? undefined
        : "You must own a .joy domain to mint on the JoyCreate platform. Register one at joymarketplace.io.",
    };
  });

  // Get earnings — read from Goldsky marketplace subgraph
  ipcMain.handle("marketplace:earnings", async () => {
    await loadCredentials();
    const stats = await getMarketplaceStats();
    const listings = marketplaceCredentials?.publisherId
      ? await getMarketplaceListings({ seller: marketplaceCredentials.publisherId })
      : [];

    const totalEarnings = listings.reduce((sum, l) => sum + Number(l.totalPaid || 0), 0);

    return {
      totalEarnings,
      thisMonth: 0,
      lastMonth: 0,
      pendingPayout: 0,
      salesCount: listings.filter((l) => l.buyer).length,
      topAssets: listings
        .filter((l) => l.buyer)
        .slice(0, 10)
        .map((l) => ({
          assetId: l.id,
          name: l.asset?.name ?? l.listingId,
          earnings: Number(l.totalPaid || 0),
          sales: 1,
        })),
      marketplaceStats: stats,
    };
  });

  // Export app as ZIP for manual upload
  ipcMain.handle("marketplace:export-zip", async (_, appId: number) => {
    try {
      const zipPath = await createAppZip(appId);
      return {
        success: true,
        path: zipPath,
      };
    } catch (error) {
      logger.error("Failed to export app as ZIP:", error);
      throw error;
    }
  });

  // Get deployment status for an app
  ipcMain.handle("marketplace:deployment-status", async (_, appId: number): Promise<DeploymentStatus> => {
    // For now, return idle status
    // In production, this would check actual deployment status
    return {
      target: "joymarketplace",
      status: "idle",
    };
  });

  // Open marketplace in browser
  ipcMain.handle("marketplace:open", async (_, path?: string) => {
    const { shell } = await import("electron");
    const url = path ? `${MARKETPLACE_WEB_URL}${path}` : MARKETPLACE_WEB_URL;
    await shell.openExternal(url);
    return { success: true };
  });

  // Get marketplace URL
  ipcMain.handle("marketplace:get-url", async () => {
    return {
      apiUrl: JOYMARKETPLACE_API.baseUrl,
      webUrl: MARKETPLACE_WEB_URL,
    };
  });

  logger.info("Marketplace IPC handlers registered");
}
