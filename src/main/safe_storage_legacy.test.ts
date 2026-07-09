import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  clearRecoveryCacheForTesting,
  createDefaultKeychainPasswordReaderForTesting,
  decryptLegacyV10Ciphertext,
  deriveLegacyOsCryptKey,
  getRecoveryStatsForTesting,
  InProcessKeychainPasswordReader,
  isDefaultKeychainLockedForSafeStorageRecovery,
  KeychainPasswordReader,
  recoverLegacySafeStorageSecret,
  recoveryNeedsKeychainUnlock,
  retryRecoveryWithKeychainUnlock,
  SecurityCliKeychainPasswordReader,
  setInProcessKeychainBindingLoaderForTesting,
} from "./safe_storage_legacy";

// --- Test crypto helpers: mirror Chromium's frozen os_crypt v10 scheme. ---

const AES_IV = Buffer.alloc(16, 0x20);
const require = createRequire(import.meta.url);

function encryptV10(plaintext: string, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, AES_IV);
  const body = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from("v10", "ascii"), body]);
}

function encryptV10Base64(plaintext: string, key: Buffer): string {
  return encryptV10(plaintext, key).toString("base64");
}

/** Runs `callback` with `process.platform` forced to `platform`. */
async function withPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T> | T,
): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    return await callback();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

interface FakeReader extends KeychainPasswordReader {
  readonly calls: Array<{ service: string; account: string }>;
}

/**
 * In-memory reader keyed by "service::account". Records every lookup so tests
 * can assert call counts (e.g. caching, or that non-v10 input never reads).
 */
function makeFakeReader(map: Record<string, string>): FakeReader {
  const calls: Array<{ service: string; account: string }> = [];
  return {
    calls,
    readPassword(service: string, account: string): string | null {
      calls.push({ service, account });
      const key = `${service}::${account}`;
      return key in map ? map[key] : null;
    },
  };
}

