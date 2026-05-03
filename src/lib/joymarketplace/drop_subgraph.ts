/**
 * DropERC1155 + Stores subgraph client.
 *
 * Single source of truth for marketplace READ paths after the 2026-05-02
 * architecture pivot (see briefs/droperc1155-read-layer-surgery.md). All
 * browse / detail / "my drops" / ownership queries hit Goldsky-indexed
 * DropERC1155 + Stores subgraphs. No MarketplaceV3 listings, no Supabase
 * listing mirror.
 *
 * Endpoints are env-overridable for staging/local subgraphs:
 *   JOYMARKETPLACE_DROP_SUBGRAPH_URL
 *   JOYMARKETPLACE_STORES_SUBGRAPH_URL
 *
 * The renderer should reach this layer through the
 * `marketplace_browse_handlers.ts` IPC surface, not import this module
 * directly (electron-main only).
 */

import log from "electron-log";

const logger = log.scope("drop_subgraph");

// ── Endpoints ──────────────────────────────────────────────────────────────

/** Default Polygon Amoy DropERC1155 subgraph (joy-drop-amoy). */
export const DEFAULT_DROP_SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn";

/** Default Polygon Amoy Stores subgraph (joy-stores-amoy). */
export const DEFAULT_STORES_SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.3/gn";

/** Resolve the active Drop subgraph URL (env override > default). */
export function getDropSubgraphUrl(): string {
  return process.env.JOYMARKETPLACE_DROP_SUBGRAPH_URL || DEFAULT_DROP_SUBGRAPH_URL;
}

/** Resolve the active Stores subgraph URL (env override > default). */
export function getStoresSubgraphUrl(): string {
  return process.env.JOYMARKETPLACE_STORES_SUBGRAPH_URL || DEFAULT_STORES_SUBGRAPH_URL;
}

// ── Types ──────────────────────────────────────────────────────────────────

/** A lazy-minted DropERC1155 token, as indexed by joy-drop-amoy. */
export interface DropToken {
  /** Subgraph entity id (== tokenId as a decimal string). */
  id: string;
  /** Decimal string. */
  tokenId: string;
  /** ipfs://... or https://... metadata base URI. */
  baseURI: string;
  /** Unix-second string when lazyMint tx was indexed. */
  lazyMintedAt: string;
  lazyMintBlock: string;
  /** Tx hash hex string (`0x...`). */
  lazyMintTxHash: string;
  /** Wei-decimal string, or `null` if no claim conditions set yet. */
  pricePerToken: string | null;
  /** Currency contract address (lowercase hex), or `null`. */
  currency: string | null;
  /** Wei-decimal string, or `null`. */
  maxClaimableSupply: string | null;
  /** Wei-decimal string. */
  supplyClaimed: string | null;
  quantityLimitPerWallet: string | null;
  /** Unix-second string when claim conditions become active, or `null`. */
  conditionStartTimestamp: string | null;
  conditionUpdatedAt: string | null;
  /** Total claim() events recorded. */
  totalPurchases: string;
}

/** A claim() event against a DropERC1155 token. */
export interface DropPurchase {
  id: string;
  tokenId: string;
  claimConditionIndex: string;
  /** Claimer wallet (lowercase hex). */
  claimer: string;
  /** Receiver wallet (lowercase hex). */
  receiver: string;
  quantity: string;
  /** Unix-second string. */
  timestamp: string;
  blockNumber: string;
  txHash: string;
}

/** Aggregate ownership of a single tokenId by a single wallet. */
export interface DropUserBalance {
  id: string;
  /** Lowercase hex address. */
  user: string;
  tokenId: string;
  totalClaimed: string;
  lastClaimedAt: string;
}

