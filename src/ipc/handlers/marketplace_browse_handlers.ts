/**
 * Marketplace Browse IPC Handlers — DropERC1155-only read path.
 *
 * After the 2026-05-02 architecture pivot
 * (see briefs/droperc1155-read-layer-surgery.md), browse / detail / featured
 * / categories are all sourced from the joy-drop-amoy + joy-stores-amoy
 * Goldsky subgraphs. There is NO MarketplaceV3 listing fetch, NO Supabase
 * listing-mirror call, and NO `joy-marketplace-amoy` subgraph access.
 *
 * Renderer surface (matches the pre-existing `IpcClient` typings):
 *   marketplace:browse        → MarketplaceBrowseResult
 *   marketplace:asset-detail  → MarketplaceAssetDetail
 *   marketplace:install-asset → InstallAssetResult
 *   marketplace:featured      → MarketplaceBrowseResult
 *   marketplace:categories    → { category: string; count: number }[]
 */

import { ipcMain, app } from "electron";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import {
  listDrops,
  getDrop,
  listDropsByCreator,
  listClaimsByBuyer,
  getOwnership,
  listStoresByDomainOwner,
  type DropToken,
  type DropPurchase,
  type DropUserBalance,
  type JoyStore,
} from "@/lib/joymarketplace/drop_subgraph";
import type {
  MarketplaceBrowseParams,
  MarketplaceBrowseResult,
  MarketplaceBrowseItem,
  MarketplaceAssetDetail,
  InstallAssetRequest,
  InstallAssetResult,
  PublishableAssetType,
  UnifiedCategory,
  LicenseType,
} from "@/types/publish_types";
import type { PricingModel, AssetStatus } from "@/types/marketplace_types";

const logger = log.scope("marketplace_browse");

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Public IPFS gateways used to resolve `baseURI` metadata. Tried in order;
 * first 200-with-JSON wins. Kept short — the renderer can do its own
 * fetching for richer media.
 */
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://4everland.io/ipfs/",
] as const;

/** How long to cache a resolved `baseURI` JSON in-process (ms). */
const METADATA_TTL_MS = 5 * 60_000;

// ── In-process metadata cache ──────────────────────────────────────────────

interface CachedMetadata {
  fetchedAt: number;
  data: TokenMetadata | null;
}
const metadataCache = new Map<string, CachedMetadata>();

/** Subset of ERC-1155 token metadata we use. Treat unknown fields as opaque. */
interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  animation_url?: string;
  attributes?: { trait_type?: string; value?: unknown }[];
  /** JoyCreate convention: assetType + category live under properties. */
  properties?: {
    assetType?: PublishableAssetType;
    category?: UnifiedCategory;
    license?: LicenseType;
    creatorWallet?: string;
    creatorName?: string;
    tags?: string[];
    techStack?: string[];
    features?: string[];
    version?: string;
    changelog?: string;
    screenshots?: string[];
    demoUrl?: string;
    videoUrl?: string;
    requirements?: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Predicate — "does this drop's metadata identify `wallet` as its creator?".
 *
 * The DropERC1155 subgraph doesn't store creator on each Token (every drop
 * is lazyMinted by a single platform admin/bot wallet to satisfy
 * creatorGate). So "my drops" can only be derived by matching the
 * `creatorWallet` field that `publish_orchestrator.ts` writes into the
 * pinned metadata at publish time. We compare lower-cased to be safe — the
 * wallet UI may pass mixed-case checksum strings while the metadata is
 * usually written lowercase.
 */
function isMyDrop(meta: TokenMetadata | null, walletLower: string): boolean {
  const raw = meta?.properties?.creatorWallet;
  if (!raw || typeof raw !== "string") return false;
  return raw.toLowerCase() === walletLower;
}

/**
 * Resolve an `ipfs://...` or `https?://...` URI to a fetchable HTTPS URL.
 * Returns the input untouched for non-IPFS URIs.
 */
function ipfsToHttp(uri: string, gatewayIndex = 0): string {
  if (!uri) return uri;
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length] + cid;
  }
  return uri;
}

