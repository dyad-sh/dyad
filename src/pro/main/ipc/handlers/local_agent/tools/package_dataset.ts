/**
 * package_dataset tool — Promote scraped datasets to the vault and package them
 * for marketplace publishing. Bridges datasetItems → vaultAssets → package → policy → bundle.
 * Requires user approval (consent: "ask").
 */

import { z } from "zod";
import log from "electron-log";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { datasetItems, studioDatasets } from "@/db/schema";
import { vaultAssets } from "@/db/vault_schema";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  importText,
  createPackageManifest,
  createPolicy,
  createPublishBundle,
  getAsset,
  listAssets,
} from "@/lib/local_vault_service";

const logger = log.scope("tool:package_dataset");

const packageDatasetSchema = z.object({
  datasetId: z
    .string()
    .describe("The ID of the dataset to package (from scraping or data studio)"),
  name: z
    .string()
    .describe("Name for the marketplace listing"),
  description: z
    .string()
    .optional()
    .describe("Description for the marketplace listing"),
  license: z
    .string()
    .optional()
    .describe("License type (default: 'cc-by-4.0'). Options: cc-by-4.0, cc-by-sa-4.0, cc0, mit, apache-2.0, proprietary"),
  pricingModel: z
    .enum(["free", "one-time", "subscription", "pay-per-use"])
    .optional()
    .describe("Pricing model for the listing (default: 'free')"),
  price: z
    .number()
    .optional()
    .describe("Price in USD (only for paid models)"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Tags for marketplace discovery"),
  category: z
    .string()
    .optional()
    .describe("Category for the listing (e.g. 'training-data', 'knowledge-base', 'research')"),
});

type PackageDatasetInput = z.infer<typeof packageDatasetSchema>;

export const packageDatasetTool: ToolDefinition<PackageDatasetInput> = {
  name: "package_dataset",
  description: `Package a dataset for marketplace publishing. This tool:
1. Reads all items from a scraped/created dataset
2. Promotes them into the local vault (content-addressed storage with encryption)
3. Creates a package manifest with integrity hashes and merkle root
4. Generates a usage policy with license terms and pricing
5. Creates a publish bundle ready for the marketplace

Use this after scraping data with the web_scraper tool, or on any dataset visible in Data Studio.
The resulting package appears in the Local Vault's Packaging tab ready for final review and publishing.`,

  inputSchema: packageDatasetSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) => {
    const parts = [`Package dataset "${args.name}"`];
    if (args.pricingModel && args.pricingModel !== "free") {
      parts.push(`($${args.price ?? 0} ${args.pricingModel})`);
    } else {
      parts.push("(free)");
    }
    return parts.join(" ");
  },

  buildXml: (args, isComplete) => {
    if (!args.datasetId) return undefined;
    const attrs: string[] = [];
    attrs.push(`dataset="${escapeXmlAttr(args.datasetId ?? "")}"`);
    if (args.name) attrs.push(`name="${escapeXmlAttr(args.name)}"`);

    let xml = `<joy-package-dataset ${attrs.join(" ")}>`;
    if (args.description) {
      xml += `\n${escapeXmlContent(args.description)}`;
    }
    if (isComplete) {
      xml += "\n</joy-package-dataset>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const {
      datasetId,
      name,
      description,
      license,
      pricingModel,
      price,
      tags,
      category,
    } = args;

    logger.info(`Package dataset tool invoked for dataset: ${datasetId}`);

    // 1. Verify dataset exists and has items
    const dataset = db
      .select()
      .from(studioDatasets)
      .where(eq(studioDatasets.id, datasetId))
      .get();

    if (!dataset) {
      throw new Error(`Dataset "${datasetId}" not found`);
    }

    const items = db
      .select()
      .from(datasetItems)
      .where(eq(datasetItems.datasetId, datasetId))
      .all();

    if (items.length === 0) {
      throw new Error(`Dataset "${datasetId}" has no items to package`);
    }

    ctx.onXmlStream(
      `<joy-package-dataset dataset="${escapeXmlAttr(datasetId)}" name="${escapeXmlAttr(name)}" status="running">\nPromoting ${items.length} items to vault...`,
    );

    // 2. Promote dataset items into vault assets
    const vaultAssetIds: string[] = [];
    let promoted = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        // Check for duplicate by content hash
        const existing = db
          .select()
          .from(vaultAssets)
          .where(eq(vaultAssets.contentHash, item.contentHash))
          .get();

        if (existing) {
          // Already in vault — just track the ID
          vaultAssetIds.push(existing.id);

          // Ensure it's at least "ready" status
          if (existing.status === "ingested" || existing.status === "processing") {
            db.update(vaultAssets)
              .set({ status: "ready", updatedAt: new Date() })
              .where(eq(vaultAssets.id, existing.id))
              .run();
          }

          skipped++;
          continue;
        }

        // Import into vault - read content from the scraper's storage
        const itemName = `${item.modality}-${item.contentHash.slice(0, 8)}`;
        const sourceUrl = item.sourcePath ?? "unknown";

        // Parse tags from labels
        let itemTags: string[] = tags ?? [];
        try {
          const labels = typeof item.labelsJson === "string"
            ? JSON.parse(item.labelsJson)
            : item.labelsJson;
          if (labels?.tags) {
            itemTags = [...new Set([...itemTags, ...labels.tags])];
          }
        } catch {
          // Ignore parse errors
        }

        // Read content from scraper's content-addressed storage
        const { readContent } = await import("@/ipc/handlers/scraping/storage");
        const contentBuffer = await readContent(item.contentHash);

        if (!contentBuffer) {
          logger.warn(`Content not found in scraper storage for hash: ${item.contentHash}`);
          skipped++;
          continue;
        }

        // Import as text into vault (all scraper content is text/markdown or base64 for media)
        const textContent = item.modality === "text"
          ? contentBuffer.toString("utf-8")
          : contentBuffer.toString("base64");

        const asset = importText(itemName, textContent);

        // Update vault asset with scraping metadata
        db.update(vaultAssets)
          .set({
            status: "ready",
            modality: (item.modality === "text" ? "text" : item.modality) as any,
            mimeType: item.modality === "text" ? "text/markdown" : guessMimeFromModality(item.modality),
            connectorType: "web_scraper",
            sourceUrl,
            sourcePath: item.sourcePath,
            tags: itemTags,
            qualityScore: extractQualityScore(item.qualitySignalsJson),
            metadataJson: buildMetadata(item),
            updatedAt: new Date(),
          })
          .where(eq(vaultAssets.id, asset.id))
          .run();

        vaultAssetIds.push(asset.id);
        promoted++;
      } catch (err) {
        logger.warn(`Failed to promote item ${item.id}: ${(err as Error).message}`);
        skipped++;
      }
    }

    if (vaultAssetIds.length === 0) {
      throw new Error("No items could be promoted to the vault");
    }

    ctx.onXmlStream(
      `<joy-package-dataset dataset="${escapeXmlAttr(datasetId)}" name="${escapeXmlAttr(name)}" status="running">\nPromoted ${promoted} items (${skipped} skipped). Creating package...`,
    );

    // 3. Create package manifest
    const manifest = createPackageManifest({
      name,
      version: "1.0.0",
      description: description ?? dataset.description ?? `Dataset package: ${name}`,
      assetIds: vaultAssetIds,
    });

    logger.info(`Created package manifest: ${manifest.id}`);

    // 4. Create policy
    const policyConfig = {
      manifestId: manifest.id,
      licenseTiers: [
        {
          tier: "standard",
          enabled: true,
          price: price ?? 0,
          currency: "USD",
          description: `${license ?? "cc-by-4.0"} license — ${pricingModel ?? "free"} access`,
        },
      ],
      allowedUses: ["training", "research", "commercial"],
      restrictions: [] as string[],
      pricingModel: pricingModel ?? "free",
      priceAmount: price,
      priceCurrency: "USD",
    };

    const policy = createPolicy(policyConfig);
    logger.info(`Created policy: ${policy.id}`);

    // 5. Create publish bundle
    const bundle = createPublishBundle({
      manifestId: manifest.id,
      policyId: policy.id,
      listing: {
        name,
        description: description ?? dataset.description ?? undefined,
        category: category ?? "datasets",
        tags: tags ?? ["scraped", "web-data"],
        license: license ?? "cc-by-4.0",
        pricingModel: pricingModel ?? "free",
        price: price,
        currency: "USD",
      },
      publisherWallet: "local-user",
    });

    logger.info(`Created publish bundle: ${bundle.id}`);

    // Build summary
    const summary = buildSummary({
      datasetName: dataset.name,
      packageName: name,
      totalItems: items.length,
      promoted,
      skipped,
      manifestId: manifest.id,
      policyId: policy.id,
      bundleId: bundle.id,
      pricingModel: pricingModel ?? "free",
      price,
      license: license ?? "cc-by-4.0",
    });

    ctx.onXmlComplete(
      `<joy-package-dataset dataset="${escapeXmlAttr(datasetId)}" name="${escapeXmlAttr(name)}" status="completed" bundle="${escapeXmlAttr(bundle.id)}">\n${escapeXmlContent(summary)}\n</joy-package-dataset>`,
    );

    return summary;
  },
};

