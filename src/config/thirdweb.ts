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

// Get a typed Thirdweb contract handle for the JoyLicenseToken
export function getJoyLicenseContract() {
  return getContract({
    client: thirdwebClient,
    chain: getThirdwebChain(),
    address: THIRDWEB_CONTRACTS.nftCollection.address,
  });
}
