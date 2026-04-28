/**
 * JoyFlow Engine — Unified orchestration for the asset publish lifecycle.
 *
 * Pipeline: Encrypt → Pin chunks to IPFS → Build & pin manifest → return CID.
 * Reverse:  Verify license → Resolve manifest → Retrieve chunks → Decrypt.
 *
 * Ported from joy-publish-bundle/src/lib/joyflow/engine.ts.
 */

import {
  encryptAsset,
  decryptAsset,
  exportKey,
  importKey,
  sha256,
  JOYFLOW_CHUNK_SIZE,
} from "./crypto";
import {
  createManifest,
  resolveManifest,
  retrieveChunks,
  type AssetManifest,
} from "./manifest";
import { verifyLicense } from "./license";

export interface JoyFlowConfig {
  /** Pinata JWT for IPFS pinning. If absent, pinToIPFS returns a mock CID. */
  pinataJwt?: string;
  /** Pinata gateway base URL. */
  pinataGateway?: string;
  /** Chain ID for license operations. */
  chainId?: number;
}

export interface JoyFlowProgress {
  stage: "encrypt" | "pin-chunk" | "manifest" | "done";
  current: number;
  total: number;
  message?: string;
}

export class JoyFlowEngine {
  private config: JoyFlowConfig;

  constructor(config: JoyFlowConfig = {}) {
    this.config = {
      chainId: 80002,
      pinataGateway:
        "https://rose-magnificent-spoonbill-466.mypinata.cloud",
      ...config,
    };
  }

  /**
   * Encrypt → pin chunks → pin manifest. Resolves with the manifest CID and
   * the raw AES key (caller is responsible for safely transmitting the key
   * to the buyer, e.g. via Lit Protocol or wallet-encrypted envelope).
   */
  async publish(
    params: {
      file: Uint8Array;
      fileName: string;
      mimeType: string;
      name: string;
      description?: string;
      category?: string;
      imageCid?: string;
      creator?: string;
    },
    onProgress?: (p: JoyFlowProgress) => void,
  ): Promise<{
    manifestCid: string;
    manifest: AssetManifest;
    encryptionKey: Uint8Array;
  }> {
    onProgress?.({ stage: "encrypt", current: 0, total: 1, message: "Encrypting" });
    const { key, chunks } = await encryptAsset(params.file);
    const rawKey = await exportKey(key);

    const chunkCids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const ivBytes = new Uint8Array(
        (chunk.iv.match(/.{2}/g) || []).map((b) => parseInt(b, 16)),
      );
      const combined = new Uint8Array(ivBytes.length + chunk.ciphertext.length);
      combined.set(ivBytes, 0);
      combined.set(chunk.ciphertext, ivBytes.length);

      const cid = await this.pinToIPFS(
        combined,
        `${params.fileName}.chunk.${chunk.index}`,
      );
      chunkCids.push(cid);
      onProgress?.({
        stage: "pin-chunk",
        current: i + 1,
        total: chunks.length,
        message: `Pinned chunk ${i + 1}/${chunks.length}`,
      });
    }

    const manifest = createManifest({
      name: params.name,
      description: params.description,
      category: params.category,
      imageCid: params.imageCid,
      chunkCids,
      integrityHashes: chunks.map((c) => c.hash),
      chunkSize: JOYFLOW_CHUNK_SIZE,
      originalSize: params.file.length,
      mimeType: params.mimeType,
      chainId: this.config.chainId,
      creator: params.creator,
    });

    onProgress?.({ stage: "manifest", current: 0, total: 1, message: "Pinning manifest" });
    const manifestCid = await this.pinToIPFS(
      new TextEncoder().encode(JSON.stringify(manifest)),
      `${params.fileName}.manifest.json`,
    );
    onProgress?.({ stage: "done", current: 1, total: 1, message: manifestCid });

    return { manifestCid, manifest, encryptionKey: rawKey };
  }

  /**
   * Verify license → resolve manifest → retrieve chunks → decrypt.
   */
  async download(params: {
    manifestCid: string;
    encryptionKey: Uint8Array;
    walletAddress?: string;
    tokenId?: bigint;
  }): Promise<{ data: Uint8Array; manifest: AssetManifest }> {
    if (params.walletAddress && params.tokenId !== undefined) {
      const hasLicense = await verifyLicense(
        params.walletAddress,
        params.tokenId,
      );
      if (!hasLicense) {
        throw new Error(
          "License verification failed: wallet does not hold a valid license token",
        );
      }
    }

    const manifest = await resolveManifest(params.manifestCid);
    if (!manifest) {
      throw new Error(`Failed to resolve manifest: ${params.manifestCid}`);
    }

    const { encryptionEnvelope } = manifest;

    const chunks = await retrieveChunks(
      encryptionEnvelope.chunkCids,
      encryptionEnvelope.integrityHashes,
    );

    const key = await importKey(params.encryptionKey);
    const decrypted = await decryptAsset(chunks, key);

    return { data: decrypted, manifest };
  }

  /** Pin data to IPFS via Pinata. Returns a mock CID if pinataJwt is unset. */
  private async pinToIPFS(data: Uint8Array, name: string): Promise<string> {
    const jwt = this.config.pinataJwt;
    if (!jwt) {
      const hash = await sha256(data);
      console.warn(
        `[JoyFlow] Pinata not configured, using hash as mock CID: ${hash.slice(0, 16)}`,
      );
      return `Qm${hash.slice(0, 44)}`;
    }

    const formData = new FormData();
    const blob = new Blob([data.buffer as ArrayBuffer]);
    formData.append("file", blob, name);
    formData.append("pinataMetadata", JSON.stringify({ name }));

    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: formData,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Pinata pin failed: ${response.status} ${response.statusText}`,
      );
    }

    const result = await response.json();
    return result.IpfsHash as string;
  }
}
