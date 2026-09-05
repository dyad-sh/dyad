// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ directory: "", url: "", encryption: true }));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.directory },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryption,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
    getSelectedStorageBackend: () => "keyring",
  },
  shell: {
    openExternal: async (url: string) => {
      mocks.url = url;
    },
  },
}));
import {
  connectCodexSubscription,
  disconnectCodexSubscription,
  getCodexSubscriptionStatus,
  getCodexSubscriptionCredentials,
  validateOAuthState,
} from "./codex_subscription_auth";

describe("subscription OAuth", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-oauth-test-"),
    );
    mocks.encryption = true;
  });
  afterEach(() => {
    disconnectCodexSubscription();
    fs.rmSync(mocks.directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });
  it("requires secure storage", async () => {
    mocks.encryption = false;
    await expect(connectCodexSubscription()).rejects.toThrow(
      "Secure credential storage",
    );
  });
  it("keeps reconnect available when saved credentials cannot be decoded", () => {
    fs.writeFileSync(
      path.join(mocks.directory, "codex-subscription.enc"),
      "broken",
    );
    expect(getCodexSubscriptionStatus()).toMatchObject({
      connected: false,
      error: expect.stringContaining("reconnect"),
    });
  });
  it("rejects invalid and missing callback state", () => {
    expect(validateOAuthState("expected", null)).toBe(false);
    expect(validateOAuthState("expected", "wrong")).toBe(false);
    expect(validateOAuthState("expected", "expected")).toBe(true);
  });
  it("uses PKCE, rejects a forged callback, and exposes no credentials in status", async () => {
    await connectCodexSubscription();
    const login = new URL(mocks.url);
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.searchParams.get("code_challenge")).toHaveLength(43);
    const response = await fetch(
      "http://127.0.0.1:1455/auth/callback?state=wrong&code=fake",
    );
    expect(response.status).toBe(400);
    expect(getCodexSubscriptionStatus()).toEqual({
      connected: false,
      pending: true,
      error: undefined,
    });
    disconnectCodexSubscription();
    await expect(getCodexSubscriptionCredentials()).rejects.toThrow(
      "Connect your ChatGPT",
    );
  });
});
