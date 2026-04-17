import { useState, useCallback } from "react";
import { getJoyLicenseContract, thirdwebClient, getThirdwebChain, THIRDWEB_CONTRACTS } from "@/config/thirdweb";
import { IpcClient } from "@/ipc/ipc_client";

interface DirectListingParams {
  tokenId: string | bigint;
  price: string;
  currency?: string;
  quantity?: number;
}

/**
 * Hook for minting on the shared JoyLicenseToken (ERC-1155) and syncing
 * the listing to joymarketplace.io via the marketplace-sync IPC handlers.
 */
export function useThirdwebMarketplace() {
  const [isLoading, setIsLoading] = useState(false);

  const createDirectListing = useCallback(
    async (params: DirectListingParams) => {
      setIsLoading(true);
      try {
        const ipc = IpcClient.getInstance();
        const result = await ipc.invoke("marketplace-sync:sync-listing", {
          tokenId: String(params.tokenId),
          contractAddress: THIRDWEB_CONTRACTS.nftCollection.address,
          chainId: THIRDWEB_CONTRACTS.nftCollection.chainId,
          price: params.price,
          currency: params.currency ?? "MATIC",
          quantity: params.quantity ?? 1,
        });
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { createDirectListing, isLoading };
}