/** A row from the Stores subgraph (one per .joy domain that registered a store). */
export interface JoyStore {
  /** Store id (typically the bare domain label, e.g. "love"). */
  id: string;
  /** Owner wallet (lowercase hex), or null if not yet linked. */
  owner: string | null;
  name: string | null;
  description: string | null;
  logo: string | null;
  website: string | null;
  tagline: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Result of a paginated drop-list query. */
export interface ListDropsResult {
  items: DropToken[];
  /** True if `(skip + items.length)` MAY be < total — we don't expose a count
   *  because the subgraph doesn't return one cheaply. Caller paginates by
   *  bumping `skip`/`page` until items.length < pageSize. */
  hasMore: boolean;
}

export interface ListDropsParams {
  /** 1-based page index. Default 1. */
  page?: number;
  /** Page size. Default 20, capped at 100. */
  pageSize?: number;
  /** Sort field. Default "lazyMintedAt". */
  orderBy?: "lazyMintedAt" | "tokenId" | "totalPurchases" | "supplyClaimed";
  orderDirection?: "asc" | "desc";
}

export interface ListDropsByCreatorParams extends ListDropsParams {
  /** Creator wallet (case-insensitive). Required. */
  creator: string;
}

export interface ListClaimsByBuyerParams {
  /** Buyer wallet (case-insensitive). Required. */
  buyer: string;
  page?: number;
  pageSize?: number;
}

// ── Internal: GraphQL fetcher ──────────────────────────────────────────────

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Run a GraphQL query against an arbitrary endpoint. Throws on transport
 * error or non-empty `errors` array. Internal use only.
 */
async function gql<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Subgraph HTTP ${r.status}: ${text.slice(0, 500)}`);
  }

  const json = (await r.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Subgraph GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Subgraph returned empty data");
  }
  return json.data;
}

// ── Field selections (kept centralized so all queries return the same shape) ──

const TOKEN_FIELDS = `
  id
  tokenId
  baseURI
  lazyMintedAt
  lazyMintBlock
  lazyMintTxHash
  pricePerToken
  currency
  maxClaimableSupply
  supplyClaimed
  quantityLimitPerWallet
  conditionStartTimestamp
  conditionUpdatedAt
  totalPurchases
`;

const PURCHASE_FIELDS = `
  id
  tokenId
  claimConditionIndex
  claimer
  receiver
  quantity
  timestamp
  blockNumber
  txHash
`;

const STORE_FIELDS = `
  id
  owner
  name
  description
  logo
  website
  tagline
  isActive
  createdAt
  updatedAt
`;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Page through all lazy-minted drops. Used by the marketplace browse grid.
 *
 * NOTE: filtering by "creator wallet" is not done here because DropERC1155
 * doesn't store the creator on the token entity directly — we'd need the
 * lazyMintTxHash sender, which the current subgraph schema does not surface
 * on `Token`. For creator-scoped queries use `listDropsByCreator`, which
 * routes through the stores subgraph's domain registration → store owner.
 */
export async function listDrops(params: ListDropsParams = {}): Promise<ListDropsResult> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const orderBy = params.orderBy ?? "lazyMintedAt";
  const orderDirection = params.orderDirection ?? "desc";

  const data = await gql<{ tokens: DropToken[] }>(
    getDropSubgraphUrl(),
    `query ListDrops($first: Int!, $skip: Int!, $orderBy: Token_orderBy!, $orderDirection: OrderDirection!) {
      tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
        ${TOKEN_FIELDS}
      }
    }`,
    { first: pageSize, skip, orderBy, orderDirection },
  );

  return {
    items: data.tokens,
    hasMore: data.tokens.length === pageSize,
  };
}

/**
 * Look up a single drop by tokenId. Returns `null` if not found.
 */
export async function getDrop(tokenId: string | number | bigint): Promise<DropToken | null> {
  const id = String(tokenId);
  const data = await gql<{ token: DropToken | null }>(
    getDropSubgraphUrl(),
    `query GetDrop($id: ID!) {
      token(id: $id) { ${TOKEN_FIELDS} }
    }`,
    { id },
  );
  return data.token;
}

/**
 * List drops authored by a given creator wallet.
 *
 * Strategy: the DropERC1155 subgraph does not store creator on each token.
 * But every token's `lazyMintTxHash` is the tx hash of the lazyMint call,
 * and lazyMint is gated by JoyCreatorGate which requires the caller to own
 * a .joy name. So "creator" === "wallet that signed lazyMint", which today
 * is a single platform admin/bot wallet (not the per-creator wallet).
 *
 * Until the subgraph indexes creator-per-token, this helper returns every
 * drop and asks the caller to filter post-hoc (e.g. by matching baseURI
 * metadata.creatorWallet). That keeps the function shape stable so callers
 * don't need to change once subgraph indexing improves.
 */
export async function listDropsByCreator(params: ListDropsByCreatorParams): Promise<ListDropsResult> {
  if (!params.creator) {
    throw new Error("listDropsByCreator: creator wallet is required");
  }
  // For now, delegate to listDrops; future versions will add a where-filter
  // once the subgraph exposes `creator` on Token. Logged so we can audit.
  logger.debug(
    `listDropsByCreator(${params.creator}) — delegating to listDrops (subgraph lacks per-token creator)`,
  );
  return listDrops(params);
}

/**
 * List claim() events for a buyer wallet (their on-chain purchase history).
 */
export async function listClaimsByBuyer(params: ListClaimsByBuyerParams): Promise<DropPurchase[]> {
  if (!params.buyer) {
    throw new Error("listClaimsByBuyer: buyer wallet is required");
  }
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const buyer = params.buyer.toLowerCase();

  const data = await gql<{ purchases: DropPurchase[] }>(
    getDropSubgraphUrl(),
    `query ListClaimsByBuyer($buyer: Bytes!, $first: Int!, $skip: Int!) {
      purchases(
        where: { claimer: $buyer }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        ${PURCHASE_FIELDS}
      }
    }`,
    { buyer, first: pageSize, skip },
  );
  return data.purchases;
}

/**
 * Check whether a wallet has claimed any quantity of a given tokenId.
 * Returns a `DropUserBalance | null` — null means "never claimed".
 */
export async function getOwnership(
  tokenId: string | number | bigint,
  walletAddress: string,
): Promise<DropUserBalance | null> {
  if (!walletAddress) {
    throw new Error("getOwnership: walletAddress is required");
  }
  const tid = String(tokenId);
  const user = walletAddress.toLowerCase();
  // UserBalance.id convention in the subgraph is `<user>-<tokenId>` (typical
  // thirdweb pattern). Try a direct id lookup first; fall back to where-filter.
  const idGuess = `${user}-${tid}`;

  const data = await gql<{
    direct: DropUserBalance | null;
    via_where: DropUserBalance[];
  }>(
    getDropSubgraphUrl(),
    `query GetOwnership($id: ID!, $user: Bytes!, $tokenId: BigInt!) {
      direct: userBalance(id: $id) {
        id user tokenId totalClaimed lastClaimedAt
      }
      via_where: userBalances(where: { user: $user, tokenId: $tokenId }, first: 1) {
        id user tokenId totalClaimed lastClaimedAt
      }
    }`,
    { id: idGuess, user, tokenId: tid },
  );
  return data.direct ?? data.via_where[0] ?? null;
}

/**
 * Look up a store (joy domain) by id (the bare label, e.g. "love").
 * Returns null if no store with that id exists.
 */
export async function getStore(id: string): Promise<JoyStore | null> {
  if (!id) throw new Error("getStore: id is required");
  const data = await gql<{ store: JoyStore | null }>(
    getStoresSubgraphUrl(),
    `query GetStore($id: ID!) {
      store(id: $id) { ${STORE_FIELDS} }
    }`,
    { id },
  );
  return data.store;
}

/**
 * List all stores owned by a wallet.
 */
export async function listStoresByOwner(walletAddress: string, first = 50): Promise<JoyStore[]> {
  if (!walletAddress) {
    throw new Error("listStoresByOwner: walletAddress is required");
  }
  const owner = walletAddress.toLowerCase();
  const data = await gql<{ stores: JoyStore[] }>(
    getStoresSubgraphUrl(),
    `query ListStoresByOwner($owner: Bytes!, $first: Int!) {
      stores(where: { owner: $owner }, first: $first, orderBy: createdAt, orderDirection: desc) {
        ${STORE_FIELDS}
      }
    }`,
    { owner, first: Math.min(Math.max(first, 1), 100) },
  );
  return data.stores;
}

/** Pretty-print a DropToken for logs / UI debug. */
export function summarizeDrop(t: DropToken): string {
  return `Drop#${t.tokenId} (${t.baseURI ? "baseURI=" + t.baseURI.slice(0, 60) : "no baseURI"}, claimed=${t.supplyClaimed ?? 0}/${t.maxClaimableSupply ?? "∞"})`;
}

// Internal helpers exposed for tests only.
export const __test__ = { gql };
