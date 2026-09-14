// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({
  directory: "",
  key: "test-dyad-key",
  warn: vi.fn(),
}));
vi.mock("./codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: vi.fn(async () => {}),
}));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => mocks.directory }));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: { auto: { apiKey: { value: mocks.key } } },
  }),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: mocks.warn }) },
}));
import {
  startSubscriptionUsage,
  finishSubscriptionUsage,
  interruptSubscriptionUsage,
  normalizeSubscriptionUsage,
} from "./codex_subscription_usage";
const usage = {
  inputTokens: { total: 100, noCache: 70, cacheRead: 20, cacheWrite: 10 },
  outputTokens: { total: 50, text: 30, reasoning: 20 },
};
describe("single-attempt subscription usage", () => {
  beforeEach(() => {
    mocks.key = "test-dyad-key";
    mocks.warn.mockClear();
    mocks.directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-usage-test-"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ chargedUsd: 0.000003 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });
  it("normalizes tokens without double-counting cached input or reasoning", () => {
    expect(normalizeSubscriptionUsage(usage)).toEqual({
      input: 70,
      cacheRead: 20,
      cacheWrite: 10,
      output: 50,
    });
    expect(() =>
      normalizeSubscriptionUsage({
        ...usage,
        inputTokens: { ...usage.inputTokens, total: 1 },
      }),
    ).toThrow();
  });
  it("sends the six fields once, without an idempotency header or local persistence", async () => {
    const id = await startSubscriptionUsage("gpt-5.6-luna");
    await Promise.all([
      finishSubscriptionUsage(id, "gpt-5.6-luna", usage),
      finishSubscriptionUsage(id, "gpt-5.6-luna", usage),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(options?.body))).toMatchObject({
      id,
      modelId: "gpt-5.6-luna",
      modelProvider: "openai",
      totalTokens: 150,
      cachedInputTokens: 20,
      uncachedInputTokens: 80,
      outputTokens: 50,
    });
    expect(options?.headers).not.toHaveProperty("Idempotency-Key");
    expect(fs.readdirSync(mocks.directory)).toEqual([]);
  });
  it.each(["network", "http"])(
    "does not retry %s failures or block later requests",
    async (failure) => {
      vi.mocked(fetch).mockImplementationOnce(async () => {
        if (failure === "network") throw new Error("sensitive-network-details");
        return new Response("", { status: 503 });
      });
      const id = await startSubscriptionUsage("model");
      await expect(
        finishSubscriptionUsage(id, "model", usage),
      ).resolves.toBeUndefined();
      await finishSubscriptionUsage(id, "model", usage);
      expect(fetch).toHaveBeenCalledTimes(1);
      await finishSubscriptionUsage(
        await startSubscriptionUsage("model"),
        "model",
        usage,
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
        "sensitive-network-details",
      );
    },
  );
  it("does not guess missing usage or replay cancelled requests", async () => {
    const cancelled = await startSubscriptionUsage("model");
    interruptSubscriptionUsage(cancelled);
    await finishSubscriptionUsage(cancelled, "model", usage);
    const missing = await startSubscriptionUsage("model");
    await expect(
      finishSubscriptionUsage(missing, "model", {
        ...usage,
        inputTokens: { ...usage.inputTokens, total: undefined },
      }),
    ).resolves.toBeUndefined();
    await finishSubscriptionUsage(missing, "model", usage);
    expect(fetch).not.toHaveBeenCalled();
    await finishSubscriptionUsage(
      await startSubscriptionUsage("model"),
      "model",
      usage,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the billing account selected at request start", async () => {
    const id = await startSubscriptionUsage("model");
    mocks.key = "other-test-account";
    await finishSubscriptionUsage(id, "model", usage);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-dyad-key",
    });
  });
  it("never loads legacy saved reports or restores active reports after restart", async () => {
    const file = path.join(mocks.directory, "codex-subscription-usage.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        reports: [{ id: "legacy", status: "ready" }],
        chargedUsd: 1,
      }),
    );
    const abandoned = await startSubscriptionUsage("model");
    vi.resetModules();
    const restarted = await import("./codex_subscription_usage");
    await restarted.finishSubscriptionUsage(abandoned, "model", usage);
    expect(fetch).not.toHaveBeenCalled();
    await restarted.finishSubscriptionUsage(
      await restarted.startSubscriptionUsage("model"),
      "model",
      usage,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).reports[0].id).toBe(
      "legacy",
    );
    interruptSubscriptionUsage(abandoned, true);
  });
});
