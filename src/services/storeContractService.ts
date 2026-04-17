import { THIRDWEB_CONTRACTS } from "@/config/thirdweb";

/**
 * Returns the contract address for a given store.
 * All assets use the shared JoyLicenseToken ERC-1155.
 */
export function getStoreContract(_storeId?: string) {
  return {
    address: THIRDWEB_CONTRACTS.nftCollection.address,
    chainId: THIRDWEB_CONTRACTS.nftCollection.chainId,
    name: THIRDWEB_CONTRACTS.nftCollection.name,
    standard: THIRDWEB_CONTRACTS.nftCollection.standard,
  };
}