/** Fetch + parse the metadata JSON behind a token's baseURI, with retry across gateways. */
async function fetchMetadata(baseURI: string): Promise<TokenMetadata | null> {
  if (!baseURI) return null;
  const cached = metadataCache.get(baseURI);
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) {
    return cached.data;
  }
  const attempts = baseURI.startsWith("ipfs://") ? IPFS_GATEWAYS.length : 1;
  for (let i = 0; i < attempts; i++) {
    const url = ipfsToHttp(baseURI, i);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const json = (await r.json()) as TokenMetadata;
      metadataCache.set(baseURI, { fetchedAt: Date.now(), data: json });
      return json;
    } catch (e) {
      logger.debug(`fetchMetadata gateway ${i} failed for ${baseURI}: ${(e as Error).message}`);
    }
  }
  metadataCache.set(baseURI, { fetchedAt: Date.now(), data: null });
  return null;
}

/** Convert a wei-decimal string to a USD-ish display number (assumes 18 decimals). */
function weiToDisplay(wei: string | null): number | undefined {
  if (!wei) return undefined;
  try {
    const n = BigInt(wei);
    // Display in whole units with 4-decimal precision.
    return Number(n) / 1e18;
  } catch {
    return undefined;
  }
}

/** Convert a `DropToken` + (optional) metadata into a browse-grid row. */
function toBrowseItem(token: DropToken, meta: TokenMetadata | null): MarketplaceBrowseItem {
  const props = meta?.properties ?? {};
  const assetType = (props.assetType ?? "model") as PublishableAssetType;
  const category = (props.category ?? "ai-workflow") as UnifiedCategory;
  const pricingModel: PricingModel =
    token.pricePerToken && token.pricePerToken !== "0" ? "one-time" : "free";
  const price = weiToDisplay(token.pricePerToken);

  return {
    id: token.tokenId,
    name: meta?.name ?? `Drop #${token.tokenId}`,
    shortDescription: (meta?.description ?? "").slice(0, 200),
    category,
    assetType,
    pricingModel,
    price,
    currency: "MATIC",
    thumbnailUrl: meta?.image ? ipfsToHttp(meta.image) : undefined,
    downloads: Number(token.totalPurchases ?? "0"),
    rating: 0,
    reviewCount: 0,
    publisherName: props.creatorName ?? "Joy Creator",
    publisherId: props.creatorWallet ?? "",
    publishedAt: token.lazyMintedAt
      ? new Date(Number(token.lazyMintedAt) * 1000).toISOString()
      : new Date(0).toISOString(),
    tags: props.tags ?? [],
  };
}

