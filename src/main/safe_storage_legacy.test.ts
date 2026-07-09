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
import os from "node:os";
import path from "node:path";
import {
  clearRecoveryCacheForTesting,
  decryptLegacyV10Ciphertext,
  deriveLegacyOsCryptKey,
  getRecoveryStatsForTesting,
  KeychainPasswordReader,
  recoverLegacySafeStorageSecret,
  SecurityCliKeychainPasswordReader,
} from "./safe_storage_legacy";

// --- Test crypto helpers: mirror Chromium's frozen os_crypt v10 scheme. ---

const AES_IV = Buffer.alloc(16, 0x20);

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

describe("recoverLegacySafeStorageSecret", () => {
  const savedKillSwitch = process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;

  beforeEach(() => {
    clearRecoveryCacheForTesting();
    delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
  });

  afterEach(() => {
    if (savedKillSwitch === undefined) {
      delete process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY;
    } else {
      process.env.DYAD_DISABLE_SAFE_STORAGE_RECOVERY = savedKillSwitch;
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