function assertInProcessKeychainReaderAddonAvailable(): void {
  try {
    require("dyad-keychain-reader");
  } catch (error) {
    throw new Error(
      "Failed to load dyad-keychain-reader native addon. " +
        "Run `npm rebuild dyad-keychain-reader` before running macOS " +
        "safeStorage integration tests.\nOriginal error: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

interface NativeKeychainReaderBinding {
  readGenericPassword(
    service: string,
    account: string,
    keychainPath?: string,
    allowUI?: boolean,
  ): { status: number; password: string | null };
  isDefaultKeychainLocked(keychainPath?: string): boolean | null;
}

function loadNativeKeychainReaderBinding(): NativeKeychainReaderBinding {
  return require("dyad-keychain-reader") as NativeKeychainReaderBinding;
}

const DYAD_KEY = "dyad Safe Storage::dyad Key";
const CHROMIUM_KEY = "Chromium Safe Storage::Chromium Key";

describe("deriveLegacyOsCryptKey", () => {
  it("uses Chromium's fixed PBKDF2 parameters", () => {
    const expected = crypto.pbkdf2Sync(
      "some-password",
      "saltysalt",
      1003,
      16,
      "sha1",
    );
    expect(deriveLegacyOsCryptKey("some-password")).toEqual(expected);
  });
});

describe("decryptLegacyV10Ciphertext", () => {
  it("decrypts the golden reference vector", () => {
    const key = deriveLegacyOsCryptKey("chromium-identity-password");
    const ciphertext = Buffer.from("djEwV6t0qCg80Shaem0jPrZAWQ==", "base64");
    expect(decryptLegacyV10Ciphertext(ciphertext, key)).toBe("hello-secret");
  });

  it("round-trips a variety of plaintexts", () => {
    const key = deriveLegacyOsCryptKey("round-trip-pw");
    const vectors = [
      "",
      "a",
      "hello world",
      "16-byte-exactly!",
      "a longer secret with spaces and symbols: !@#$%^&*()",
      "unicode: héllo 🔑 世界 café",
      "line1\nline2\ttabbed\r\n",
    ];
    for (const plaintext of vectors) {
      const ciphertext = encryptV10(plaintext, key);
      expect(decryptLegacyV10Ciphertext(ciphertext, key)).toBe(plaintext);
    }
  });

  it("throws when the v10 prefix is missing", () => {
    const key = deriveLegacyOsCryptKey("pw");
    // Same length as a real ciphertext but wrong prefix.
    const bogus = Buffer.concat([
      Buffer.from("v09", "ascii"),
      Buffer.alloc(16),
    ]);
    expect(() => decryptLegacyV10Ciphertext(bogus, key)).toThrow();
  });

  it("throws on invalid PKCS#7 padding", () => {
    const key = deriveLegacyOsCryptKey("pw");
    const ciphertext = encryptV10("some secret", key);
    // Corrupt the final ciphertext byte so the padding no longer validates.
    ciphertext[ciphertext.length - 1] ^= 0xff;
    expect(() => decryptLegacyV10Ciphertext(ciphertext, key)).toThrow();
  });
});

describe("InProcessKeychainPasswordReader", () => {
  beforeEach(() => {
    clearRecoveryCacheForTesting();
  });

  afterEach(() => {
    clearRecoveryCacheForTesting();
  });

  it("returns null on non-darwin without loading the addon", async () => {
    let loadCount = 0;
    setInProcessKeychainBindingLoaderForTesting(() => {
      loadCount++;
      throw new Error("should not load");
    });

    await withPlatform("linux", () => {
      const reader = new InProcessKeychainPasswordReader();
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBeNull();
    });
    expect(loadCount).toBe(0);
  });

  it("caches hits and null misses per identity", async () => {
    const calls: Array<{
      service: string;
      account: string;
      keychainPath?: string;
      allowUI?: boolean;
    }> = [];
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword(service, account, keychainPath, allowUI) {
        calls.push({ service, account, keychainPath, allowUI });
        if (service === "dyad Safe Storage" && account === "dyad Key") {
          return { status: 0, password: "stored-password" };
        }
        return { status: -25300, password: null };
      },
      isDefaultKeychainLocked: () => false,
    }));

    await withPlatform("darwin", () => {
      const reader = new InProcessKeychainPasswordReader("/tmp/test.keychain");
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
        "stored-password",
      );
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
        "stored-password",
      );
      expect(
        reader.readPassword("Chromium Safe Storage", "Chromium Key"),
      ).toBeNull();
      expect(
        reader.readPassword("Chromium Safe Storage", "Chromium Key"),
      ).toBeNull();
    });

    expect(calls).toEqual([
      {
        service: "dyad Safe Storage",
        account: "dyad Key",
        keychainPath: "/tmp/test.keychain",
        allowUI: false,
      },
      {
        service: "Chromium Safe Storage",
        account: "Chromium Key",
        keychainPath: "/tmp/test.keychain",
        allowUI: false,
      },
    ]);
  });

  it("returns null on interaction-needed status", async () => {
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: () => ({
        status: -25308,
        password: null,
      }),
      isDefaultKeychainLocked: () => true,
    }));

    await withPlatform("darwin", () => {
      const reader = new InProcessKeychainPasswordReader();
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBeNull();
    });
  });

  it("returns null forever after addon load failure", async () => {
    let loadCount = 0;
    setInProcessKeychainBindingLoaderForTesting(() => {
      loadCount++;
      throw new Error("missing addon");
    });

    await withPlatform("darwin", () => {
      const reader = new InProcessKeychainPasswordReader();
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBeNull();
      expect(
        reader.readPassword("Chromium Safe Storage", "Chromium Key"),
      ).toBeNull();
    });
    expect(loadCount).toBe(1);
  });

  it("env var selects CLI vs in-process default reader", () => {
    const savedReader = process.env.DYAD_SAFE_STORAGE_READER;
    try {
      delete process.env.DYAD_SAFE_STORAGE_READER;
      expect(createDefaultKeychainPasswordReaderForTesting()).toBeInstanceOf(
        InProcessKeychainPasswordReader,
      );

      process.env.DYAD_SAFE_STORAGE_READER = "cli";
      expect(createDefaultKeychainPasswordReaderForTesting()).toBeInstanceOf(
        SecurityCliKeychainPasswordReader,
      );
    } finally {
      if (savedReader === undefined) {
        delete process.env.DYAD_SAFE_STORAGE_READER;
      } else {
        process.env.DYAD_SAFE_STORAGE_READER = savedReader;
      }
    }
  });

  it("recoverLegacySafeStorageSecret uses the in-process reader by default", async () => {
    const key = deriveLegacyOsCryptKey("in-process-default-pw");
    const ciphertext = encryptV10Base64("default-reader-secret", key);
    const calls: Array<{ service: string; account: string }> = [];

    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword(service, account) {
        calls.push({ service, account });
        if (service === "dyad Safe Storage" && account === "dyad Key") {
          return { status: 0, password: "in-process-default-pw" };
        }
        return { status: -25300, password: null };
      },
      isDefaultKeychainLocked: () => false,
    }));

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBe(
        "default-reader-secret",
      );
    });
    expect(calls).toEqual([
      { service: "dyad Safe Storage", account: "dyad Key" },
      { service: "Chromium Safe Storage", account: "Chromium Key" },
    ]);
  });
});

