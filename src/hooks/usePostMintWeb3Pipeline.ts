import { useState, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";

interface PipelineResult {
  celestia?: { contentHash: string; height?: number };
  marketplaceSync?: { marketplaceAssetId?: string; success: boolean };
}

/**
 * Orchestrates the post-mint Web3 pipeline:
 *   1. Record provenance on Celestia DA
 *   2. Sync listing to joymarketplace.io
 */
export function usePostMintWeb3Pipeline() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<PipelineResult | null>(null);

  const executePipeline = useCallback(
    async (params: {
      assetName?: string;
      name?: string;
      tokenId?: string | number | bigint;
      contractAddress?: string;
      metadataCid?: string;
      metadataCID?: string;
      merkleRoot?: string;
      creatorWallet?: string;
      creatorId?: string;
      price?: number;
      currency?: string;
      royaltyPercent?: number;
      royaltyBps?: number;
      category?: string;
      description?: string;
      licenseCid?: string;
      [key: string]: unknown;
    }) => {
      setIsRunning(true);
      const pipeline: PipelineResult = {};

      const assetName = params.assetName || params.name || "Untitled";
      const tokenId = String(params.tokenId ?? "0");
      const metadataCid = params.metadataCid || params.metadataCID || "";
      const creatorWallet = params.creatorWallet || params.creatorId || "";

      try {
        const ipc = IpcClient.getInstance();

        // Step 1 — Celestia DA provenance
        try {
          const celestiaResult = await ipc.invoke("celestia:blob:submit-json", {
            json: {
              type: "asset-provenance",
              assetName,
              tokenId,
              contractAddress: params.contractAddress,
              metadataCid,
              merkleRoot: params.merkleRoot,
              creatorWallet,
              recordedAt: new Date().toISOString(),
            },
            label: `provenance:${assetName}`,
          });
          pipeline.celestia = celestiaResult;
        } catch {
          // Celestia is optional — don't block the pipeline
          pipeline.celestia = undefined;
        }

        // Step 2 — Marketplace sync
        try {
          const syncResult = await ipc.invoke(
            "marketplace-sync:sync-listing",
            {
              localAssetId: tokenId,
              name: assetName,
              description: params.description,
              category: params.category,
              contentCid: metadataCid,
              price: params.price,
              currency: params.currency ?? "MATIC",
              royaltyPercent: params.royaltyPercent ?? (params.royaltyBps ? (params.royaltyBps as number) / 100 : 10),
              licenseType: "commercial",
              tokenId,
              contractAddress: params.contractAddress,
              chainId: 80002,
              merkleRoot: params.merkleRoot,
              licenseCid: params.licenseCid ?? "",
            },
          );
          pipeline.marketplaceSync = syncResult;
        } catch {
          pipeline.marketplaceSync = { success: false };
        }

        setResults(pipeline);
        return pipeline;
      } finally {
        setIsRunning(false);
      }
    },
    [],
  );

  return { executePipeline, executePostMint: executePipeline, isRunning, results };
}
