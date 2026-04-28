/**
 * JoyFlow Orchestration Engine — public exports.
 *
 * Pipeline:
 *   1. AES-256-GCM encryption via Web Crypto API
 *   2. IPFS chunk + manifest pinning (Pinata)
 *   3. ERC-1155 license token (thirdweb)
 *   4. Trustless decryption: verify license → retrieve → decrypt
 */

export { JoyFlowEngine, type JoyFlowConfig, type JoyFlowProgress } from "./engine";
export {
  encryptAsset,
  decryptAsset,
  generateEncryptionKey,
  exportKey,
  importKey,
  sha256,
  JOYFLOW_CHUNK_SIZE,
  type EncryptedChunk,
} from "./crypto";
export {
  createManifest,
  resolveManifest,
  retrieveChunks,
  type AssetManifest,
  type EncryptionEnvelope,
} from "./manifest";
export { mintLicense, verifyLicense, type LicenseParams } from "./license";
