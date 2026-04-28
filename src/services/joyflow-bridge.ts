/**
 * JoyFlow bridge service — connects the asset wizard to the
 * JoyCreate JoyFlow engine and IPC pipeline for post-creation operations.
 *
 * Two modes:
 *   1. Stub event mode (legacy) — when params have no `file`/`fileBytes`,
 *      we just dispatch a window event and return a placeholder CID. This
 *      preserves backwards compatibility with existing callers.
 *   2. Real publish mode — when params include `fileBytes` (Uint8Array)
 *      or `file` (Blob/File), we run the full JoyFlow pipeline:
 *      encrypt → pin chunks to IPFS → pin manifest → return manifest CID.
 *      Pinata JWT is read from VITE_PINATA_JWT.
 */

import { JoyFlowEngine } from "@/lib/joyflow";

export interface PublishToDecentralizedParams {
  /** Optional raw bytes of the asset file. If present, real publish runs. */
  fileBytes?: Uint8Array;
  /** Optional Blob/File. If present (and fileBytes absent), bytes are read. */
  file?: Blob;
  /** Filename used in IPFS metadata. */
  fileName?: string;
  /** Original MIME type. */
  mimeType?: string;
  /** Asset display name. */
  assetName?: string;
  /** Asset description. */
  description?: string;
  /** Canonical asset category (model, dataset, prompt, ...). */
  category?: string;
  /** Optional preview image CID (already pinned). */
  imageCid?: string;
  /** Creator wallet address. */
  creator?: string;
  /** Pre-computed metadata/encrypted CID — used as fallback in stub mode. */
  metadataCID?: string;
  encryptedCID?: string;
  [key: string]: unknown;
}

export interface PublishToDecentralizedResult {
  success: boolean;
  manifestCID: string;
  encryptionKeyHex?: string;
  error?: string;
}

let cachedEngine: JoyFlowEngine | null = null;

function getEngine(): JoyFlowEngine {
  if (cachedEngine) return cachedEngine;
  const pinataJwt = import.meta.env.VITE_PINATA_JWT || undefined;
  cachedEngine = new JoyFlowEngine({
    pinataJwt,
    chainId: 80002,
  });
  return cachedEngine;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

    /**
     * Publish asset to the decentralized stack (IPFS + manifest).
     *
     * If `fileBytes` or `file` is provided, runs the real JoyFlow pipeline:
     * encrypt → pin chunks → pin manifest → return manifest CID. Otherwise
     * falls back to the legacy event-stub behavior.
     */
    async publishToDecentralized(
      params: PublishToDecentralizedParams,
    ): Promise<PublishToDecentralizedResult> {
      try {
        // Resolve file bytes if a Blob/File was passed instead of raw bytes.
        let bytes = params.fileBytes;
        if (!bytes && params.file) {
          const buf = await params.file.arrayBuffer();
          bytes = new Uint8Array(buf);
        }

        // Real publish path
        if (bytes && bytes.length > 0) {
          const engine = getEngine();
          const { manifestCid, encryptionKey } = await engine.publish({
            file: bytes,
            fileName: params.fileName || "asset.bin",
            mimeType: params.mimeType || "application/octet-stream",
            name: params.assetName || "Untitled Asset",
            description: params.description,
            category: params.category,
            imageCid: params.imageCid,
            creator: params.creator,
          });

          window.dispatchEvent(
            new CustomEvent("joyflow:publish-decentralized", {
              detail: { ...params, manifestCID: manifestCid },
            }),
          );

          return {
            success: true,
            manifestCID: manifestCid,
            encryptionKeyHex: bytesToHex(encryptionKey),
          };
        }

        // Legacy stub path — caller already pinned the asset elsewhere.
        window.dispatchEvent(
          new CustomEvent("joyflow:publish-decentralized", { detail: params }),
        );
        const manifestCID =
          params.metadataCID || params.encryptedCID || "pending";
        return { success: true, manifestCID };
      } catch (e: unknown) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
          manifestCID: "",
        };
      }
    },
  };
}
