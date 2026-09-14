import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connected: true, credentialError: false }));
vi.mock("./codex_subscription_auth", () => ({
  getCodexSubscriptionStatus: () => ({
    connected: mocks.connected,
    credentialError: mocks.credentialError,
    pending: false,
  }),
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
import {
  getSubscriptionAccount,
  parseSubscriptionLimits,
  resetSubscriptionAccount,
} from "./codex_subscription_account";
beforeEach(() => {
  resetSubscriptionAccount();
  mocks.connected = true;
  mocks.credentialError = false;
});
afterEach(() => vi.unstubAllGlobals());
it("preserves credential-storage failures without making account requests", async () => {
  mocks.connected = false;
  mocks.credentialError = true;
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await getSubscriptionAccount()).toMatchObject({
    connected: false,
    credentialError: true,
    models: [],
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("normalizes actual 5-hour/weekly windows without inventing missing percentages", () => {
  expect(
    parseSubscriptionLimits({
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 18000,
          reset_at: 100,
        },
        secondary_window: {
          used_percent: 50,
          limit_window_seconds: 604800,
          reset_at: 200,
        },
      },
    }),
  ).toEqual({
    limitReached: false,
    windows: [
      { usedPercent: 10, windowSeconds: 18000, resetsAt: 100000 },
      { usedPercent: 50, windowSeconds: 604800, resetsAt: 200000 },
    ],
  });
  expect(() => parseSubscriptionLimits({})).toThrow();
});
it("deduplicates account lookups and never returns credentials to the renderer", async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/models?")
            ? {
                models: [
                  { slug: "gpt-eligible" },
                  { slug: "hidden", visibility: "hide" },
                ],
              }
            : { rate_limit: { allowed: false, limit_reached: true } },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const [a, b] = await Promise.all([
    getSubscriptionAccount(),
    getSubscriptionAccount(),
  ]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ models: ["gpt-eligible"], limitReached: true });
  expect(JSON.stringify(a)).not.toContain("test-access");
  await getSubscriptionAccount();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("reports unavailable instead of showing zero usage or guessing models", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network failure with secret");
    }),
  );
  const result = await getSubscriptionAccount();
  expect(result).toMatchObject({
    models: [],
    windows: [],
    limitsError: expect.stringContaining("unavailable"),
  });
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("discards an account lookup that finishes after disconnect", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ models: [{ slug: "old-model" }] }));
    }),
  );
  const pending = getSubscriptionAccount();
  resetSubscriptionAccount();
  mocks.connected = false;
  finish();
  expect(await pending).toMatchObject({ connected: false, models: [] });
});
