import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import log from "electron-log";

const logger = log.scope("safe_storage_recovery");
const require = createRequire(import.meta.url);

/**
 * Recovery for Bug #3837: on macOS, Electron `safeStorage` ciphertext can
 * become undecryptable when the Keychain identity flips between the
 * "Chromium Safe Storage" item (used by a pre-`ready` race in Electron 40) and
 * the "dyad Safe Storage" item (used post-`ready` / Electron 43). The
 * decryption key never leaves the user's Keychain — `safeStorage` just derives
 * it from the wrong Keychain item. This module re-implements Chromium's frozen,
 * deterministic macOS `os_crypt` scheme so we can read the correct Keychain
 * password ourselves, derive the key, and decrypt the "v10" ciphertext.
 *
 * Chromium macOS os_crypt scheme (verified byte-for-byte against Electron
 * 40/43 output):
 *   - Keychain generic password: service "<product> Safe Storage",
 *     account "<product> Key" -> the password string.
 *   - key = PBKDF2-HMAC-SHA1(password, salt "saltysalt", 1003 iters, 16 bytes)
 *   - ciphertext = "v10" + AES-128-CBC(key, IV = 16 * 0x20, PKCS#7) of UTF-8
 *     plaintext.
 *
 * Everything here is callable pre-`ready`; `electron-log` is the only
 * non-node dependency.
 */

const V10_PREFIX = "v10";
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEY_LENGTH = 16;
const SECURITY_CLI_TIMEOUT_MS = 30_000;
const ERR_SEC_SUCCESS = 0;
const ERR_SEC_INTERACTION_NOT_ALLOWED = -25308;
const ERR_SEC_AUTH_FAILED = -25293;
// Chromium uses a fixed IV of 16 space (0x20) bytes for its os_crypt v10 scheme.
const AES_IV = Buffer.alloc(16, 0x20);

interface LegacyIdentity {
  service: string;
  account: string;
}

// Ordered by likelihood on a current install: the post-`ready` "dyad" identity
// first, then the legacy "Chromium" identity from the pre-`ready` race.
const LEGACY_IDENTITIES: LegacyIdentity[] = [
  { service: "dyad Safe Storage", account: "dyad Key" },
  { service: "Chromium Safe Storage", account: "Chromium Key" },
];

/**
 * Derives the AES-128 key from a Keychain password using Chromium's fixed
 * PBKDF2 parameters. Pure; no side effects.
 */
export function deriveLegacyOsCryptKey(keychainPassword: string): Buffer {
  return crypto.pbkdf2Sync(
    keychainPassword,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    "sha1",
  );
}

/**
 * Decrypts a Chromium "v10" ciphertext buffer to raw plaintext bytes.
 * Throws if the "v10" prefix is missing or PKCS#7 padding is invalid.
 */
function decryptLegacyV10ToBuffer(ciphertext: Buffer, key: Buffer): Buffer {
  const prefix = ciphertext.subarray(0, V10_PREFIX.length).toString("ascii");
  if (prefix !== V10_PREFIX) {
    throw new Error(`Missing "${V10_PREFIX}" prefix on legacy ciphertext`);
  }
  const body = ciphertext.subarray(V10_PREFIX.length);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, AES_IV);
  // `final()` throws on invalid PKCS#7 padding, which is our (weak) integrity
  // signal — see `recoverLegacySafeStorageSecret` for the UTF-8 backstop.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Decrypts a Chromium "v10" ciphertext buffer to a UTF-8 string.
 * Throws if the "v10" prefix is missing or PKCS#7 padding is invalid.
 */
export function decryptLegacyV10Ciphertext(
  ciphertext: Buffer,
  key: Buffer,
): string {
  return decryptLegacyV10ToBuffer(ciphertext, key).toString("utf8");
}

export interface KeychainPasswordReader {
  readPassword(service: string, account: string): string | null;
}

interface KeychainReadResult {
  status: number;
  password: string | null;
}

interface KeychainReaderBinding {
  readGenericPassword(
    service: string,
    account: string,
    keychainPath?: string,
    allowUI?: boolean,
  ): KeychainReadResult;
  isDefaultKeychainLocked(keychainPath?: string): boolean | null;
}