/** Convert a `DropToken` + metadata into a full asset detail page payload. */
function toAssetDetail(token: DropToken, meta: TokenMetadata | null): MarketplaceAssetDetail {
  const props = meta?.properties ?? {};
  const assetType = (props.assetType ?? "model") as PublishableAssetType;
  const category = (props.category ?? "ai-workflow") as UnifiedCategory;
  const license = (props.license ?? "proprietary") as LicenseType;
  const pricingModel: PricingModel =
    token.pricePerToken && token.pricePerToken !== "0" ? "one-time" : "free";
  const price = weiToDisplay(token.pricePerToken);
  const status: AssetStatus = "published";

  return {
    id: token.tokenId,
    name: meta?.name ?? `Drop #${token.tokenId}`,
    slug: `drop-${token.tokenId}`,
    description: meta?.description ?? "",
    shortDescription: (meta?.description ?? "").slice(0, 200),
    category,
    assetType,
    tags: props.tags ?? [],
    pricingModel,
    price,
    currency: "MATIC",
    thumbnailUrl: meta?.image ? ipfsToHttp(meta.image) : undefined,
    screenshotUrls: (props.screenshots ?? []).map((s) => ipfsToHttp(s)),
    demoUrl: props.demoUrl,
    videoUrl: props.videoUrl,
    techStack: props.techStack ?? [],
    features: props.features ?? [],
    requirements: props.requirements,
    license,
    downloads: Number(token.totalPurchases ?? "0"),
    rating: 0,
    reviewCount: 0,
    status,
    version: props.version ?? "1.0.0",
    publisherId: props.creatorWallet ?? "",
    publisherName: props.creatorName ?? "Joy Creator",
    publisherVerified: !!props.creatorWallet,
    createdAt: token.lazyMintedAt
      ? new Date(Number(token.lazyMintedAt) * 1000).toISOString()
      : new Date(0).toISOString(),
    updatedAt: token.conditionUpdatedAt
      ? new Date(Number(token.conditionUpdatedAt) * 1000).toISOString()
      : new Date(0).toISOString(),
    publishedAt: token.lazyMintedAt
      ? new Date(Number(token.lazyMintedAt) * 1000).toISOString()
      : undefined,
    changelog: props.changelog,
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────

export function registerMarketplaceBrowseHandlers() {
  /** Browse paginated drop list. Server-side filter on category/assetType is
   *  best-effort because metadata lives off-chain — we filter the page after
   *  fetching metadata. Free-text `query` is matched on name/description. */
  ipcMain.handle(
    "marketplace:browse",
    async (_, params: MarketplaceBrowseParams = {}): Promise<MarketplaceBrowseResult> => {
      const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
      const page = Math.max(params.page ?? 1, 1);
      logger.info(`browse page=${page} pageSize=${pageSize} q=${params.query ?? ""}`);

      const orderBy = params.sortBy === "recent" ? "lazyMintedAt" : "lazyMintedAt";
      const { items: tokens, hasMore } = await listDrops({
        page,
        pageSize,
        orderBy,
        orderDirection: "desc",
      });

      const enriched = await Promise.all(
        tokens.map(async (t) => ({
          token: t,
          meta: await fetchMetadata(t.baseURI).catch(() => null),
        })),
      );

      let items = enriched.map(({ token, meta }) => toBrowseItem(token, meta));

      if (params.assetType) {
        items = items.filter((i) => i.assetType === params.assetType);
      }
      if (params.category) {
        items = items.filter((i) => i.category === params.category);
      }
      if (params.pricingModel) {
        items = items.filter((i) => i.pricingModel === params.pricingModel);
      }
      if (params.query) {
        const q = params.query.toLowerCase();
        items = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.shortDescription.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      return {
        items,
        // We don't know the true total without an extra count query; report
        // the lower-bound (current page offset + items rendered + 1 if more).
        total: (page - 1) * pageSize + items.length + (hasMore ? 1 : 0),
        page,
        pageSize,
        hasMore,
      };
    },
  );

  /** Detail page for a single drop (by tokenId). */
  ipcMain.handle(
    "marketplace:asset-detail",
    async (_, assetId: string): Promise<MarketplaceAssetDetail> => {
      if (!assetId) throw new Error("assetId is required");
      const token = await getDrop(assetId);
      if (!token) throw new Error(`Drop not found: ${assetId}`);
      const meta = await fetchMetadata(token.baseURI).catch(() => null);
      return toAssetDetail(token, meta);
    },
  );

  /** Stage an asset install — content lives on IPFS so this only writes a
   *  manifest the renderer can use to fetch the actual bytes. */
  ipcMain.handle(
    "marketplace:install-asset",
    async (_, request: InstallAssetRequest): Promise<InstallAssetResult> => {
      if (!request.assetId) throw new Error("assetId is required");

      logger.info(`install assetId=${request.assetId} type=${request.assetType}`);

      const token = await getDrop(request.assetId);
      if (!token) {
        return {
          installed: false,
          message: `Drop #${request.assetId} not found on subgraph`,
        };
      }

      const stagingDir = path.join(
        app.getPath("userData"),
        "marketplace-installs",
        request.assetId,
      );
      await fs.ensureDir(stagingDir);
      await fs.writeJson(path.join(stagingDir, "manifest.json"), {
        assetId: request.assetId,
        assetType: request.assetType,
        baseURI: token.baseURI,
        installedAt: new Date().toISOString(),
      });

      logger.info(`Staged ${request.assetId} at ${stagingDir}`);

      return {
        installed: true,
        localId: request.assetId,
        message: `${request.assetType} install staged. Fetch content from IPFS at ${token.baseURI}.`,
      };
    },
  );

  /** Featured = most-claimed drops, top 12. */
  ipcMain.handle("marketplace:featured", async (): Promise<MarketplaceBrowseResult> => {
    const { items: tokens } = await listDrops({
      page: 1,
      pageSize: 12,
      orderBy: "totalPurchases",
      orderDirection: "desc",
    });
    const enriched = await Promise.all(
      tokens.map(async (t) => ({
        token: t,
        meta: await fetchMetadata(t.baseURI).catch(() => null),
      })),
    );
    const items = enriched.map(({ token, meta }) => toBrowseItem(token, meta));
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: 12,
      hasMore: false,
    };
  });

  /**
   * "My drops" — drops authored by the given creator wallet, in browse-grid
   * shape so the existing renderer components can render them with no extra
   * conversion. The drop subgraph doesn't store creator on Token (see
   * `listDropsByCreator` for details), so we fetch a page of drops and
   * filter by metadata.creatorWallet (set during publish-orchestrator pin).
   *
   * Params: { wallet: string, page?, pageSize?, query? }
   */
  ipcMain.handle(
    "marketplace:my-drops",
    async (
      _,
      params: {
        wallet: string;
        page?: number;
        pageSize?: number;
        query?: string;
      },
    ): Promise<MarketplaceBrowseResult> => {
      if (!params?.wallet) throw new Error("wallet is required");
      const pageSize = Math.min(Math.max(params.pageSize ?? 24, 1), 100);
      const page = Math.max(params.page ?? 1, 1);
      const wallet = params.wallet.toLowerCase();

      logger.info(`my-drops wallet=${wallet} page=${page} pageSize=${pageSize}`);

      // Fetch a page of drops (subgraph-side filter unavailable today).
      const { items: tokens, hasMore } = await listDropsByCreator({
        creator: wallet,
        page,
        pageSize,
        orderBy: "lazyMintedAt",
        orderDirection: "desc",
      });

      const enriched = await Promise.all(
        tokens.map(async (t) => ({
          token: t,
          meta: await fetchMetadata(t.baseURI).catch(() => null),
        })),
      );

      // Filter by creatorWallet (set by publish_orchestrator). When metadata
      // is missing or creatorWallet is absent, exclude rather than
      // over-include — "my drops" should never show a stranger's drops.
      let items = enriched
        .filter(({ meta }) => isMyDrop(meta, wallet))
        .map(({ token, meta }) => toBrowseItem(token, meta));

      if (params.query) {
        const q = params.query.toLowerCase();
        items = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.shortDescription.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      return {
        items,
        total: (page - 1) * pageSize + items.length + (hasMore ? 1 : 0),
        page,
        pageSize,
        hasMore,
      };
    },
  );

  /**
   * "My claims" — raw on-chain claim() events authored by the given buyer
   * wallet. Returns the subgraph-shape `DropPurchase[]` so the renderer can
   * decide whether to render as a history table or hydrate against drop
   * details.
   */
  ipcMain.handle(
    "marketplace:my-claims",
    async (
      _,
      params: { wallet: string; page?: number; pageSize?: number },
    ): Promise<DropPurchase[]> => {
      if (!params?.wallet) throw new Error("wallet is required");
      logger.info(`my-claims wallet=${params.wallet} page=${params.page ?? 1}`);
      return listClaimsByBuyer({
        buyer: params.wallet,
        page: params.page,
        pageSize: params.pageSize,
      });
    },
  );

  /**
   * Ownership probe — "does wallet X own any quantity of tokenId Y?". Returns
   * the aggregate `DropUserBalance` entity, or `null` when never claimed.
   */
  ipcMain.handle(
    "marketplace:ownership",
    async (
      _,
      params: { tokenId: string | number; wallet: string },
    ): Promise<DropUserBalance | null> => {
      if (!params?.wallet) throw new Error("wallet is required");
      if (params.tokenId === undefined || params.tokenId === null) {
        throw new Error("tokenId is required");
      }
      return getOwnership(params.tokenId, params.wallet);
    },
  );

  /**
   * "My stores" — stores associated with the wallet via .joy domain
   * ownership. See `listStoresByDomainOwner` for why this joins through
   * DomainRegistration.owner instead of Store.owner.
   */
  ipcMain.handle(
    "marketplace:my-stores",
    async (_, params: { wallet: string; first?: number }): Promise<JoyStore[]> => {
      if (!params?.wallet) throw new Error("wallet is required");
      logger.info(`my-stores wallet=${params.wallet}`);
      return listStoresByDomainOwner(params.wallet, params.first ?? 50);
    },
  );

  /** Categories with counts — derived from the first 1000 drops' metadata. */
  ipcMain.handle("marketplace:categories", async () => {
    const { items: tokens } = await listDrops({ page: 1, pageSize: 100 });
    const enriched = await Promise.all(
      tokens.map(async (t) => ({
        token: t,
        meta: await fetchMetadata(t.baseURI).catch(() => null),
      })),
    );
    const counts = new Map<string, number>();
    for (const { meta } of enriched) {
      const cat = (meta?.properties?.category ?? "other") as string;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
  });
}

// Internal exports for unit tests.
export const __test__ = {
  ipfsToHttp,
  weiToDisplay,
  toBrowseItem,
  toAssetDetail,
  isMyDrop,
};
