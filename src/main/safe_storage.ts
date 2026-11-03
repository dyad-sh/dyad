import { safeStorage } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { recoverLegacySafeStorageSecret } from "./safe_storage_legacy";

/** Read encrypted bytes without ever interpreting a failed decrypt as plaintext. */
export function decryptSafeStorageBuffer(ciphertext: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(ciphertext);
    } catch {
      // The session may have selected a different historical Keychain identity.
    }
  }
  const recovered = recoverLegacySafeStorageSecret(
    ciphertext.toString("base64"),
  );
  if (recovered !== null) return recovered;
  throw new DyadError(
    "Saved credentials could not be opened. Unlock or restore your OS keyring and retry, or explicitly replace/disconnect the saved connection.",
    DyadErrorKind.Precondition,
  );
}
