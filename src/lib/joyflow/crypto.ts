/**
 * JoyFlow Crypto — AES-256-GCM encryption/decryption via Web Crypto API.
 *
 * Ported from joy-publish-bundle/src/lib/joyflow/crypto.ts. Runs in the
 * renderer (browser) where `crypto.subtle` is available.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

export async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw as ArrayBuffer);
}

export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["decrypt"],
  );
}

async function encryptChunk(
  data: Uint8Array,
  key: CryptoKey,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    data.buffer as ArrayBuffer,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext as ArrayBuffer) };
}

async function decryptChunk(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  );
  return new Uint8Array(plaintext as ArrayBuffer);
}

export interface EncryptedChunk {
  index: number;
  iv: string; // hex
  ciphertext: Uint8Array;
  hash: string; // SHA-256 of ciphertext for integrity
}

export async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash as ArrayBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function encryptAsset(
  file: Uint8Array,
  key?: CryptoKey,
): Promise<{ key: CryptoKey; chunks: EncryptedChunk[] }> {
  const encKey = key || (await generateEncryptionKey());
  const chunks: EncryptedChunk[] = [];

  for (let i = 0; i < file.length; i += CHUNK_SIZE) {
    const slice = file.slice(i, Math.min(i + CHUNK_SIZE, file.length));
    const { iv, ciphertext } = await encryptChunk(slice, encKey);
    const hash = await sha256(ciphertext);

    chunks.push({
      index: chunks.length,
      iv: Array.from(iv)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      ciphertext,
      hash,
    });
  }

  return { key: encKey, chunks };
}

export async function decryptAsset(
  chunks: { ciphertext: Uint8Array; iv: string; hash: string; index: number }[],
  key: CryptoKey,
): Promise<Uint8Array> {
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  for (const chunk of sorted) {
    const computedHash = await sha256(chunk.ciphertext);
    if (computedHash !== chunk.hash) {
      throw new Error(
        `Integrity check failed for chunk ${chunk.index}: expected ${chunk.hash}, got ${computedHash}`,
      );
    }
  }

  const decryptedChunks = await Promise.all(
    sorted.map(async (chunk) => {
      const iv = new Uint8Array(
        (chunk.iv.match(/.{2}/g) || []).map((b) => parseInt(b, 16)),
      );
      return decryptChunk(chunk.ciphertext, iv, key);
    }),
  );

  const totalLength = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decryptedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

export const JOYFLOW_CHUNK_SIZE = CHUNK_SIZE;