function extractQualityScore(qualityJson: unknown): number | undefined {
  try {
    const q = typeof qualityJson === "string" ? JSON.parse(qualityJson) : qualityJson;
    return q?.overallQuality ?? undefined;
  } catch {
    return undefined;
  }
}

function buildMetadata(item: any): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    originalDatasetId: item.datasetId,
    originalItemId: item.id,
    sourceType: item.sourceType,
    modality: item.modality,
    importedFromScraper: true,
  };

  try {
    const labels = typeof item.labelsJson === "string"
      ? JSON.parse(item.labelsJson)
      : item.labelsJson;
    if (labels) {
      meta.labels = labels;
    }
  } catch {
    // Ignore
  }

  return meta;
}

function guessMimeFromModality(modality: string): string {
  switch (modality) {
    case "image": return "image/jpeg";
    case "audio": return "audio/mpeg";
    case "video": return "video/mp4";
    default: return "application/octet-stream";
  }
}

function buildSummary(info: {
  datasetName: string;
  packageName: string;
  totalItems: number;
  promoted: number;
  skipped: number;
  manifestId: string;
  policyId: string;
  bundleId: string;
  pricingModel: string;
  price?: number;
  license: string;
}): string {
  const lines: string[] = [];
  lines.push(`## Dataset Packaged Successfully`);
  lines.push("");
  lines.push(`**"${info.packageName}"** is now ready for the marketplace.`);
  lines.push("");
  lines.push("### Pipeline Summary");
  lines.push(`- Source dataset: ${info.datasetName} (${info.totalItems} items)`);
  lines.push(`- Promoted to vault: ${info.promoted} items`);
  if (info.skipped > 0) {
    lines.push(`- Skipped (duplicates): ${info.skipped}`);
  }
  lines.push(`- Package manifest: ${info.manifestId}`);
  lines.push(`- Policy document: ${info.policyId}`);
  lines.push(`- Publish bundle: ${info.bundleId}`);
  lines.push("");
  lines.push("### Listing Details");
  lines.push(`- License: ${info.license}`);
  lines.push(`- Pricing: ${info.pricingModel}${info.price ? ` — $${info.price}` : ""}`);
  lines.push("");
  lines.push(
    "The package is now visible in **Local Vault → Packaging**. " +
    "You can review the manifest, edit the policy, and finalize publishing from there.",
  );

  return lines.join("\n");
}