type KeychainReaderBindingLoader = () => KeychainReaderBinding;

let inProcessBinding: KeychainReaderBinding | null | undefined;
let inProcessBindingLoadFailureLogged = false;
let inProcessBindingLoader: KeychainReaderBindingLoader = () =>
  require("dyad-keychain-reader") as KeychainReaderBinding;
let interactionNeededIdentities = new Set<string>();
let unlockPromptAttempted = false;

function loadInProcessKeychainReaderBinding(): KeychainReaderBinding | null {
  if (inProcessBinding !== undefined) {
    return inProcessBinding;
  }
  try {
    inProcessBinding = inProcessBindingLoader();
    return inProcessBinding;
  } catch (error) {
    inProcessBinding = null;
    if (!inProcessBindingLoadFailureLogged) {
      inProcessBindingLoadFailureLogged = true;
      logger.debug("Failed to load in-process Keychain reader addon", error);
    }
    return null;
  }
}

function createDefaultKeychainPasswordReader(): KeychainPasswordReader {
  return process.env.DYAD_SAFE_STORAGE_READER === "cli"
    ? new SecurityCliKeychainPasswordReader()
    : new InProcessKeychainPasswordReader();
}

function keychainIdentityCacheKey(service: string, account: string): string {
  return `${service}\u0000${account}`;
}

function normalizeReadResult(result: unknown): KeychainReadResult {
  if (
    typeof result === "object" &&
    result !== null &&
    typeof (result as KeychainReadResult).status === "number"
  ) {
    const password = (result as KeychainReadResult).password;
    return {
      status: (result as KeychainReadResult).status,
      password: typeof password === "string" ? password : null,
    };
  }
  return { status: -1, password: null };
}

/**
 * Reads a Keychain generic-password item via the `security` CLI.
 *
 * v1 trade-off: shelling out to `security` can trigger a macOS Keychain
 * permission prompt for items created by the app, because the `security` tool
 * is a differently-signed program than Dyad. This interface exists so a future
 * in-process implementation (SecItemCopyMatching, silent for same-signed apps)
 * can replace this reader without touching the recovery logic.
 */
export class SecurityCliKeychainPasswordReader implements KeychainPasswordReader {
  // Optional explicit keychain file. Tests pass a throwaway keychain path so
  // they never touch the user's default keychain search list; production omits
  // it and lets `security` use the default search list.
  private readonly keychainPath?: string;

  // Per-identity cache, including null outcomes. Recovery calls the reader once
  // per identity PER CIPHERTEXT; without this, a profile with several locked
  // secrets would shell out (and possibly show a Keychain permission prompt, or
  // stall startup for the CLI timeout) once per secret instead of once per
  // identity. The Keychain won't change mid-session, so caching is safe.
  private readonly passwordCache = new Map<string, string | null>();

  constructor(keychainPath?: string) {
    this.keychainPath = keychainPath;
  }

  readPassword(service: string, account: string): string | null {
    if (process.platform !== "darwin") {
      return null;
    }
    const cacheKey = keychainIdentityCacheKey(service, account);
    const cached = this.passwordCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const password = this.readPasswordUncached(service, account);
    this.passwordCache.set(cacheKey, password);
    return password;
  }

  private readPasswordUncached(
    service: string,
    account: string,
  ): string | null {
    try {
      const args = [
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ];
      if (this.keychainPath) {
        args.push(this.keychainPath);
      }
      const output = execFileSync("security", args, {
        timeout: SECURITY_CLI_TIMEOUT_MS,
        encoding: "utf8",
      });
      // The CLI appends a trailing newline to the `-w` output.
      return output.replace(/\r?\n$/, "");
    } catch {
      // Nonzero exit (item not found), timeout, spawn failure, etc. Never throw.
      return null;
    }
  }
}

/**
 * Reads a Keychain generic-password item in-process via SecItemCopyMatching.
 *
 * The native addon suppresses Keychain UI for the query; if macOS would need
 * user interaction (for example, an item created by another app), the read
 * returns null and recovery preserves the original ciphertext. Dev/adhoc builds
 * may not be trusted by Keychain items created by a signed release build, which
 * is expected to return null rather than prompting.
 */