describe("Keychain unlock recovery retry", () => {
  const savedRecoveryKillSwitch =
    process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
  const savedPromptKillSwitch =
    process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT;

  beforeEach(() => {
    clearRecoveryCacheForTesting();
    delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
    delete process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT;
  });

  afterEach(() => {
    clearRecoveryCacheForTesting();
    if (savedRecoveryKillSwitch === undefined) {
      delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
    } else {
      process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY = savedRecoveryKillSwitch;
    }
    if (savedPromptKillSwitch === undefined) {
      delete process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT;
    } else {
      process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT =
        savedPromptKillSwitch;
    }
  });

  it("requires interaction-needed, a failed recovery, and a locked keychain", async () => {
    let locked = true;
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: () => ({
        status: -25308,
        password: null,
      }),
      isDefaultKeychainLocked: () => locked,
    }));

    await withPlatform("darwin", () => {
      const reader = new InProcessKeychainPasswordReader();
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBeNull();
      expect(recoveryNeedsKeychainUnlock()).toBe(false);
    });

    clearRecoveryCacheForTesting();
    locked = false;
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: () => ({
        status: -25308,
        password: null,
      }),
      isDefaultKeychainLocked: () => locked,
    }));
    const ciphertext = encryptV10Base64(
      "secret",
      deriveLegacyOsCryptKey("real-password"),
    );
    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      expect(recoveryNeedsKeychainUnlock()).toBe(false);
      locked = true;
      expect(recoveryNeedsKeychainUnlock()).toBe(true);
    });

    clearRecoveryCacheForTesting();
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: () => ({
        status: -25300,
        password: null,
      }),
      isDefaultKeychainLocked: () => true,
    }));
    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      expect(recoveryNeedsKeychainUnlock()).toBe(false);
    });

    clearRecoveryCacheForTesting();
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: () => ({
        status: -25293,
        password: null,
      }),
      isDefaultKeychainLocked: () => true,
    }));
    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      expect(recoveryNeedsKeychainUnlock()).toBe(true);
    });
  });

  it("honors the unlock-prompt kill switch", async () => {
    const ciphertext = encryptV10Base64(
      "secret",
      deriveLegacyOsCryptKey("real-password"),
    );
    const calls: boolean[] = [];
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: (_service, _account, _keychainPath, allowUI) => {
        calls.push(allowUI ?? false);
        return { status: -25308, password: null };
      },
      isDefaultKeychainLocked: () => true,
    }));

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      process.env.DYAD_DISABLE_SAFE_STORAGE_UNLOCK_PROMPT = "1";
      expect(recoveryNeedsKeychainUnlock()).toBe(false);
      expect(retryRecoveryWithKeychainUnlock()).toBe(false);
    });
    expect(calls).toEqual([false, false]);
  });

  it("tries allow-UI reads at most once even when the user cancels", async () => {
    const ciphertext = encryptV10Base64(
      "secret",
      deriveLegacyOsCryptKey("real-password"),
    );
    const calls: boolean[] = [];
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: (_service, _account, _keychainPath, allowUI) => {
        calls.push(allowUI ?? false);
        return { status: allowUI ? -25293 : -25308, password: null };
      },
      isDefaultKeychainLocked: () => true,
    }));

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      expect(retryRecoveryWithKeychainUnlock()).toBe(false);
      expect(retryRecoveryWithKeychainUnlock()).toBe(false);
    });
    expect(calls).toEqual([false, false, true, true]);
  });

  it("clears failed ciphertext cache and reuses the allow-UI reader after unlock", async () => {
    const ciphertext = encryptV10Base64(
      "unlocked-secret",
      deriveLegacyOsCryptKey("unlocked-password"),
    );
    const calls: Array<{
      service: string;
      account: string;
      allowUI: boolean;
    }> = [];
    setInProcessKeychainBindingLoaderForTesting(() => ({
      readGenericPassword: (service, account, _keychainPath, allowUI) => {
        calls.push({ service, account, allowUI: allowUI ?? false });
        if (
          allowUI &&
          service === "dyad Safe Storage" &&
          account === "dyad Key"
        ) {
          return { status: 0, password: "unlocked-password" };
        }
        return { status: allowUI ? -25300 : -25308, password: null };
      },
      isDefaultKeychainLocked: () => true,
    }));

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBeNull();
      expect(recoveryNeedsKeychainUnlock()).toBe(true);
      expect(retryRecoveryWithKeychainUnlock()).toBe(true);
      expect(recoverLegacySafeStorageSecret(ciphertext)).toBe(
        "unlocked-secret",
      );
      expect(retryRecoveryWithKeychainUnlock()).toBe(false);
    });
    expect(calls).toEqual([
      {
        service: "dyad Safe Storage",
        account: "dyad Key",
        allowUI: false,
      },
      {
        service: "Chromium Safe Storage",
        account: "Chromium Key",
        allowUI: false,
      },
      {
        service: "dyad Safe Storage",
        account: "dyad Key",
        allowUI: true,
      },
      {
        service: "Chromium Safe Storage",
        account: "Chromium Key",
        allowUI: true,
      },
    ]);
  });
});

