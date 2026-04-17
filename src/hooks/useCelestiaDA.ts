import { useCelestiaBlobs } from "./useCelestiaBlobs";
import { useCallback } from "react";

/**
 * Thin wrapper around useCelestiaBlobs that adds asset-provenance
 * and listing-manifest convenience methods.
 */
export function useCelestiaDA() {
  const blobs = useCelestiaBlobs();

  /** Record a full asset provenance record on Celestia DA. */
  const recordAssetProvenance = useCallback(
    async (manifest: Record<string, unknown>) => {
      return blobs.submitJSON({
        json: {
          type: "asset-provenance",
          ...manifest,
          recordedAt: new Date().toISOString(),
        },
        label: `provenance:${(manifest.asset_name as string) || (manifest.assetName as string) || "unknown"}`,
        dataType: "provenance",
      });
    },
    [blobs.submitJSON],
  );

  /** Anchor a listing manifest to Celestia DA. */
  const recordListingManifest = useCallback(
    async (manifest: Record<string, unknown>) => {
      return blobs.submitJSON({
        json: {
          type: "listing-manifest",
          ...manifest,
          recordedAt: new Date().toISOString(),
        },
        label: `listing:${(manifest.asset_name as string) || (manifest.assetName as string) || "unknown"}`,
        dataType: "listing",
      });
    },
    [blobs.submitJSON],
  );

  return {
    ...blobs,
    recordAssetProvenance,
    recordListingManifest,
  };
}
