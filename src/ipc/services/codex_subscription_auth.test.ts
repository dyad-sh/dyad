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
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => mocks.directory }));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: { auto: { apiKey: { value: "test-pro" } } },
  }),
  writeSettings: vi.fn(),
}));
vi.mock("./codex_subscription_account", () => ({
  resetSubscriptionAccount: vi.fn(),
}));
import { writeSettings } from "@/main/settings";
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
    await connectCodexSubscription({ port: 0 });
    const login = new URL(mocks.url);
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.searchParams.get("code_challenge")).toHaveLength(43);
    const response = await fetch(
      `${login.searchParams.get("redirect_uri")}?state=wrong&code=fake`,
    );
    expect(response.status).toBe(400);
    expect(getCodexSubscriptionStatus()).toEqual({
      connected: false,
      pending: true,
      celebrationPending: false,
      error: undefined,
    });
    disconnectCodexSubscription();
    await expect(getCodexSubscriptionCredentials()).rejects.toThrow(
      "Connect your ChatGPT",
    );
  });
});

describe("successful browser return", () => {
  it("selects subscription globally, serves a credential-free deep link, and disconnect selects Pro", async () => {
    mocks.directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-oauth-success-"),
    );
    mocks.encryption = true;
    const nativeFetch = globalThis.fetch;
    const access = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
        String(url).startsWith("https://auth.openai.com/")
          ? new Response(
              JSON.stringify({
                access_token: access,
                refresh_token: "test-refresh",
                expires_in: 3600,
              }),
            )
          : nativeFetch(url, init),
      ),
    );
    try {
      await connectCodexSubscription({ port: 0 });
      const login = new URL(mocks.url);
      const callback = new URL(login.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", login.searchParams.get("state")!);
      callback.searchParams.set("code", "test-code");
      const response = await fetch(callback);
      const html = await response.text();
      expect(html).toContain('href="dyad://chatgpt-connected"');
      expect(html).toContain('window.location.href="dyad://chatgpt-connected"');
      expect(html).not.toContain(access);
      expect(html).not.toContain("test-code");
      expect(writeSettings).toHaveBeenCalledWith({
        proModelUsage: "subscription",
      });
      expect(getCodexSubscriptionStatus()).toMatchObject({
        connected: true,
        celebrationPending: true,
      });
      disconnectCodexSubscription();
      expect(writeSettings).toHaveBeenCalledWith({ proModelUsage: "pro" });
      expect(getCodexSubscriptionStatus()).toMatchObject({
        connected: false,
        celebrationPending: false,
      });
    } finally {
      disconnectCodexSubscription();
      vi.unstubAllGlobals();
      fs.rmSync(mocks.directory, { recursive: true, force: true });
    }
  });
});