describe("recoverLegacySafeStorageSecret", () => {
  const savedKillSwitch = process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
  const savedReader = process.env.DYAD_SAFE_STORAGE_READER;

  beforeEach(() => {
    clearRecoveryCacheForTesting();
    delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
    delete process.env.DYAD_SAFE_STORAGE_READER;
  });

  afterEach(() => {
    if (savedKillSwitch === undefined) {
      delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
    } else {
      process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY = savedKillSwitch;
    }
    if (savedReader === undefined) {
      delete process.env.DYAD_SAFE_STORAGE_READER;
    } else {
      process.env.DYAD_SAFE_STORAGE_READER = savedReader;
    }
  });

  it("recovers via the dyad identity", async () => {
    const key = deriveLegacyOsCryptKey("dyad-keychain-pw");
    const ciphertext = encryptV10Base64("dyad-real-secret", key);
    const reader = makeFakeReader({ [DYAD_KEY]: "dyad-keychain-pw" });

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "dyad-real-secret",
      );
    });
    // Both identities are consulted before returning so a later plausible
    // decrypt cannot be skipped.
    expect(reader.calls).toEqual([
      { service: "dyad Safe Storage", account: "dyad Key" },
      { service: "Chromium Safe Storage", account: "Chromium Key" },
    ]);
    expect(getRecoveryStatsForTesting()).toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
    });
  });

  it("recovers via the chromium identity when the dyad identity misses", async () => {
    const key = deriveLegacyOsCryptKey("chromium-keychain-pw");
    const ciphertext = encryptV10Base64("chromium-real-secret", key);
    const reader = makeFakeReader({ [CHROMIUM_KEY]: "chromium-keychain-pw" });

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "chromium-real-secret",
      );
    });
    expect(reader.calls).toEqual([
      { service: "dyad Safe Storage", account: "dyad Key" },
      { service: "Chromium Safe Storage", account: "Chromium Key" },
    ]);
  });

  it("returns null when both identities miss", async () => {
    const key = deriveLegacyOsCryptKey("real-pw");
    const ciphertext = encryptV10Base64("secret", key);
    const reader = makeFakeReader({}); // no passwords available

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
    });
    expect(reader.calls).toHaveLength(2);
    expect(getRecoveryStatsForTesting()).toEqual({
      attempted: 1,
      recovered: 0,
      failed: 1,
    });
  });

  it("rejects a wrong-key decrypt that unpads to invalid UTF-8 and tries the next identity", async () => {
    const correctKey = deriveLegacyOsCryptKey("correct-chromium-pw");
    const ciphertext = encryptV10Base64("the real secret", correctKey);

    // Find a password whose key decrypts THIS ciphertext with valid PKCS#7
    // padding but produces bytes that are not plausible plaintext (invalid
    // UTF-8 and/or control characters). This exercises the false-positive
    // guard: without the UTF-8 check, recovery would wrongly return garbage.
    const falsePositivePw = findFalsePositivePassword(ciphertext);
    expect(falsePositivePw).not.toBeNull();

    const reader = makeFakeReader({
      [DYAD_KEY]: falsePositivePw!,
      [CHROMIUM_KEY]: "correct-chromium-pw",
    });

    await withPlatform("darwin", () => {
      // The dyad identity "decrypts" to garbage and is rejected; the chromium
      // identity yields the real plaintext.
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "the real secret",
      );
    });
    expect(reader.calls).toHaveLength(2);
  });

  it("preserves ciphertext when multiple identities decrypt plausibly", async () => {
    const key = deriveLegacyOsCryptKey("shared-keychain-pw");
    const ciphertext = encryptV10Base64("ambiguous-secret", key);
    const reader = makeFakeReader({
      [DYAD_KEY]: "shared-keychain-pw",
      [CHROMIUM_KEY]: "shared-keychain-pw",
    });

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
    });
    expect(reader.calls).toEqual([
      { service: "dyad Safe Storage", account: "dyad Key" },
      { service: "Chromium Safe Storage", account: "Chromium Key" },
    ]);
    expect(getRecoveryStatsForTesting()).toEqual({
      attempted: 1,
      recovered: 0,
      failed: 1,
    });
  });

  it("returns null under the kill switch and never reads the keychain", async () => {
    process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY = "1";
    const key = deriveLegacyOsCryptKey("pw");
    const ciphertext = encryptV10Base64("secret", key);
    const reader = makeFakeReader({ [DYAD_KEY]: "pw" });

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
    });
    expect(reader.calls).toHaveLength(0);
  });

  it("returns null for non-v10 ciphertext without reading the keychain", async () => {
    const reader = makeFakeReader({ [DYAD_KEY]: "pw" });
    const notV10 = Buffer.from("not-a-v10-ciphertext-at-all").toString(
      "base64",
    );

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(notV10, reader)).toBeNull();
    });
    expect(reader.calls).toHaveLength(0);
  });

  it("returns null on non-darwin platforms", async () => {
    const key = deriveLegacyOsCryptKey("pw");
    const ciphertext = encryptV10Base64("secret", key);
    const reader = makeFakeReader({ [DYAD_KEY]: "pw" });

    await withPlatform("linux", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
    });
    expect(reader.calls).toHaveLength(0);
  });

  it("caches results so the keychain is read once per ciphertext", async () => {
    const key = deriveLegacyOsCryptKey("dyad-keychain-pw");
    const ciphertext = encryptV10Base64("cached-secret", key);
    const reader = makeFakeReader({ [DYAD_KEY]: "dyad-keychain-pw" });

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "cached-secret",
      );
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "cached-secret",
      );
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "cached-secret",
      );
    });
    // Two reads total (one per identity), despite three recovery calls.
    expect(reader.calls).toHaveLength(2);
    expect(getRecoveryStatsForTesting()).toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
    });
  });

  it("caches null failures so a missing keychain is read once", async () => {
    const key = deriveLegacyOsCryptKey("pw");
    const ciphertext = encryptV10Base64("secret", key);
    const reader = makeFakeReader({});

    await withPlatform("darwin", () => {
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBeNull();
    });
    // Two identities on the first call, zero on the cached second call.
    expect(reader.calls).toHaveLength(2);
  });
});

