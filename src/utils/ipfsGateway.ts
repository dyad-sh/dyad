/**
 * IPFS gateway helpers shared by the JoyFlow engine and other clients.
 */

export const IPFS_GATEWAYS: string[] = [
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
];

/** Extract the bare IPFS CID from various URL or `ipfs://` forms. */
export function extractIpfsHash(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  // Already a bare CID
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{50,})$/.test(trimmed)) {
    return trimmed;
  }
  // ipfs://<cid>[/path]
  const ipfsMatch = trimmed.match(/^ipfs:\/\/(.+?)(?:[/?#]|$)/i);
  if (ipfsMatch) return ipfsMatch[1];
  // Any /ipfs/<cid>[/path]
  const pathMatch = trimmed.match(/\/ipfs\/([A-Za-z0-9]+)(?:[/?#]|$)/);
  if (pathMatch) return pathMatch[1];
  return null;
}
