/**
 * AES-256-GCM encryption for web/Node mode.
 *
 * Replaces Electron's safeStorage when running outside Electron.
 * Requires SECRET_KEY env var (32 hex chars = 128-bit or 64 hex chars = 256-bit).
 *
 * Usage:
 *   const encrypted = webEncrypt("my-secret");
 *   const plain = webDecrypt(encrypted);
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.SECRET_KEY ?? "";
  if (hex.length === 64) {
    return Buffer.from(hex, "hex");
  }
  // Derive a 256-bit key from whatever string is provided using SHA-256
  return crypto.createHash("sha256").update(hex || "proteaai-default-key-change-me").digest();
}

/**
 * Encrypts `plaintext` and returns a base64 string: iv:authTag:ciphertext
 */
export function webEncrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a base64 string produced by webEncrypt().
 * Returns the original plaintext.
 */
export function webDecrypt(ciphertext: string): string {
  const key = getKey();
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