/**
 * Searches for a password whose derived key decrypts `ciphertextBase64` with
 * valid PKCS#7 padding but yields bytes that fail the plausible-plaintext test
 * (invalid UTF-8 or control characters). Returns null if none found in range.
 */
function findFalsePositivePassword(ciphertextBase64: string): string | null {
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  const body = ciphertext.subarray(3); // strip "v10"
  for (let i = 0; i < 200_000; i++) {
    const key = deriveLegacyOsCryptKey(`false-positive-candidate-${i}`);
    let decrypted: Buffer;
    try {
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, AES_IV);
      decrypted = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      continue; // padding rejected under this key
    }
    if (!isPlausiblePlaintext(decrypted)) {
      return `false-positive-candidate-${i}`;
    }
  }
  return null;
}

// Mirror of the module's internal guard, used only to locate a false-positive
// password in the test above.
function isPlausiblePlaintext(bytes: Buffer): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== "darwin")(
  "SecurityCliKeychainPasswordReader (darwin integration)",
  () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-safe-storage-legacy-"),
    );
    const keychainPath = path.join(tmpDir, "dyad-recovery-test.keychain");
    const keychainPassword = "testpass";
    const storedPassword = "integration-test-password";

    beforeAll(() => {
      execFileSync("security", [
        "create-keychain",
        "-p",
        keychainPassword,
        keychainPath,
      ]);
      execFileSync("security", [
        "unlock-keychain",
        "-p",
        keychainPassword,
        keychainPath,
      ]);
      execFileSync("security", [
        "add-generic-password",
        "-A",
        "-s",
        "dyad Safe Storage",
        "-a",
        "dyad Key",
        "-w",
        storedPassword,
        keychainPath,
      ]);
    });

    afterAll(() => {
      try {
        execFileSync("security", ["delete-keychain", keychainPath]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    beforeEach(() => {
      clearRecoveryCacheForTesting();
    });

    it("reads a stored password from the temp keychain", () => {
      const reader = new SecurityCliKeychainPasswordReader(keychainPath);
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
        storedPassword,
      );
    });

    it("returns null for a missing item", () => {
      const reader = new SecurityCliKeychainPasswordReader(keychainPath);
      expect(
        reader.readPassword("Nonexistent Safe Storage", "nobody"),
      ).toBeNull();
    });

    it("recovers an end-to-end encrypted secret from the temp keychain", () => {
      const key = deriveLegacyOsCryptKey(storedPassword);
      const ciphertext = encryptV10Base64("integration-secret", key);
      const reader = new SecurityCliKeychainPasswordReader(keychainPath);
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "integration-secret",
      );
    });

    it("caches per-identity lookups so several locked secrets shell out once per identity", () => {
      const reader = new SecurityCliKeychainPasswordReader(keychainPath);
      // Prime both a hit and a miss, then delete the keychain item out from
      // under the reader: cached answers must keep being served without any
      // further CLI calls (a re-read of the now-missing item would return
      // null, and a prompt-per-secret would stall startup on real machines).
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
        storedPassword,
      );
      expect(reader.readPassword("Missing Safe Storage", "nobody")).toBeNull();
      execFileSync("security", [
        "delete-generic-password",
        "-s",
        "dyad Safe Storage",
        keychainPath,
      ]);
      try {
        expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
          storedPassword,
        );
        expect(
          reader.readPassword("Missing Safe Storage", "nobody"),
        ).toBeNull();
        // A fresh reader (no cache) sees the deletion, proving the values
        // above came from the cache.
        expect(
          new SecurityCliKeychainPasswordReader(keychainPath).readPassword(
            "dyad Safe Storage",
            "dyad Key",
          ),
        ).toBeNull();
      } finally {
        // Restore the item for any tests that run after this one.
        execFileSync("security", [
          "add-generic-password",
          "-A",
          "-s",
          "dyad Safe Storage",
          "-a",
          "dyad Key",
          "-w",
          storedPassword,
          keychainPath,
        ]);
      }
    });
  },
);

