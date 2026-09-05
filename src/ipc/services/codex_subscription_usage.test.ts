// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ directory: "", key: "test-dyad-key" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => mocks.directory }));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: { auto: { apiKey: { value: mocks.key } } },
  }),
}));
vi.mock("@/ipc/shared/remote_language_model_catalog", () => ({
  getBuiltinLanguageModelCatalog: async () => ({
    modelsByProvider: { openai: [{ apiName: "known" }] },
    version: "test-v1",
  }),
}));
import {
  startSubscriptionUsage,
  finishSubscriptionUsage,
  flushSubscriptionUsage,
  getSubscriptionUsageStatus,
  interruptSubscriptionUsage,
  normalizeSubscriptionUsage,
} from "./codex_subscription_usage";
const usage = {
  inputTokens: { total: 100, noCache: 70, cacheRead: 20, cacheWrite: 10 },
  outputTokens: { total: 50, text: 30, reasoning: 20 },
};
describe("subscription usage ledger", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-usage-test-"),
    );
    mocks.key = "test-dyad-key";
  });
  afterEach(async () => {
    await flushSubscriptionUsage().catch(() => {});
    vi.unstubAllGlobals();
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });
  it("normalizes disjoint categories without double-counting reasoning", () => {
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
  it("retries the same idempotent report after an outage", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await startSubscriptionUsage("known");
    await finishSubscriptionUsage(id, "known", usage);
    await expect(flushSubscriptionUsage()).rejects.toThrow("503");
    expect(getSubscriptionUsageStatus().pendingReports).toBe(1);
    await expect(startSubscriptionUsage("known")).rejects.toThrow("503");
    fetchMock.mockImplementation(async () =>
      Response.json({ id, chargedUsd: 0.001 }),
    );
    await flushSubscriptionUsage();
    await flushSubscriptionUsage();
    expect(getSubscriptionUsageStatus()).toEqual({
      pendingReports: 0,
      chargedUsd: 0.001,
      missingUsage: false,
    });
    for (const call of fetchMock.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      const body = JSON.parse(call[1].body as string);
      expect(body.id).toBe(id);
      expect(body.tokens).toEqual({
        input: 70,
        cacheRead: 20,
        cacheWrite: 10,
        output: 50,
      });
      expect(body).not.toHaveProperty("billingOwner");
      expect(body.catalog.knownModel).toBe(true);
    }
  });
  it("does not guess usage after cancellation", async () => {
    const id = await startSubscriptionUsage("unknown");
    interruptSubscriptionUsage(id);
    expect(getSubscriptionUsageStatus().missingUsage).toBe(true);
    await expect(startSubscriptionUsage("unknown")).rejects.toThrow(
      "reconciliation",
    );
  });
});
