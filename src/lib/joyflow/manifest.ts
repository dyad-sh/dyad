/**
 * JoyFlow Manifest — IPFS-pinned asset manifests with encryption envelopes.
 *
 * Ported from joy-publish-bundle/src/lib/joyflow/manifest.ts.
 */

import { IPFS_GATEWAYS, extractIpfsHash } from "@/utils/ipfsGateway";

export interface EncryptionEnvelope {
  chunkCids: string[];
  integrityHashes: string[];
  algorithm: "AES-256-GCM";
  chunkSize: number;
  originalSize: number;
  mimeType: string;
  litMetadata?: {
    encryptedSymmetricKey: string;
    accessControlConditions: unknown[];
    chain: string;
  };
}

export interface AssetManifest {
  version: "1.0.0";
  name: string;
  description?: string;
  category?: string;
  imageCid?: string;
  encryptionEnvelope: EncryptionEnvelope;
  tokenId?: string;
  contractAddress?: string;
  chainId?: number;
  creator?: string;
  createdAt: string;
}

export function createManifest(params: {
  name: string;
  description?: string;
  category?: string;
  imageCid?: string;
  chunkCids: string[];
  integrityHashes: string[];
  chunkSize: number;
  originalSize: number;
  mimeType: string;
  tokenId?: string;
  contractAddress?: string;
  chainId?: number;
  creator?: string;
  litMetadata?: EncryptionEnvelope["litMetadata"];
}): AssetManifest {
  return {
    version: "1.0.0",
    name: params.name,
    description: params.description,
    category: params.category,
    imageCid: params.imageCid,
    encryptionEnvelope: {
      chunkCids: params.chunkCids,
      integrityHashes: params.integrityHashes,
      algorithm: "AES-256-GCM",
      chunkSize: params.chunkSize,
      originalSize: params.originalSize,
      mimeType: params.mimeType,
      litMetadata: params.litMetadata,
    },
    tokenId: params.tokenId,
    contractAddress: params.contractAddress,
    chainId: params.chainId,
    creator: params.creator,
    createdAt: new Date().toISOString(),
  };
}

export async function resolveManifest(
  manifestCid: string,
): Promise<AssetManifest | null> {
  const hash = extractIpfsHash(manifestCid) || manifestCid;
  if (!hash) return null;

  const gateways = [
    "https://rose-magnificent-spoonbill-466.mypinata.cloud/ipfs/",
    ...IPFS_GATEWAYS,
  ];

  for (const gw of gateways) {
    try {
      const url = `${gw}${hash}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.version && data?.encryptionEnvelope) {
        return data as AssetManifest;
      }
    } catch {
      continue;
    }
  }

  console.warn(`[JoyFlow] Failed to resolve manifest: ${manifestCid}`);
  return null;
}

export async function retrieveChunks(
  chunkCids: string[],
  integrityHashes: string[],
): Promise<
  { ciphertext: Uint8Array; hash: string; index: number; iv: string }[]
> {
  const gateways = [
    "https://rose-magnificent-spoonbill-466.mypinata.cloud/ipfs/",
    ...IPFS_GATEWAYS,
  ];

  const results = await Promise.all(
    chunkCids.map(async (cid, index) => {
      const hash = extractIpfsHash(cid) || cid;

      for (const gw of gateways) {
        try {
          const response = await fetch(`${gw}${hash}`, {
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) continue;

          const buffer = await response.arrayBuffer();
          const data = new Uint8Array(buffer);

          // First 12 bytes are the IV, rest is ciphertext.
          const iv = Array.from(data.slice(0, 12))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const ciphertext = data.slice(12);

          return {
            ciphertext,
            hash: integrityHashes[index],
            index,
            iv,
          };
        } catch {
          continue;
        }
      }
      throw new Error(`Failed to retrieve chunk ${index} (CID: ${cid})`);
    }),
  );

  return results;
}
