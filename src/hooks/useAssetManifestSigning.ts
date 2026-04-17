import { useState, useCallback } from "react";
import { useSignMessage } from "wagmi";

export interface AssetManifestSignatureResult {
  signature: string;
  address: string;
  manifestHash: string;
  timestamp: number;
}

/**
 * Signs an asset manifest with the connected wallet and optionally
 * stores the signature for anti-spam verification.
 */
export function useAssetManifestSigning() {
  const { signMessageAsync } = useSignMessage();
  const [isSigning, setIsSigning] = useState(false);

  const signManifest = useCallback(
    async (manifest: Record<string, unknown>, walletAddress: string): Promise<AssetManifestSignatureResult> => {
      setIsSigning(true);
      try {
        const payload = JSON.stringify(manifest, null, 0);

        // SHA-256 hash of the manifest
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
        const manifestHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const message = `JoyCreate Asset Manifest\n\nHash: ${manifestHash}\nTimestamp: ${Date.now()}`;
        const signature = await signMessageAsync({ message });

        return {
          signature,
          address: walletAddress,
          manifestHash,
          timestamp: Date.now(),
        };
      } finally {
        setIsSigning(false);
      }
    },
    [signMessageAsync],
  );

  const storeSignature = useCallback(
    async (sig: AssetManifestSignatureResult, _manifestCid: string) => {
      // Signature is included in NFT metadata — no separate storage needed
      return sig;
    },
    [],
  );

  return { signManifest, storeSignature, isSigning };
}
