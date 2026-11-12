import { describe, it, expect, vi, beforeEach } from "vitest";

const isEncryptionAvailable = vi.fn(() => true);
const recovery = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock("@/main/safe_storage_legacy", () => ({
  recoverLegacySafeStorageSecret: recovery,
}));
const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`, "utf8"));
const decryptString = vi.fn((b: Buffer) => {
  const s = b.toString("utf8");
  if (!s.startsWith("enc:")) throw new Error("not encrypted by this mock");
  return s.slice("enc:".length);
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailable(),
    encryptString: (s: string) => encryptString(s),
    decryptString: (b: Buffer) => decryptString(b),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import {
  decryptSecretMap,
  decryptFromString,
  encryptSecretMap,
  readServerSecretMap,
} from "./secret_storage";

describe("encryptSecretMap / decryptSecretMap", () => {
  beforeEach(() => {
    isEncryptionAvailable.mockReturnValue(true);
    vi.clearAllMocks();
    recovery.mockReturnValue(null);
  });

  it("round-trips a map", () => {
    const stored = encryptSecretMap({ Authorization: "Bearer sk-1" });
    expect(decryptSecretMap(stored)).toEqual({ Authorization: "Bearer sk-1" });
  });

  it("recovers legacy maps and client secrets before reporting a failed read", () => {
    const stored = Buffer.from("v10old-ciphertext").toString("base64");
    recovery.mockReturnValueOnce('{"API_KEY":"restored"}');
    expect(decryptSecretMap(stored)).toEqual({ API_KEY: "restored" });
    recovery.mockReturnValueOnce("restored-client-secret");
    expect(decryptFromString(stored)).toBe("restored-client-secret");
  });

  it("rejects ciphertext instead of passing its bytes as a client secret", () => {
    const stored = Buffer.from("v10old-ciphertext").toString("base64");
    expect(() => decryptFromString(stored)).toThrow("Saved credentials");
    expect(decryptSecretMap(stored)).toBeNull();
    isEncryptionAvailable.mockReturnValue(false);
    expect(() => decryptFromString(stored)).toThrow("Saved credentials");
  });

  it("retains only identifiable historical untagged plaintext objects", () => {
    expect(
      decryptSecretMap(Buffer.from('{"A":"legacy"}').toString("base64")),
    ).toEqual({ A: "legacy" });
    expect(() =>
      decryptFromString(Buffer.from("ambiguous-secret").toString("base64")),
    ).toThrow();
  });

  it("supports tagged client secrets while rejecting readable-looking encrypted envelopes", () => {
    const oldPlaintext =
      "plain:" + Buffer.from("legacy-client-secret").toString("base64");
    expect(decryptFromString(oldPlaintext)).toBe("legacy-client-secret");
    for (const prefix of ["v10", "v11", "v20"]) {
      const encrypted = Buffer.from(
        `${prefix}printable-but-encrypted`,
      ).toString("base64");
      expect(() => decryptFromString(encrypted)).toThrow("Saved credentials");
    }
  });

  it("retries a failed read when the key becomes available without changing the blob", () => {
    const stored = Buffer.from("v10old-ciphertext").toString("base64");
    expect(readServerSecretMap(stored, null)).toEqual({ status: "unreadable" });
    recovery.mockReturnValue('{"A":"recovered"}');
    expect(readServerSecretMap(stored, null)).toEqual({
      status: "ok",
      value: { A: "recovered" },
    });
  });

  it("hands the whole map to safeStorage and stores only its output", () => {
    const stored = encryptSecretMap({ API_KEY: "sk-secret" })!;
    expect(encryptString).toHaveBeenCalledWith(`{"API_KEY":"sk-secret"}`);
    expect(Buffer.from(stored, "base64")).toEqual(
      encryptString.mock.results[0]!.value,
    );
  });

  it("stores NULL for empty and missing maps", () => {
    expect(encryptSecretMap(null)).toBeNull();
    expect(encryptSecretMap(undefined)).toBeNull();
    expect(encryptSecretMap({})).toBeNull();
  });

  it("round-trips through the no-keyring fallback", () => {
    isEncryptionAvailable.mockReturnValue(false);
    const stored = encryptSecretMap({ A: "1" })!;
    expect(stored.startsWith("plain:")).toBe(true);
    expect(decryptSecretMap(stored)).toEqual({ A: "1" });
  });

  it("reads a plain: blob written without a keyring after one appears", () => {
    isEncryptionAvailable.mockReturnValue(false);
    const stored = encryptSecretMap({ A: "1" })!;
    isEncryptionAvailable.mockReturnValue(true);
    expect(decryptSecretMap(stored)).toEqual({ A: "1" });
  });

  it("returns null for absent, undecryptable and non-JSON blobs", () => {
    expect(decryptSecretMap(null)).toBeNull();
    expect(decryptSecretMap("")).toBeNull();
    expect(
      decryptSecretMap(Buffer.from("garbage", "utf8").toString("base64")),
    ).toBeNull();
  });

  it("returns null for JSON that is not a string map", () => {
    const encode = (json: string) =>
      Buffer.from(`enc:${json}`, "utf8").toString("base64");
    expect(decryptSecretMap(encode(`["a"]`))).toBeNull();
    expect(decryptSecretMap(encode(`"a"`))).toBeNull();
    expect(decryptSecretMap(encode(`{"a":1}`))).toBeNull();
    expect(decryptSecretMap(encode(`null`))).toBeNull();
  });
});

describe("readServerSecretMap", () => {
  beforeEach(() => {
    isEncryptionAvailable.mockReturnValue(true);
    vi.clearAllMocks();
    recovery.mockReturnValue(null);
  });

  it("prefers the encrypted column over the plaintext one", () => {
    const stored = encryptSecretMap({ A: "current" });
    expect(readServerSecretMap(stored, { A: "stale" })).toEqual({
      status: "ok",
      value: { A: "current" },
    });
  });

  it("uses the plaintext column when nothing is encrypted yet", () => {
    expect(readServerSecretMap(null, { A: "1" })).toEqual({
      status: "ok",
      value: { A: "1" },
    });
  });

  it("falls back to plaintext when the encrypted column is unreadable", () => {
    const unreadable = Buffer.from("garbage", "utf8").toString("base64");
    expect(readServerSecretMap(unreadable, { A: "1" })).toEqual({
      status: "ok",
      value: { A: "1" },
    });
  });

  it("reports unreadable when a stored secret can't be decrypted", () => {
    const unreadable = Buffer.from("garbage", "utf8").toString("base64");
    expect(readServerSecretMap(unreadable, null)).toEqual({
      status: "unreadable",
    });
  });

  it("reports an empty ok result when no secret is stored at all", () => {
    expect(readServerSecretMap(null, null)).toEqual({
      status: "ok",
      value: null,
    });
  });
});
