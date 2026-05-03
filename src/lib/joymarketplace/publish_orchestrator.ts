/**
 * PublishOrchestrator — fire-and-forget on-chain publish for any asset type.
 *
 * Pipeline:
 *   1. Resolve signer via JcnKeyManager (chain key -> ethers.Wallet).
 *   2. Insert publish_bundles row (status=started).
 *   3. Pin contentBuffer (if any) -> contentCid; build + pin metadata JSON.
 *   4. JoyCreatorGate.canMint(signer) -> blockedAt="no-gate" if false.
 *   5. lazyMintDrop(metadataUri, quantity) -> tokenId.
 *   6. createListing(tokenId, parseUSDC(price), USDC_POLYGON, qty).
 *   7. Update publish_bundles row + jcn_publish_records / jcn_chain_transactions.
 *   8. Best-effort goldskyWatch (Promise.race w/ 30s budget).
 *   9. Return PublishOutcome.
 *
 * The public method NEVER throws; every error is captured into outcome.errors
 * and the first hard failure sets outcome.blockedAt.
 */

import log from "electron-log";
import { ethers } from "ethers";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { publishBundles, jcnPublishRecords, jcnChainTransactions } from "@/db/schema";
import {
  CONTRACT_ADDRESSES,
  POLYGON_AMOY,
  parseUSDC,
} from "@/config/joymarketplace";
import { jcnKeyManager } from "@/lib/jcn_key_manager";

import { IpfsPinner, loadPinnerKeysFromSettings } from "./ipfs_pinner";
import { OnchainPublisher, buildWallet } from "./onchain_publisher";