describe.skipIf(process.platform !== "darwin")(
  "InProcessKeychainPasswordReader (darwin integration)",
  () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-safe-storage-in-process-"),
    );
    const keychainPath = path.join(tmpDir, "dyad-recovery-test.keychain");
    const keychainPassword = "testpass";
    const storedPassword = "integration-test-password";
    const promptService = "dyad Prompt Test Safe Storage";

    beforeAll(() => {
      assertInProcessKeychainReaderAddonAvailable();

      execFileSync("security", [
        "create-keychain",
        "-p",
        keychainPassword,
        keychainPath,
      ]);
      execFileSync("security", [
        "unlock-keychain",
        "-p",
        keychainPassword,
        keychainPath,
      ]);
      execFileSync("security", [
        "add-generic-password",
        "-A",
        "-s",
        "dyad Safe Storage",
        "-a",
        "dyad Key",
        "-w",
        storedPassword,
        keychainPath,
      ]);
      execFileSync("security", [
        "add-generic-password",
        "-s",
        promptService,
        "-a",
        "dyad Key",
        "-w",
        "prompt-required-password",
        keychainPath,
      ]);
    });

    afterAll(() => {
      try {
        execFileSync("security", ["delete-keychain", keychainPath]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    beforeEach(() => {
      clearRecoveryCacheForTesting();
    });

    it("reads a stored password from the temp keychain", () => {
      const reader = new InProcessKeychainPasswordReader(keychainPath);
      expect(reader.readPassword("dyad Safe Storage", "dyad Key")).toBe(
        storedPassword,
      );
    });

    it("returns null for a missing item", () => {
      const reader = new InProcessKeychainPasswordReader(keychainPath);
      expect(
        reader.readPassword("Nonexistent Safe Storage", "nobody"),
      ).toBeNull();
    });

    it("recovers an end-to-end encrypted secret from the temp keychain", () => {
      const key = deriveLegacyOsCryptKey(storedPassword);
      const ciphertext = encryptV10Base64("integration-secret", key);
      const reader = new InProcessKeychainPasswordReader(keychainPath);
      expect(recoverLegacySafeStorageSecret(ciphertext, reader)).toBe(
        "integration-secret",
      );
    });

    it("returns null promptly instead of prompting when Keychain UI would be required", () => {
      const reader = new InProcessKeychainPasswordReader(keychainPath);
      const startedAt = Date.now();

      expect(reader.readPassword(promptService, "dyad Key")).toBeNull();

      expect(Date.now() - startedAt).toBeLessThan(2_000);
    });

    it("reports a locked keychain and surfaces a blocked status for silent reads", () => {
      const binding = loadNativeKeychainReaderBinding();

      execFileSync("security", ["lock-keychain", keychainPath]);
      try {
        expect(
          isDefaultKeychainLockedForSafeStorageRecovery(keychainPath),
        ).toBe(true);
        const lockedRead = binding.readGenericPassword(
          "dyad Safe Storage",
          "dyad Key",
          keychainPath,
          false,
        );
        // macOS may report errSecInteractionNotAllowed or errSecAuthFailed
        // for a locked explicit test keychain with UI suppressed; both are
        // no-UI null outcomes and the lock-state check distinguishes this
        // from an unlocked ACL mismatch.
        expect([-25308, -25293]).toContain(lockedRead.status);
        expect(lockedRead.password).toBeNull();
      } finally {
        execFileSync("security", [
          "unlock-keychain",
          "-p",
          keychainPassword,
          keychainPath,
        ]);
      }

      expect(isDefaultKeychainLockedForSafeStorageRecovery(keychainPath)).toBe(
        false,
      );
      expect(
        binding.readGenericPassword(
          "dyad Safe Storage",
          "dyad Key",
          keychainPath,
          false,
        ),
      ).toEqual({
        status: 0,
        password: storedPassword,
      });
    });
  },
);
