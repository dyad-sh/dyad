/**
 * Joy Marketplace Subgraph Client
 *
 * Queries Goldsky-indexed subgraphs for on-chain marketplace data:
 * - joy-drop-amoy: Token drops, purchases, user balances
 * - joy-stores-amoy: Stores, domains, text records
 */

import log from "electron-log";
import type {
  SubgraphToken,
  SubgraphPurchase,
  SubgraphUserBalance,
  SubgraphDropStats,
  SubgraphStore,
  SubgraphDomainRegistration,
  SubgraphStoreStats,
  MyMarketplaceAssets,
  SubgraphQueryParams,
  SubgraphTokensParams,
} from "@/types/subgraph_types";

const logger = log.scope("subgraph");

// ── Subgraph endpoints ─────────────────────────────────────────────────────

const SUBGRAPH_URLS = {
  drops:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn",
  stores:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.2/gn",
} as const;

// ── Generic GraphQL fetcher ────────────────────────────────────────────────

async function querySubgraph<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body = JSON.stringify({ query, variables });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Subgraph query failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`Subgraph error: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  if (!json.data) {
    throw new Error("Subgraph returned no data");
  }

  return json.data;
}

// ── Drop subgraph queries ──────────────────────────────────────────────────

export async function getTokens(params?: SubgraphTokensParams): Promise<SubgraphToken[]> {
  const first = params?.first ?? 100;
  const skip = params?.skip ?? 0;
  const orderBy = params?.orderBy ?? "lazyMintedAt";
  const orderDirection = params?.orderDirection ?? "desc";

  const data = await querySubgraph<{ tokens: SubgraphToken[] }>(
    SUBGRAPH_URLS.drops,
    `query GetTokens($first: Int!, $skip: Int!, $orderBy: Token_orderBy!, $orderDirection: OrderDirection!) {
      tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
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
        totalPurchases
      }
    }`,
    { first, skip, orderBy, orderDirection },
  );

  return data.tokens;
}

export async function getUserBalances(walletAddress: string, first = 100): Promise<SubgraphUserBalance[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ userBalances: SubgraphUserBalance[] }>(
    SUBGRAPH_URLS.drops,
    `query GetUserBalances($user: String!, $first: Int!) {
      userBalances(where: { user: $user }, first: $first, orderBy: lastClaimedAt, orderDirection: desc) {
        id
        user
        tokenId
        totalClaimed
        lastClaimedAt
        token {
          id
          tokenId
          baseURI
          pricePerToken
          currency
          totalPurchases
          lazyMintedAt
        }
      }
    }`,
    { user: addr, first },
  );

  return data.userBalances;
}

export async function getUserPurchases(walletAddress: string, first = 100): Promise<SubgraphPurchase[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ purchases: SubgraphPurchase[] }>(
    SUBGRAPH_URLS.drops,
    `query GetUserPurchases($claimer: String!, $first: Int!) {
      purchases(where: { claimer: $claimer }, first: $first, orderBy: timestamp, orderDirection: desc) {
        id
        tokenId
        claimConditionIndex
        claimer
        receiver
        quantity
        timestamp
        blockNumber
        txHash
      }
    }`,
    { claimer: addr, first },
  );

  return data.purchases;
}

export async function getDropStats(): Promise<SubgraphDropStats | null> {
  try {
    const data = await querySubgraph<{ dropStats: SubgraphDropStats[] }>(
      SUBGRAPH_URLS.drops,
      `{ dropStats(first: 1) { id totalTokens totalPurchases updatedAt } }`,
    );
    return data.dropStats?.[0] ?? null;
  } catch {
    return null;
  }
}

// ── Store subgraph queries ─────────────────────────────────────────────────

export async function getUserStores(walletAddress: string, first = 50): Promise<SubgraphStore[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ stores: SubgraphStore[] }>(
    SUBGRAPH_URLS.stores,
    `query GetUserStores($owner: String!, $first: Int!) {
      stores(where: { owner: $owner }, first: $first, orderBy: createdAt, orderDirection: desc) {
        id
        domain
        owner
        name
        description
        logo
        website
        tagline
        isActive
        createdAt
        updatedAt
        textRecords {
          id
          key
          value
          updatedAt
        }
      }
    }`,
    { owner: addr, first },
  );

  return data.stores;
}

export async function getUserDomains(walletAddress: string, first = 50): Promise<SubgraphDomainRegistration[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ domainRegistrations: SubgraphDomainRegistration[] }>(
    SUBGRAPH_URLS.stores,
    `query GetUserDomains($owner: String!, $first: Int!) {
      domainRegistrations(where: { owner: $owner }, first: $first, orderBy: registeredAt, orderDirection: desc) {
        id
        labelHash
        name
        fullName
        owner
        resolver
        resolvedAddress
        expiresAt
        registeredAt
        registeredTxHash
        cost
        textRecords {
          id
          key
          value
          updatedAt
        }
      }
    }`,
    { owner: addr, first },
  );

  return data.domainRegistrations;
}

export async function getAllStores(first = 100): Promise<SubgraphStore[]> {
  const data = await querySubgraph<{ stores: SubgraphStore[] }>(
    SUBGRAPH_URLS.stores,
    `query GetAllStores($first: Int!) {
      stores(first: $first, orderBy: createdAt, orderDirection: desc) {
        id
        domain
        owner
        name
        description
        logo
        website
        tagline
        isActive
        createdAt
        updatedAt
      }
    }`,
    { first },
  );

  return data.stores;
}

export async function getAllDomains(first = 100): Promise<SubgraphDomainRegistration[]> {
  const data = await querySubgraph<{ domainRegistrations: SubgraphDomainRegistration[] }>(
    SUBGRAPH_URLS.stores,
    `query GetAllDomains($first: Int!) {
      domainRegistrations(first: $first, orderBy: registeredAt, orderDirection: desc) {
        id
        name
        fullName
        owner
        resolvedAddress
        expiresAt
        registeredAt
        cost
      }
    }`,
    { first },
  );

  return data.domainRegistrations;
}

export async function getStoreStats(): Promise<SubgraphStoreStats | null> {
  try {
    const data = await querySubgraph<{ storeStats_collection: SubgraphStoreStats[] }>(
      SUBGRAPH_URLS.stores,
      `{ storeStats_collection(first: 1) { id totalDomains totalStores totalTextRecords updatedAt } }`,
    );
    return data.storeStats_collection?.[0] ?? null;
  } catch {
    return null;
  }
}

// ── Aggregated "My Assets" query ───────────────────────────────────────────

export async function getMyMarketplaceAssets(params: SubgraphQueryParams): Promise<MyMarketplaceAssets> {
  const { walletAddress } = params;

  if (!walletAddress) {
    throw new Error("Wallet address is required to query marketplace assets");
  }

  logger.info(`Fetching marketplace assets for ${walletAddress}`);

  const [ownedTokens, purchases, stores, domains, dropStats, storeStats] = await Promise.all([
    getUserBalances(walletAddress).catch((e) => {
      logger.warn("Failed to fetch user balances:", e);
      return [] as SubgraphUserBalance[];
    }),
    getUserPurchases(walletAddress).catch((e) => {
      logger.warn("Failed to fetch user purchases:", e);
      return [] as SubgraphPurchase[];
    }),
    getUserStores(walletAddress).catch((e) => {
      logger.warn("Failed to fetch user stores:", e);
      return [] as SubgraphStore[];
    }),
    getUserDomains(walletAddress).catch((e) => {
      logger.warn("Failed to fetch user domains:", e);
      return [] as SubgraphDomainRegistration[];
    }),
    getDropStats(),
    getStoreStats(),
  ]);

  logger.info(
    `Assets for ${walletAddress}: ${ownedTokens.length} tokens, ${purchases.length} purchases, ${stores.length} stores, ${domains.length} domains`,
  );

  return { ownedTokens, purchases, stores, domains, dropStats, storeStats };
}