const logger = log.scope("publish_orchestrator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetType = "agent" | "document" | "image" | "video" | "model";

export interface PublishInput {
  assetType: AssetType;
  name: string;
  description?: string;
  /** Optional raw blob; pinned to IPFS and referenced from metadata.image. */
  contentBuffer?: Buffer;
  contentMimeType?: string;
  /** Extra props merged into metadata.properties. */
  metadata?: Record<string, unknown>;
  /** USDC base units (6 decimals); 0 = free. */
  priceUsdc?: number;
  /** ERC-1155 quantity to mint. Default 1. */
  quantity?: number;
  /** EIP-2981 royalty in basis points. Default 250 (2.5%). */
  royaltyBps?: number;
  /** Optional store slug; defaults to whatever is in joybridge-config.json. */
  storeSlug?: string;
  /** When true, pin + estimate gas, no on-chain writes. */
  dryRun?: boolean;
  /** License string; default "CC-BY-4.0". */
  license?: string;
}

export type BlockedReason =
  | "no-signer"
  | "no-gate"
  | "pin-failed"
  | "mint-failed"
  | "list-failed"
  | "indexing-timeout";

export interface PublishOutcome {
  ok: boolean;
  dryRun: boolean;
  contentCid?: string;
  metadataCid?: string;
  metadataUri?: string;
  tokenId?: string;
  listingId?: string;
  mintTxHash?: string;
  listTxHash?: string;
  marketplaceUrl?: string;
  goldskyIndexed?: boolean;
  errors?: string[];
  blockedAt?: BlockedReason;
  bundleId?: number;
  /** Echoed in dry-run mode so the renderer can surface gas. */
  estimatedGas?: { mint?: string; listing?: string };
}

// Public marketplace URL pattern
const MARKETPLACE_URL_BASE = process.env.JOYMARKETPLACE_WEB_URL ?? "https://joymarketplace.io";

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class PublishOrchestrator {
  /**
   * Fire-and-forget on-chain publish. Never throws.
   */
  async publishAndForget(input: PublishInput): Promise<PublishOutcome> {
    const dryRun = Boolean(input.dryRun);
    const outcome: PublishOutcome = {
      ok: false,
      dryRun,
      errors: [],
      goldskyIndexed: false,
    };

    // 1. Resolve signer
    let wallet: ethers.Wallet | undefined;
    try {
      wallet = await this.loadSigner();
    } catch (err) {
      outcome.errors!.push(`loadSigner: ${(err as Error).message}`);
      outcome.blockedAt = "no-signer";
      return outcome;
    }
    if (!wallet) {
      outcome.errors!.push("no signer configured \u2014 import a chain (secp256k1) wallet key in Settings");
      outcome.blockedAt = "no-signer";
      return outcome;
    }

    // 2. Insert publish_bundles row
    let bundleId: number | undefined;
    try {
      const inserted = await db
        .insert(publishBundles)
        .values({
          assetType: input.assetType,
          name: input.name,
          description: input.description,
          status: "started",
          dryRun,
        })
        .returning({ id: publishBundles.id });
      bundleId = inserted[0]?.id;
      outcome.bundleId = bundleId;
    } catch (err) {
      outcome.errors!.push(`publish_bundles insert: ${(err as Error).message}`);
      // non-fatal; continue
    }

    // 3. Pin content + metadata
    const pinner = new IpfsPinner({ keys: await loadPinnerKeysFromSettings() });
    let contentCid: string | undefined;
    let metadataCid: string | undefined;
    let metadataUri: string | undefined;
    try {
      if (input.contentBuffer) {
        const filename = this.deriveFilename(input);
        const r = await pinner.pinBlob(
          input.contentBuffer,
          filename,
          input.contentMimeType,
        );
        contentCid = r.cid;
        outcome.contentCid = r.cid;
        if (!r.pinnedRemotely) {
          outcome.errors!.push(`content pinned only via local Helia (no remote provider) \u2014 will not be retrievable from public gateways until uploaded`);
        }
      }
      const meta = this.buildMetadata(input, contentCid);
      const mr = await pinner.pinJson(meta, `${input.name}-metadata`);
      metadataCid = mr.cid;
      metadataUri = `ipfs://${mr.cid}`;
      outcome.metadataCid = mr.cid;
      outcome.metadataUri = metadataUri;
      if (!mr.pinnedRemotely) {
        outcome.errors!.push(`metadata pinned only via local Helia (no remote provider)`);
      }
    } catch (err) {
      outcome.errors!.push(`pin: ${(err as Error).message}`);
      outcome.blockedAt = "pin-failed";
      await this.persistBundle(bundleId, outcome);
      return outcome;
    }

    // 4. Verify creator gate
    const publisher = new OnchainPublisher(wallet, POLYGON_AMOY);
    try {
      const gate = await publisher.verifyCreatorGate(wallet.address);
      if (!gate.canMint) {
        outcome.errors!.push(`gate: ${gate.reason ?? "canMint=false"}`);
        outcome.blockedAt = "no-gate";
        await this.persistBundle(bundleId, outcome);
        return outcome;
      }
    } catch (err) {
      outcome.errors!.push(`verifyCreatorGate threw: ${(err as Error).message}`);
      outcome.blockedAt = "no-gate";
      await this.persistBundle(bundleId, outcome);
      return outcome;
    }

    // 5. Mint
    const quantity = Math.max(1, input.quantity ?? 1);
    let mint: { tokenId: string; txHash?: string; gasEstimate?: bigint };
    try {
      mint = await publisher.lazyMintDrop(metadataUri!, quantity, { dryRun });
      outcome.tokenId = mint.tokenId;
      if (mint.txHash) outcome.mintTxHash = mint.txHash;
      if (mint.gasEstimate != null) {
        outcome.estimatedGas = {
          ...(outcome.estimatedGas ?? {}),
          mint: mint.gasEstimate.toString(),
        };
      }
    } catch (err) {
      outcome.errors!.push(`mint: ${(err as Error).message}`);
      outcome.blockedAt = "mint-failed";
      await this.persistBundle(bundleId, outcome);
      return outcome;
    }

    // Dry run stops here with ok=true
    if (dryRun) {
      // Still estimate listing gas so the UI can surface a total
      try {
        const list = await publisher.createListing(
          mint.tokenId,
          parseUSDC(input.priceUsdc ?? 0),
          CONTRACT_ADDRESSES.USDC_POLYGON,
          quantity,
          { dryRun: true },
        );
        if (list.gasEstimate != null) {
          outcome.estimatedGas = {
            ...(outcome.estimatedGas ?? {}),
            listing: list.gasEstimate.toString(),
          };
        }
      } catch (err) {
        outcome.errors!.push(`listing dry-run: ${(err as Error).message}`);
      }
      outcome.ok = true;
      await this.persistBundle(bundleId, { ...outcome, status: "dry-run-ok" });
      return outcome;
    }

    // 6. Listing
    try {
      const list = await publisher.createListing(
        mint.tokenId,
        parseUSDC(input.priceUsdc ?? 0),
        CONTRACT_ADDRESSES.USDC_POLYGON,
        quantity,
      );
      outcome.listingId = list.listingId;
      if (list.txHash) outcome.listTxHash = list.txHash;
    } catch (err) {
      outcome.errors!.push(`listing: ${(err as Error).message}`);
      outcome.blockedAt = "list-failed";
      await this.persistBundle(bundleId, outcome);
      return outcome;
    }

    // 7. Persist receipts
    outcome.ok = true;
    outcome.marketplaceUrl = `${MARKETPLACE_URL_BASE}/asset/${outcome.tokenId}`;
    await this.persistBundle(bundleId, { ...outcome, status: "published" });
    await this.persistChainTxReceipts(outcome).catch((err) => {
      logger.warn(`chain tx receipt persist failed: ${(err as Error).message}`);
    });

    // 8. Best-effort Goldsky watch w/ 30s budget. Don't await beyond budget.
    const subgraphUrl = process.env.JOYMARKETPLACE_GOLDSKY_URL ?? "";
    if (subgraphUrl) {
      try {
        const watchResult = await Promise.race([
          publisher.goldskyWatch(subgraphUrl, outcome.tokenId!, 30_000),
          new Promise<{ indexed: false }>((resolve) =>
            setTimeout(() => resolve({ indexed: false }), 30_000),
          ),
        ]);
        outcome.goldskyIndexed = Boolean(watchResult?.indexed);
        if (!outcome.goldskyIndexed) {
          outcome.errors!.push("goldsky did not index within 30s (will catch up async)");
        }
      } catch (err) {
        outcome.errors!.push(`goldskyWatch: ${(err as Error).message}`);
      }
    }

    return outcome;
  }

  // -- helpers -------------------------------------------------------------

  private async loadSigner(): Promise<ethers.Wallet | undefined> {
    await jcnKeyManager.initialize();
    const keys = await jcnKeyManager.listKeys("chain");
    const active = keys.find((k) => k.active && k.algorithm === "secp256k1");
    if (!active) return undefined;
    const pk = await jcnKeyManager.getPrivateKey(active.keyId);
    if (!pk) return undefined;
    return buildWallet(pk.toString("hex"), POLYGON_AMOY);
  }

  private deriveFilename(input: PublishInput): string {
    const safeName = input.name.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 48) || "asset";
    const ext = (() => {
      switch (input.assetType) {
        case "image":
          return ".png";
        case "video":
          return ".mp4";
        case "agent":
        case "document":
          return ".json";
        case "model":
          return ".bin";
        default:
          return ".bin";
      }
    })();
    return `${safeName}${ext}`;
  }

  private buildMetadata(input: PublishInput, contentCid?: string): Record<string, unknown> {
    return {
      name: input.name,
      description: input.description ?? "",
      image: contentCid ? `ipfs://${contentCid}` : undefined,
      external_url: `${MARKETPLACE_URL_BASE}/asset/`,
      properties: {
        ...(input.metadata ?? {}),
        assetType: input.assetType,
        priceUsdc: input.priceUsdc ?? 0,
        royaltyBps: input.royaltyBps ?? 250,
        storeSlug: input.storeSlug,
      },
      license: input.license ?? "CC-BY-4.0",
      contentMimeType: input.contentMimeType,
      version: "1.0.0",
    };
  }

  private async persistBundle(
    bundleId: number | undefined,
    outcome: PublishOutcome & { status?: string },
  ): Promise<void> {
    if (!bundleId) return;
    try {
      await db
        .update(publishBundles)
        .set({
          contentCid: outcome.contentCid,
          metadataCid: outcome.metadataCid,
          metadataUri: outcome.metadataUri,
          tokenId: outcome.tokenId,
          listingId: outcome.listingId,
          mintTxHash: outcome.mintTxHash,
          listTxHash: outcome.listTxHash,
          status:
            outcome.status ??
            (outcome.blockedAt ? `blocked:${outcome.blockedAt}` : outcome.ok ? "published" : "failed"),
          blockedAt: outcome.blockedAt,
          errorLog: outcome.errors?.length ? outcome.errors.join("\n") : null,
          goldskyIndexed: Boolean(outcome.goldskyIndexed),
          updatedAt: new Date(),
        })
        .where(eq(publishBundles.id, bundleId));
    } catch (err) {
      logger.warn(`persistBundle ${bundleId} failed: ${(err as Error).message}`);
    }
  }

  private async persistChainTxReceipts(outcome: PublishOutcome): Promise<void> {
    const now = new Date();
    const rows: Array<typeof jcnChainTransactions.$inferInsert> = [];
    if (outcome.mintTxHash) {
      rows.push({
        id: cryptoRandomId(),
        txHash: outcome.mintTxHash,
        network: "polygon",
        status: "confirmed",
        confirmations: 1,
        requiredConfirmations: 12,
        txType: "mint",
        relatedRecordType: "publish",
        relatedRecordId: outcome.bundleId?.toString(),
        submittedAt: now,
        confirmedAt: now,
      });
    }
    if (outcome.listTxHash) {
      rows.push({
        id: cryptoRandomId(),
        txHash: outcome.listTxHash,
        network: "polygon",
        status: "confirmed",
        confirmations: 1,
        requiredConfirmations: 12,
        txType: "list",
        relatedRecordType: "publish",
        relatedRecordId: outcome.bundleId?.toString(),
        submittedAt: now,
        confirmedAt: now,
      });
    }
    if (rows.length) {
      await db.insert(jcnChainTransactions).values(rows);
    }

    // Also write a jcn_publish_records row for legacy receipt consumers.
    if (outcome.tokenId) {
      try {
        await db.insert(jcnPublishRecords).values({
          id: cryptoRandomId(),
          requestId: cryptoRandomId(),
          traceId: cryptoRandomId(),
          state: "COMPLETE",
          storeId: "default",
          publisherWallet: "",
          bundleType: "ai_agent",
          sourceType: "cid",
          bundleCid: outcome.contentCid,
          manifestCid: outcome.metadataCid,
          mintTxHash: outcome.mintTxHash,
          tokenId: outcome.tokenId,
          marketplaceAssetId: outcome.tokenId,
        });
      } catch (err) {
        logger.warn(`jcnPublishRecords insert failed: ${(err as Error).message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton + thin convenience wrapper
// ---------------------------------------------------------------------------

let _orchestrator: PublishOrchestrator | undefined;

export function getPublishOrchestrator(): PublishOrchestrator {
  if (!_orchestrator) _orchestrator = new PublishOrchestrator();
  return _orchestrator;
}

export async function publishAndForget(input: PublishInput): Promise<PublishOutcome> {
  return getPublishOrchestrator().publishAndForget(input);
}

// ---------------------------------------------------------------------------

function cryptoRandomId(): string {
  // Avoid pulling in `uuid` at top of file; just use webcrypto.
  // Falls back to Math.random in environments without crypto.
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