export class InProcessKeychainPasswordReader implements KeychainPasswordReader {
  private readonly keychainPath?: string;
  private readonly allowUI: boolean;
  private readonly passwordCache = new Map<string, string | null>();

  constructor(keychainPath?: string, options: { allowUI?: boolean } = {}) {
    this.keychainPath = keychainPath;
    this.allowUI = options.allowUI ?? false;
  }

  readPassword(service: string, account: string): string | null {
    if (process.platform !== "darwin") {
      return null;
    }
    const cacheKey = keychainIdentityCacheKey(service, account);
    const cached = this.passwordCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.readPasswordUncached(service, account);
    const password =
      result.status === ERR_SEC_SUCCESS && result.password !== null
        ? result.password
        : null;
    if (
      !this.allowUI &&
      (result.status === ERR_SEC_INTERACTION_NOT_ALLOWED ||
        result.status === ERR_SEC_AUTH_FAILED)
    ) {
      interactionNeededIdentities.add(cacheKey);
    }
    this.passwordCache.set(cacheKey, password);
    return password;
  }

  private readPasswordUncached(
    service: string,
    account: string,
  ): KeychainReadResult {
    const binding = loadInProcessKeychainReaderBinding();
    if (binding === null) {
      return { status: -1, password: null };
    }
    try {
      return normalizeReadResult(
        binding.readGenericPassword(
          service,
          account,
          this.keychainPath,
          this.allowUI,
        ),
      );
    } catch (error) {
      logger.debug("In-process Keychain reader failed", error);
      return { status: -1, password: null };
    }
  }
}

// C0 control chars and DEL, excluding \t (0x09), \n (0x0A), \r (0x0D).
const CONTROL_CHAR_REGEX = /[\u0000-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * A decrypted result is only trusted if it is valid UTF-8 with no control
 * characters other than tab/newline/carriage-return. AES-CBC has no MAC, so a
 * wrong key occasionally unpads cleanly to garbage; this heuristic rejects
 * those false positives before we hand a bogus "secret" back to the caller.
 */
function isPlausiblePlaintext(bytes: Buffer): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (CONTROL_CHAR_REGEX.test(text)) {
    return null;
  }
  return text;
}

interface RecoveryStats {
  attempted: number;
  recovered: number;
  failed: number;
}

const stats: RecoveryStats = { attempted: 0, recovered: 0, failed: 0 };

// Cache keyed by the ciphertext base64 string. Caches both successes and
// failures: the Keychain will not change mid-session, so re-attempting the same
// ciphertext (which may prompt the user via `security`) is pure overhead.
const recoveryCache = new Map<string, string | null>();

let defaultReader: KeychainPasswordReader | undefined;

function clearRecoveryFailureCache(): void {
  for (const [ciphertextBase64, recovery] of recoveryCache) {
    if (recovery === null) {
      recoveryCache.delete(ciphertextBase64);
    }
  }
}

export function getRecoveryStats(): RecoveryStats {
  return { ...stats };
}

export function isDefaultKeychainLockedForSafeStorageRecovery(
  keychainPath?: string,
): boolean | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const binding = loadInProcessKeychainReaderBinding();
  if (binding === null) {
    return null;
  }
  try {
    const locked = binding.isDefaultKeychainLocked(keychainPath);
    return typeof locked === "boolean" ? locked : null;
  } catch (error) {
    logger.debug("Failed to check default Keychain lock state", error);
    return null;
  }
}

export function recoveryNeedsKeychainUnlock(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  if (process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY === "1") {
    return false;
  }
  if (process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT === "1") {
    return false;
  }
  if (interactionNeededIdentities.size === 0 || stats.failed === 0) {
    return false;
  }
  return isDefaultKeychainLockedForSafeStorageRecovery() === true;
}

export function retryRecoveryWithKeychainUnlock(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  if (process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY === "1") {
    return false;
  }
  if (process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT === "1") {
    return false;
  }
  if (unlockPromptAttempted) {
    return false;
  }
  if (!recoveryNeedsKeychainUnlock()) {
    return false;
  }
  unlockPromptAttempted = true;

  const retryReader = new InProcessKeychainPasswordReader(undefined, {
    allowUI: true,
  });
  let obtainedPassword = false;
  for (const identity of LEGACY_IDENTITIES) {
    if (retryReader.readPassword(identity.service, identity.account) !== null) {
      obtainedPassword = true;
    }
  }
  if (!obtainedPassword) {
    return false;
  }

  clearRecoveryFailureCache();
  interactionNeededIdentities = new Set();
  defaultReader = retryReader;
  return true;
}

