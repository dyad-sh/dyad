/**
 * JoyFlow bridge service — connects the asset wizard to the
 * JoyCreate IPC pipeline for post-creation operations.
 */
export function getJoyFlowBridge() {
  return {
    async notifyAssetCreated(params: {
      assetName: string;
      tokenId: string;
      contractAddress: string;
      metadataCid: string;
    }) {
      window.dispatchEvent(
        new CustomEvent("joyflow:asset-created", { detail: params }),
      );
      return { success: true };
    },

    async notifyListingPublished(params: {
      tokenId: string;
      marketplaceAssetId?: string;
      price: number;
    }) {
      window.dispatchEvent(
        new CustomEvent("joyflow:listing-published", { detail: params }),
      );
      return { success: true };
    },

    /** Publish asset manifest to decentralized stack (IPFS + ERC-1155). */
    async publishToDecentralized(params: Record<string, unknown>) {
      try {
        window.dispatchEvent(
          new CustomEvent("joyflow:publish-decentralized", { detail: params }),
        );
        const manifestCID = (params.metadataCID as string) || (params.encryptedCID as string) || "pending";
        return { success: true, manifestCID };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e), manifestCID: "" };
      }
    },
  };
}
