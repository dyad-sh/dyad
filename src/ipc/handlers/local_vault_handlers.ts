// =============================================================================
// Local Vault IPC Handlers — Main process handler registration
// =============================================================================

import { ipcMain, dialog, BrowserWindow } from "electron";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { datasetItems, studioDatasets } from "../../db/schema";
import { vaultAssets } from "../../db/vault_schema";
import { readContent as readScraperContent } from "../handlers/scraping/storage";
import { createLoggedHandler } from "./safe_handle";
import * as vault from "../../lib/local_vault_service";

const logger = log.scope("local-vault-handlers");
const handle = createLoggedHandler(logger);

export function registerLocalVaultHandlers() {
  // ---- Vault Core ----

  handle("local-vault:status", async () => {
    return vault.getVaultStatus();
  });

  handle("local-vault:initialize", async (_, passphrase?: string) => {
    vault.initializeVault(passphrase);
    return vault.getVaultStatus();
  });

  handle("local-vault:unlock", async (_, passphrase: string) => {
    const success = vault.unlockVault(passphrase);
    if (!success) throw new Error("Invalid passphrase");
    return vault.getVaultStatus();
  });

  handle("local-vault:lock", async () => {
    vault.lockVault();
    return vault.getVaultStatus();
  });

  handle("local-vault:get-config", async () => {
    return vault.getVaultConfig();
  });

  handle("local-vault:update-config", async (_, config: any) => {
    return vault.updateVaultConfig(config);
  });

  // ---- Connectors ----

  handle("local-vault:connector:list", async () => {
    return vault.listConnectors();
  });

  handle("local-vault:connector:get", async (_, id: string) => {
    const connector = vault.getConnector(id);
    if (!connector) throw new Error(`Connector not found: ${id}`);
    return connector;
  });

  handle("local-vault:connector:add", async (_, config: any) => {
    return vault.addConnector(config);
  });

  handle("local-vault:connector:update", async (_, id: string, updates: any) => {
    const connector = vault.updateConnector(id, updates);
    if (!connector) throw new Error(`Connector not found: ${id}`);
    return connector;
  });

  handle("local-vault:connector:remove", async (_, id: string) => {
    vault.removeConnector(id);
  });

  handle("local-vault:connector:enable", async (_, id: string) => {
    const connector = vault.enableConnector(id);
    if (!connector) throw new Error(`Connector not found: ${id}`);
    return connector;
  });

  handle("local-vault:connector:disable", async (_, id: string) => {
    const connector = vault.disableConnector(id);
    if (!connector) throw new Error(`Connector not found: ${id}`);
    return connector;
  });

  // ---- Asset Import ----

  handle("local-vault:import:file", async (_, filePath: string, connectorId?: string) => {
    return vault.importFile(filePath, connectorId);
  });

  handle("local-vault:import:files-dialog", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("No window found");

    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
      title: "Import Files to Vault",
      filters: [
        { name: "All Files", extensions: ["*"] },
        { name: "Text", extensions: ["txt", "md", "csv", "json", "xml", "html"] },
        { name: "Documents", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac"] },
        { name: "Video", extensions: ["mp4", "webm", "mkv", "avi"] },
        { name: "Archives", extensions: ["zip", "gz", "tar"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return [];

    const assets = [];
    for (const filePath of result.filePaths) {
      try {
        assets.push(vault.importFile(filePath));
      } catch (err: any) {
        logger.warn(`Failed to import ${filePath}: ${err.message}`);
      }
    }
    return assets;
  });

  handle("local-vault:import:folder", async (_, folderPath: string, connectorId?: string, options?: any) => {
    return vault.importFolder(folderPath, connectorId, options);
  });

  handle("local-vault:import:folder-dialog", async (event, options?: any) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("No window found");

    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Import Folder to Vault",
    });

    if (result.canceled || result.filePaths.length === 0) return [];
    return vault.importFolder(result.filePaths[0], undefined, {
      recursive: true,
      ...options,
    });
  });

  handle("local-vault:import:text", async (_, name: string, content: string, connectorId?: string) => {
    return vault.importText(name, content, connectorId);
  });

  // ---- Asset CRUD ----

  handle("local-vault:asset:list", async (_, filters?: any) => {
    return vault.listAssets(filters);
  });

  handle("local-vault:asset:get", async (_, id: string) => {
    const asset = vault.getAsset(id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    return asset;
  });

  handle("local-vault:asset:content", async (_, id: string) => {
    const buffer = vault.getAssetContent(id);
    // Return as base64 for safe IPC transfer
    return buffer.toString("base64");
  });

  handle("local-vault:asset:update", async (_, id: string, updates: any) => {
    const asset = vault.updateAsset(id, updates);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    return asset;
  });

  handle("local-vault:asset:delete", async (_, id: string) => {
    vault.deleteAsset(id);
  });

  // ---- Transform Pipeline ----

  handle("local-vault:transform:create", async (_, config: any) => {
    return vault.createTransformJob(config);
  });

  handle("local-vault:transform:get", async (_, id: string) => {
    const job = vault.getTransformJob(id);
    if (!job) throw new Error(`Transform job not found: ${id}`);
    return job;
  });

  handle("local-vault:transform:list", async (_, limit?: number) => {
    return vault.listTransformJobs(limit);
  });

  handle("local-vault:transform:run", async (_, id: string) => {
    return vault.runTransformJob(id);
  });

  // ---- Packaging ----

  handle("local-vault:package:create", async (_, config: any) => {
    return vault.createPackageManifest(config);
  });

  handle("local-vault:package:list", async (_, limit?: number) => {
    return vault.listPackages(limit);
  });

  handle("local-vault:package:get", async (_, id: string) => {
    const pkg = vault.getPackage(id);
    if (!pkg) throw new Error(`Package not found: ${id}`);
    return pkg;
  });

  // ---- Policy ----

  handle("local-vault:policy:create", async (_, config: any) => {
    return vault.createPolicy(config);
  });

  handle("local-vault:policy:get", async (_, id: string) => {
    const policy = vault.getPolicy(id);
    if (!policy) throw new Error(`Policy not found: ${id}`);
    return policy;
  });

  handle("local-vault:policy:get-by-manifest", async (_, manifestId: string) => {
    return vault.getPolicyByManifest(manifestId);
  });

  // ---- Publish Bundle ----

  handle("local-vault:publish:create-bundle", async (_, config: any) => {
    return vault.createPublishBundle(config);
  });

  handle("local-vault:publish:list-bundles", async (_, limit?: number) => {
    return vault.listPublishBundles(limit);
  });

  handle("local-vault:publish:get-bundle", async (_, id: string) => {
    const bundle = vault.getPublishBundle(id);
    if (!bundle) throw new Error(`Publish bundle not found: ${id}`);
    return bundle;
  });

  // ---- Audit Log ----

  handle("local-vault:audit:list", async (_, limit?: number) => {
    return vault.getAuditLog(limit);
  });

  // ---- Dataset → Vault Bridge ----

  handle(
    "local-vault:import:dataset-items",
    async (
      _,
      args: {
        datasetId: string;
        markReady?: boolean;
        tags?: string[];
      },
    ) => {
      const { datasetId, markReady = true, tags: extraTags = [] } = args;

      // Verify dataset exists
      const dataset = db
        .select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetId))
        .get();
      if (!dataset) throw new Error(`Dataset "${datasetId}" not found`);

      const items = db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId))
        .all();

      if (items.length === 0) {
        throw new Error(`Dataset "${datasetId}" has no items`);
      }

      const results = { promoted: 0, skipped: 0, failed: 0, assetIds: [] as string[] };

      for (const item of items) {
        try {
          // Dedup by content hash
          const existing = db
            .select()
            .from(vaultAssets)
            .where(eq(vaultAssets.contentHash, item.contentHash))
            .get();

          if (existing) {
            if (markReady && (existing.status === "ingested" || existing.status === "processing")) {
              db.update(vaultAssets)
                .set({ status: "ready", updatedAt: new Date() })
                .where(eq(vaultAssets.id, existing.id))
                .run();
            }
            results.assetIds.push(existing.id);
            results.skipped++;
            continue;
          }

          // Read from scraper storage
          const contentBuffer = await readScraperContent(item.contentHash);
          if (!contentBuffer) {
            logger.warn(`Content not found for hash: ${item.contentHash}`);
            results.failed++;
            continue;
          }

          const textContent = item.modality === "text"
            ? contentBuffer.toString("utf-8")
            : contentBuffer.toString("base64");

          const itemName = `${item.modality}-${item.contentHash.slice(0, 8)}`;
          const asset = vault.importText(itemName, textContent);

          // Parse tags
          let itemTags = [...extraTags];
          try {
            const labels = typeof item.labelsJson === "string"
              ? JSON.parse(item.labelsJson as string)
              : item.labelsJson;
            if (labels?.tags) {
              itemTags = [...new Set([...itemTags, ...labels.tags])];
            }
          } catch { /* ignore */ }

          // Update with scraping metadata
          db.update(vaultAssets)
            .set({
              status: markReady ? "ready" : "ingested",
              connectorType: "web_scraper",
              sourceUrl: item.sourcePath ?? undefined,
              tags: itemTags,
              metadataJson: {
                originalDatasetId: item.datasetId,
                originalItemId: item.id,
                sourceType: item.sourceType,
                modality: item.modality,
              },
              updatedAt: new Date(),
            })
            .where(eq(vaultAssets.id, asset.id))
            .run();

          results.assetIds.push(asset.id);
          results.promoted++;
        } catch (err) {
          logger.warn(`Failed to promote item ${item.id}: ${(err as Error).message}`);
          results.failed++;
        }
      }

      return {
        datasetId,
        datasetName: dataset.name,
        totalItems: items.length,
        ...results,
      };
    },
  );
}
