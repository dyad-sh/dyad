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
  SubgraphAsset,
  SubgraphListing,
  SubgraphAIModel,
  SubgraphAIModelLicense,
  SubgraphMarketplaceStats,
  SubgraphReceipt,
  SubgraphAssetsParams,
  SubgraphListingsParams,
  SubgraphAIModelsParams,
} from "@/types/subgraph_types";

const logger = log.scope("subgraph");

// ── Subgraph endpoints ─────────────────────────────────────────────────────

const SUBGRAPH_URLS = {
  drops:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn",
  stores:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.2/gn",
  marketplace:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-marketplace-amoy/0.0.3/gn",
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

// ── Marketplace subgraph queries ───────────────────────────────────────────

export async function getMarketplaceAssets(params?: SubgraphAssetsParams): Promise<SubgraphAsset[]> {
  const first = params?.first ?? 100;
  const skip = params?.skip ?? 0;
  const orderBy = params?.orderBy ?? "createdAt";
  const orderDirection = params?.orderDirection ?? "desc";

  const where: Record<string, unknown> = {};
  if (params?.assetType) where.assetType = params.assetType;
  if (params?.creator) where.creator = params.creator.toLowerCase();

  const data = await querySubgraph<{ assets: SubgraphAsset[] }>(
    SUBGRAPH_URLS.marketplace,
    `query GetAssets($first: Int!, $skip: Int!, $orderBy: Asset_orderBy!, $orderDirection: OrderDirection!, $where: Asset_filter) {
      assets(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
        id
        tokenId
        contractAddress
        owner
        creator
        name
        assetType
        merkleRoot
        totalChunks
        encrypted
        verificationScore
        totalSales
        totalVolume
        createdAt
        createdTxHash
        publisher {
          id
          address
          name
          reputationScore
          totalAssets
          totalSales
        }
        store {
          id
          name
          isVerified
        }
        verification {
          level
          active
          verifiedAt
        }
      }
    }`,
    { first, skip, orderBy, orderDirection, where: Object.keys(where).length ? where : undefined },
  );

  return data.assets;
}

export async function getMarketplaceListings(params?: SubgraphListingsParams): Promise<SubgraphListing[]> {
  const first = params?.first ?? 100;
  const skip = params?.skip ?? 0;
  const orderBy = params?.orderBy ?? "createdAt";
  const orderDirection = params?.orderDirection ?? "desc";

  const where: Record<string, unknown> = {};
  if (params?.activeOnly !== false) where.active = true;
  if (params?.seller) where.seller = params.seller.toLowerCase();

  const data = await querySubgraph<{ listings: SubgraphListing[] }>(
    SUBGRAPH_URLS.marketplace,
    `query GetListings($first: Int!, $skip: Int!, $orderBy: Listing_orderBy!, $orderDirection: OrderDirection!, $where: Listing_filter) {
      listings(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
        id
        listingId
        seller
        nftContract
        tokenId
        quantity
        pricePerItem
        effectivePrice
        hasDiscount
        discountEndTime
        discountedPrice
        active
        createdAt
        updatedAt
        soldAt
        buyer
        totalPaid
        platformFee
        royaltyPaid
        createdTxHash
        asset {
          id
          tokenId
          name
          assetType
          creator
          verificationScore
          totalSales
          publisher {
            name
            reputationScore
          }
        }
      }
    }`,
    { first, skip, orderBy, orderDirection, where },
  );

  return data.listings;
}

export async function getAIModels(params?: SubgraphAIModelsParams): Promise<SubgraphAIModel[]> {
  const first = params?.first ?? 100;
  const skip = params?.skip ?? 0;
  const orderBy = params?.orderBy ?? "createdAt";
  const orderDirection = params?.orderDirection ?? "desc";

  const where: Record<string, unknown> = {};
  if (params?.creator) where.creator = params.creator.toLowerCase();
  if (params?.verified !== undefined) where.verified = params.verified;

  const data = await querySubgraph<{ aimodels: SubgraphAIModel[] }>(
    SUBGRAPH_URLS.marketplace,
    `query GetAIModels($first: Int!, $skip: Int!, $orderBy: AIModel_orderBy!, $orderDirection: OrderDirection!, $where: AIModel_filter) {
      aimodels(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
        id
        tokenId
        creator
        owner
        name
        category
        licenseType
        verified
        qualityScore
        usageCount
        totalLicenseRevenue
        createdAt
        createdTxHash
        licenses(first: 10, orderBy: timestamp, orderDirection: desc) {
          id
          licensee
          licenseType
          amount
          expiresAt
          timestamp
          txHash
        }
      }
    }`,
    { first, skip, orderBy, orderDirection, where: Object.keys(where).length ? where : undefined },
  );

  return data.aimodels;
}

export async function getUserLicenses(walletAddress: string, first = 100): Promise<SubgraphAIModelLicense[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ aimodelLicenses: SubgraphAIModelLicense[] }>(
    SUBGRAPH_URLS.marketplace,
    `query GetUserLicenses($licensee: String!, $first: Int!) {
      aimodelLicenses(where: { licensee: $licensee }, first: $first, orderBy: timestamp, orderDirection: desc) {
        id
        licensee
        licenseType
        amount
        expiresAt
        timestamp
        txHash
        model {
          id
          tokenId
          name
          creator
          category
          verified
          qualityScore
        }
      }
    }`,
    { licensee: addr, first },
  );

  return data.aimodelLicenses;
}

