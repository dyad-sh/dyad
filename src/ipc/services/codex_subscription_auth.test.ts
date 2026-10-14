// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({
  directory: "",
  url: "",
  encryption: true,
  decrypt: vi.fn(),
  account: vi.fn(),
  selectedModel: { provider: "auto", name: "auto" },
  proModelUsage: undefined as string | undefined,
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.directory },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryption,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: mocks.decrypt,
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
    providerSettings: {},
    selectedModel: mocks.selectedModel,
    proModelUsage: mocks.proModelUsage,
  }),
  writeSettings: vi.fn(),
}));
vi.mock("./codex_subscription_account", () => ({
  resetSubscriptionAccount: vi.fn(),
  getSubscriptionAccount: mocks.account,
}));
import { writeSettings } from "@/main/settings";
import {
  acknowledgeSubscriptionConnection,
  connectCodexSubscription,
  disconnectCodexSubscription,
  getCodexSubscriptionStatus,
  getCodexSubscriptionCredentials,
  validateOAuthState,
} from "./codex_subscription_auth";

describe("subscription OAuth", () => {
  beforeEach(() => {
    mocks.proModelUsage = undefined;
    mocks.directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-oauth-test-"),
    );
    mocks.encryption = true;
    mocks.decrypt.mockReset().mockImplementation((b: Buffer) => b.toString());
  });
  afterEach(() => {
    disconnectCodexSubscription();
    fs.rmSync(mocks.directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });
  it("preserves the BYO source when disconnecting an unused subscription", () => {
    mocks.proModelUsage = "api-key";
    vi.mocked(writeSettings).mockClear();
    disconnectCodexSubscription();
    expect(writeSettings).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, undefined, "plus"],
    ["test-account", "pro", "pro"],
    ["different-account", undefined, undefined],
  ] as const)(
    "refreshes tier metadata safely (%s, %s)",
    async (accountId, planType, expected) => {
      fs.writeFileSync(
        path.join(mocks.directory, "codex-subscription.enc"),
        JSON.stringify({
          access: "old-access",
          refresh: "old-refresh",
          accountId: "test-account",
          expires: 0,
          planType: "plus",
        }),
      );
      const access =
        "header." +
        Buffer.from(
          JSON.stringify({
            "https://api.openai.com/auth": {
              chatgpt_account_id: accountId,
              chatgpt_plan_type: planType,
            },
          }),
        ).toString("base64url") +
        ".signature";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            access_token: access,
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
        ),
      );
      const credentials = await getCodexSubscriptionCredentials();
      expect(credentials.planType).toBe(expected);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(mocks.directory, "codex-subscription.enc"),
            "utf8",
          ),
        ).planType,
      ).toBe(expected);
      const status = getCodexSubscriptionStatus();
      expect("planType" in status ? status.planType : undefined).toBe(expected);
    },
  );
  it("requires secure storage", async () => {
    mocks.encryption = false;
    await expect(connectCodexSubscription()).rejects.toThrow(
      "Secure credential storage",
    );
  });
  it.each(["invalid data", "decryption failure", "unavailable keyring"])(
    "preserves credential errors across status reads: %s",
    async (failure) => {
      if (failure === "decryption failure")
        mocks.decrypt.mockImplementation(() => {
          throw new Error("keychain failure");
        });
      if (failure === "unavailable keyring") mocks.encryption = false;
      fs.writeFileSync(
        path.join(mocks.directory, "codex-subscription.enc"),
        "broken",
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(getCodexSubscriptionStatus()).toMatchObject({
          connected: false,
          credentialError: true,
          error: expect.stringContaining("reconnect"),
        });
      }
      await expect(getCodexSubscriptionCredentials()).rejects.toThrow();
      disconnectCodexSubscription();
      expect(getCodexSubscriptionStatus()).toMatchObject({
        connected: false,
        error: undefined,
      });
      expect(getCodexSubscriptionStatus().credentialError).toBeUndefined();
    },
  );
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
  beforeEach(() => {
    mocks.selectedModel = { provider: "auto", name: "auto" };
    mocks.account
      .mockReset()
      .mockResolvedValue({ connected: true, models: ["supported-model"] });
  });
  it.each([
    [true, "plus", "preserve"],
    [true, "free", "empty"],
    [true, "free", "error"],
    [true, "free", "catalog-error"],
    [true, "free", "throw"],
    [false, undefined],
    [true, "free"],
    [true, "plus"],
    [true, "pro"],
    [true, undefined],
  ] as const)(
    "connects without Pro and serves a credential-free deep link (select model: %s, tier: %s)",
    async (selectModel, planType, scenario = undefined) => {
      if (scenario === "preserve") {
        mocks.selectedModel = { provider: "openai", name: "supported-model" };
        mocks.account.mockResolvedValue({
          connected: true,
          models: ["other-model", "supported-model"],
        });
      }
      if (scenario === "empty")
        mocks.account.mockResolvedValue({ connected: true, models: [] });
      if (scenario === "error")
        mocks.account.mockResolvedValue({
          connected: true,
          models: ["supported-model"],
          error: "Unavailable",
        });
      if (scenario === "catalog-error")
        mocks.account.mockResolvedValue({
          connected: true,
          models: ["fallback-model"],
          modelsError: "Catalog unavailable",
        });
      if (scenario === "throw")
        mocks.account.mockRejectedValue(new Error("Unavailable"));
      const setupFailed = ["empty", "error", "catalog-error", "throw"].includes(
        scenario ?? "",
      );
      vi.mocked(writeSettings).mockClear();
      mocks.directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "dyad-oauth-success-"),
      );
      mocks.encryption = true;
      mocks.decrypt.mockImplementation((b: Buffer) => b.toString());
      const nativeFetch = globalThis.fetch;
      const access = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
          String(url).startsWith("https://auth.openai.com/")
            ? new Response(
                JSON.stringify({
                  access_token: access,
                  id_token: `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_plan_type: planType } })).toString("base64url")}.signature`,
                  refresh_token: "test-refresh",
                  expires_in: 3600,
                }),
              )
            : nativeFetch(url, init),
        ),
      );
      try {
        fs.writeFileSync(
          path.join(mocks.directory, "codex-subscription.enc"),
          "broken",
        );
        expect(getCodexSubscriptionStatus().credentialError).toBe(true);
        await connectCodexSubscription({ port: 0, selectModel });
        const login = new URL(mocks.url);
        const callback = new URL(login.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", login.searchParams.get("state")!);
        callback.searchParams.set("code", "test-code");
        const response = await fetch(callback);
        const html = await response.text();
        expect(html).toContain('href="dyad://chatgpt-connected"');
        expect(html).toContain(
          'window.location.href="dyad://chatgpt-connected"',
        );
        expect(html).not.toContain(access);
        expect(html).not.toContain("test-code");
        expect(writeSettings).toHaveBeenCalledWith({
          proModelUsage: "subscription",
        });
        if (selectModel && !setupFailed) {
          expect(writeSettings).toHaveBeenCalledWith({
            selectedModel: { provider: "openai", name: "supported-model" },
            recentModels: [{ provider: "openai", name: "supported-model" }],
            selectedChatMode: "local-agent",
            defaultChatMode: "local-agent",
          });
        } else {
          expect(writeSettings).not.toHaveBeenCalledWith(
            expect.objectContaining({ selectedModel: expect.anything() }),
          );
        }
        expect(getCodexSubscriptionStatus()).toMatchObject({
          connected: true,
          celebrationPending: true,
        });
        const status = getCodexSubscriptionStatus();
        expect(status.error).toBeUndefined();
        if (setupFailed)
          expect(
            "setupError" in status ? status.setupError : undefined,
          ).toContain("ChatGPT is connected");
        else
          expect(
            "setupError" in status ? status.setupError : undefined,
          ).toBeUndefined();
        expect("planType" in status ? status.planType : undefined).toBe(
          planType,
        );
        expect(getCodexSubscriptionStatus().credentialError).toBeUndefined();
        acknowledgeSubscriptionConnection();
        expect(getCodexSubscriptionStatus()).toMatchObject({
          connected: true,
          celebrationPending: false,
          setupError: undefined,
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
    },
  );
});
