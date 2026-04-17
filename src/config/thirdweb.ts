import { createThirdwebClient, getContract, defineChain } from "thirdweb";

// Thirdweb client — uses env var or hardcoded fallback
const THIRDWEB_CLIENT_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_THIRDWEB_CLIENT_ID) ||
  "bed83259c0fb5a34eb2a83e4f2446fa7";

export const thirdwebClient = createThirdwebClient({
  clientId: THIRDWEB_CLIENT_ID,
});

// Polygon Amoy Testnet
export const TARGET_CHAIN_ID = 80002;
export const TARGET_CHAIN_NAME = "Polygon Amoy Testnet";

export function getThirdwebChain(chainId?: number) {
  return defineChain(chainId ?? TARGET_CHAIN_ID);
}

// Deployed contracts
export const THIRDWEB_CONTRACTS = {
  nftCollection: {
    address: "0xb099296fe65a2185731aC8B1411A56175e6Be47a" as const,
    chainId: TARGET_CHAIN_ID,
    name: "JoyLicenseToken",
    standard: "ERC-1155" as const,
  },
  /** Alias — wizard references THIRDWEB_CONTRACTS.edition */
  edition: {
    address: "0xb099296fe65a2185731aC8B1411A56175e6Be47a" as const,
    chainId: TARGET_CHAIN_ID,
    name: "JoyLicenseToken",
    standard: "ERC-1155" as const,
  },
} as const;

// =============================================================================
// Goldsky Subgraph Endpoints (Polygon Amoy Testnet)
// =============================================================================

export const GOLDSKY_SUBGRAPHS = {
  /** Joy Marketplace subgraph — listings, purchases, activity */
  marketplace:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-marketplace-amoy/0.0.3/gn",
  /** Joy Stores subgraph — store metadata, creator profiles */
  stores:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.2/gn",
  /** Joy Drop subgraph — edition drops, claims, mints */
  drop:
    "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn",
} as const;

/**
 * Query a Goldsky subgraph with a GraphQL query.
 * @param subgraph Key from GOLDSKY_SUBGRAPHS (marketplace | stores | drop)
 * @param query GraphQL query string
 * @param variables Optional query variables
 */
export async function querySubgraph(
  subgraph: keyof typeof GOLDSKY_SUBGRAPHS,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const url = GOLDSKY_SUBGRAPHS[subgraph];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Subgraph error: ${json.errors[0].message}`);
  return json.data;
}

// Get a typed Thirdweb contract handle for the JoyLicenseToken
export function getJoyLicenseContract() {
  return getContract({
    client: thirdwebClient,
    chain: getThirdwebChain(),
    address: THIRDWEB_CONTRACTS.nftCollection.address,
  });
}
