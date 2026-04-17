interface ReassemblyParams {
  assetName: string;
  assetType?: string;
  fileType?: string;
  totalChunks: number;
  chunkSize: number;
  chunkCIDs: string[];
  heliaCIDs?: string[];
  chunkHashes: string[];
  merkleRoot: string;
  encrypted: boolean;
  encryptionMethod?: string;
}

interface ReassemblyResult {
  script: string;
  instructions: string[];
  requirements: string[];
  estimatedTime: string;
}

/**
 * Generates a JavaScript reassembly script + human-readable instructions
 * for downloading and reassembling IPLD-chunked assets.
 */
export async function generateReassemblyScript(
  params: ReassemblyParams,
): Promise<ReassemblyResult> {
  const {
    assetName,
    totalChunks,
    chunkCIDs,
    heliaCIDs = [],
    chunkHashes,
    merkleRoot,
    encrypted,
    encryptionMethod,
  } = params;

  const estimatedTimeSec = Math.ceil(totalChunks * 2.5);
  const estimatedTime =
    estimatedTimeSec > 60
      ? `~${Math.ceil(estimatedTimeSec / 60)} min`
      : `~${estimatedTimeSec} sec`;

  const script = `/**
 * Reassembly Script for: ${assetName}
 * Generated: ${new Date().toISOString()}
 * Chunks: ${totalChunks}
 * Encrypted: ${encrypted}
 * Merkle Root: ${merkleRoot.slice(0, 16)}...
 */

const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
];

const CHUNK_CIDS = ${JSON.stringify(chunkCIDs, null, 2)};

const HELIA_CIDS = ${JSON.stringify(heliaCIDs, null, 2)};

const CHUNK_HASHES = ${JSON.stringify(chunkHashes, null, 2)};

async function downloadChunk(cid, index) {
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(gw + cid);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch { /* try next gateway */ }
  }
  // Helia fallback
  if (HELIA_CIDS[index]) {
    for (const gw of GATEWAYS) {
      try {
        const res = await fetch(gw + HELIA_CIDS[index]);
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
      } catch { /* try next gateway */ }
    }
  }
  throw new Error('Failed to download chunk ' + index);
}

async function verifyChunk(data, index) {
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  ).map(b => b.toString(16).padStart(2, '0')).join('');
  if (CHUNK_HASHES[index] && hash !== CHUNK_HASHES[index]) {
    throw new Error('Integrity check failed for chunk ' + index);
  }
}

async function reassemble(onProgress) {
  const parts = [];
  for (let i = 0; i < CHUNK_CIDS.length; i++) {
    onProgress?.({ current: i + 1, total: CHUNK_CIDS.length });
    const data = await downloadChunk(CHUNK_CIDS[i], i);
    await verifyChunk(data, i);
    parts.push(data);
  }
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return new Blob([out], { type: 'application/octet-stream' });
}

// Usage: reassemble(p => console.log(p)).then(blob => { ... });
`;

  const instructions = [
    `Download all ${totalChunks} chunks from IPFS using the provided CIDs`,
    "Verify each chunk's SHA-256 hash against the recorded hashes",
    encrypted
      ? `Decrypt each chunk using ${encryptionMethod ?? "AES-256-GCM"} with the provided key`
      : "No decryption needed — chunks are unencrypted",
    "Concatenate chunks in order to reassemble the original file",
    `Verify final merkle root matches: ${merkleRoot.slice(0, 32)}...`,
  ];

  const requirements = [
    "Web browser with Fetch API and SubtleCrypto support",
    "Access to at least one IPFS gateway",
    ...(encrypted ? ["Decryption key (provided at purchase)"] : []),
  ];

  return { script, instructions, requirements, estimatedTime };
}