/**
 * Attempts to recover a plaintext secret from a legacy `safeStorage` "v10"
 * ciphertext by reading the correct Keychain password directly.
 *
 * Returns null (without reading the Keychain) when recovery is not applicable:
 * non-darwin, the `DYAD_DISABLE_SAFE_STORAGE_RECOVERY=1` kill switch, or a
 * ciphertext lacking the "v10" prefix.
 */
export function recoverLegacySafeStorageSecret(
  ciphertextBase64: string,
  reader?: KeychainPasswordReader,
): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  if (process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY === "1") {
    return null;
  }

  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  if (
    ciphertext.subarray(0, V10_PREFIX.length).toString("ascii") !== V10_PREFIX
  ) {
    // Not a legacy os_crypt ciphertext; the reader is never invoked.
    return null;
  }

  if (recoveryCache.has(ciphertextBase64)) {
    return recoveryCache.get(ciphertextBase64) ?? null;
  }

  const activeReader =
    reader ?? (defaultReader ??= createDefaultKeychainPasswordReader());

  stats.attempted++;

  const plausibleRecoveries: Array<{
    identity: LegacyIdentity;
    plaintext: string;
  }> = [];

  for (const identity of LEGACY_IDENTITIES) {
    const password = activeReader.readPassword(
      identity.service,
      identity.account,
    );
    if (password === null) {
      continue;
    }
    const key = deriveLegacyOsCryptKey(password);
    let decrypted: Buffer;
    try {
      decrypted = decryptLegacyV10ToBuffer(ciphertext, key);
    } catch {
      // Bad padding under this key -> wrong identity; try the next one.
      continue;
    }
    const plaintext = isPlausiblePlaintext(decrypted);
    if (plaintext !== null) {
      plausibleRecoveries.push({ identity, plaintext });
    }
  }

  if (plausibleRecoveries.length === 1) {
    const [{ identity, plaintext }] = plausibleRecoveries;
    stats.recovered++;
    recoveryCache.set(ciphertextBase64, plaintext);
    logger.info(
      `Recovered legacy safeStorage secret using identity "${identity.service}"`,
    );
    return plaintext;
  }

  stats.failed++;
  recoveryCache.set(ciphertextBase64, null);
  if (plausibleRecoveries.length > 1) {
    logger.warn(
      "Ambiguous legacy safeStorage recovery: multiple Keychain identities " +
        "produced plausible plaintext. Preserving ciphertext instead.",
    );
    return null;
  }
  logger.info("Failed to recover legacy safeStorage secret for ciphertext");
  return null;
}

/** Test-only: clears the per-process cache and resets recovery counters. */
export function clearRecoveryCacheForTesting(): void {
  recoveryCache.clear();
  stats.attempted = 0;
  stats.recovered = 0;
  stats.failed = 0;
  defaultReader = undefined;
  interactionNeededIdentities = new Set();
  unlockPromptAttempted = false;
  inProcessBinding = undefined;
  inProcessBindingLoadFailureLogged = false;
  inProcessBindingLoader = () =>
    require("dyad-keychain-reader") as KeychainReaderBinding;
}

/** Test-only: snapshot of the recovery counters. */
export function getRecoveryStatsForTesting(): RecoveryStats {
  return getRecoveryStats();
}

/** Test-only: injects a fake native binding loader. */
export function setInProcessKeychainBindingLoaderForTesting(
  loader: KeychainReaderBindingLoader,
): void {
  inProcessBinding = undefined;
  inProcessBindingLoadFailureLogged = false;
  inProcessBindingLoader = loader;
}

/** Test-only: constructs the env-selected default reader without caching it. */
export function createDefaultKeychainPasswordReaderForTesting(): KeychainPasswordReader {
  return createDefaultKeychainPasswordReader();
}