export async function getUserReceipts(walletAddress: string, first = 100): Promise<SubgraphReceipt[]> {
  const addr = walletAddress.toLowerCase();

  const data = await querySubgraph<{ receipts: SubgraphReceipt[] }>(
    SUBGRAPH_URLS.marketplace,
    `query GetUserReceipts($buyer: String!, $first: Int!) {
      receipts(where: { buyer: $buyer }, first: $first, orderBy: issuedAt, orderDirection: desc) {
        id
        receiptId
        buyer
        seller
        listingId
        price
        fulfilled
        fulfilledMethod
        fulfilledAt
        disputed
        disputeReason
        refunded
        refundAmount
        downloadCount
        issuedAt
        issuedTxHash
      }
    }`,
    { buyer: addr, first },
  );

  return data.receipts;
}

export async function getMarketplaceStats(): Promise<SubgraphMarketplaceStats | null> {
  try {
    const data = await querySubgraph<{ marketplaceStats_collection: SubgraphMarketplaceStats[] }>(
      SUBGRAPH_URLS.marketplace,
      `{ marketplaceStats_collection(first: 1) {
        id totalListings activeListings totalSales totalVolume
        totalAssets totalPublishers totalEscrows totalReviews
        totalCollections totalBundles updatedAt
      } }`,
    );
    return data.marketplaceStats_collection?.[0] ?? null;
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

  const [ownedTokens, purchases, stores, domains, dropStats, storeStats, marketplaceAssets, activeListings, licenses, marketplaceStats] = await Promise.all([
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
    getMarketplaceAssets({ creator: walletAddress }).catch((e) => {
      logger.warn("Failed to fetch marketplace assets:", e);
      return [] as SubgraphAsset[];
    }),
    getMarketplaceListings({ seller: walletAddress, activeOnly: true }).catch((e) => {
      logger.warn("Failed to fetch active listings:", e);
      return [] as SubgraphListing[];
    }),
    getUserLicenses(walletAddress).catch((e) => {
      logger.warn("Failed to fetch user licenses:", e);
      return [] as SubgraphAIModelLicense[];
    }),
    getMarketplaceStats(),
  ]);

  logger.info(
    `Assets for ${walletAddress}: ${ownedTokens.length} tokens, ${purchases.length} purchases, ${stores.length} stores, ${domains.length} domains, ${marketplaceAssets.length} marketplace assets, ${activeListings.length} listings, ${licenses.length} licenses`,
  );

  return { ownedTokens, purchases, stores, domains, dropStats, storeStats, marketplaceAssets, activeListings, licenses, marketplaceStats };
}
