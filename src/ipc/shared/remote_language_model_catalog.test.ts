import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GPT_5_5_MODEL_NAME } from "./language_model_constants";

type RemoteAlias = {
  id: string;
  providerId: string;
  apiName: string;
  purpose?: "auto-mode" | "theme-generation" | "help-bot";
};

const DEFAULT_REMOTE_ALIASES: RemoteAlias[] = [
  {
    id: "dyad/auto/openai",
    providerId: "openai",
    apiName: "gpt-5.2",
    purpose: "auto-mode",
  },
  {
    id: "dyad/auto/anthropic",
    providerId: "anthropic",
    apiName: "claude-sonnet-4-6",
    purpose: "auto-mode",
  },
  {
    id: "dyad/theme-generator/openai",
    providerId: "openai",
    apiName: "gpt-5.2",
    purpose: "theme-generation",
  },
  {
    id: "dyad/help-bot/default",
    providerId: "openai",
    apiName: "gpt-5.2",
    purpose: "help-bot",
  },
];

function remoteCatalogBody(opts?: {
  version?: string;
  expiresInMs?: number;
  aliases?: RemoteAlias[];
}) {
  const {
    version = "remote-v1",
    expiresInMs = 500,
    aliases = DEFAULT_REMOTE_ALIASES,
  } = opts ?? {};
  return {
    version,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    providers: [],
    modelsByProvider: {},
    aliases: aliases.map((a) => ({
      id: a.id,
      resolvedModel: { providerId: a.providerId, apiName: a.apiName },
      ...(a.purpose ? { purpose: a.purpose } : {}),
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("remote language model catalog", () => {
  it("keeps a nonempty remote auto-model list authoritative", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          version: "test",
          expiresAt: "2099-01-01T00:00:00.000Z",
          providers: [],
          modelsByProvider: {
            auto: [
              {
                apiName: "remote-auto",
                displayName: "Remote Auto",
                description: "The remotely configured Auto option",
              },
            ],
          },
          aliases: [],
        }),
      ),
    );

    const { getBuiltinLanguageModelCatalog } =
      await import("./remote_language_model_catalog");
    const catalog = await getBuiltinLanguageModelCatalog();

    expect(catalog.modelsByProvider.auto).toEqual([
      expect.objectContaining({ apiName: "remote-auto" }),
    ]);
  });

  it("uses the fallback catalog on cold start when the remote fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("outage")));

    const mod = await import("./remote_language_model_catalog");

    const catalog = await mod.getBuiltinLanguageModelCatalog();
    expect(catalog.source).toBe("fallback");
    expect(catalog.version).toBeUndefined();
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe(GPT_5_5_MODEL_NAME);
  });

  it("preserves the resolved alias apiName across a failed background refresh", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(jsonResponse(remoteCatalogBody()));
        }
        return Promise.reject(new Error("transient outage"));
      }),
    );

    const mod = await import("./remote_language_model_catalog");

    await mod.getBuiltinLanguageModelCatalog();
    expect(fetchCalls).toBe(1);

    const beforeOpenAi = await mod.resolveBuiltinModelAlias("dyad/auto/openai");
    const beforeAnthropic = await mod.resolveBuiltinModelAlias(
      "dyad/auto/anthropic",
    );
    const beforeTheme = await mod.resolveBuiltinModelAlias(
      "dyad/theme-generator/openai",
    );
    const beforeHelpBot = await mod.resolveBuiltinModelAlias(
      "dyad/help-bot/default",
    );
    expect(beforeOpenAi?.apiName).toBe("gpt-5.2");
    expect(beforeAnthropic?.apiName).toBe("claude-sonnet-4-6");
    expect(beforeTheme?.apiName).toBe("gpt-5.2");
    expect(beforeHelpBot?.apiName).toBe("gpt-5.2");

    // Let the server-declared expiry (500ms) elapse so the cache is stale and
    // the next read triggers a background refresh.
    await new Promise((r) => setTimeout(r, 600));

    const stale = await mod.getBuiltinLanguageModelCatalog();
    expect(stale.source).toBe("remote");
    expect(fetchCalls).toBe(2);

    // Allow the failed background refresh to settle.
    await new Promise((r) => setTimeout(r, 250));

    // The cache should still hold the stale-but-known remote data (source
    // remains "remote") instead of being clobbered by the app-vetted fallback.
    const preserved = await mod.getBuiltinLanguageModelCatalog();
    expect(preserved.source).toBe("remote");
    expect(fetchCalls).toBe(2);

    const afterOpenAi = await mod.resolveBuiltinModelAlias("dyad/auto/openai");
    const afterAnthropic = await mod.resolveBuiltinModelAlias(
      "dyad/auto/anthropic",
    );
    const afterTheme = await mod.resolveBuiltinModelAlias(
      "dyad/theme-generator/openai",
    );
    const afterHelpBot = await mod.resolveBuiltinModelAlias(
      "dyad/help-bot/default",
    );
    expect(afterOpenAi?.apiName).toBe("gpt-5.2");
    expect(afterAnthropic?.apiName).toBe("claude-sonnet-4-6");
    expect(afterTheme?.apiName).toBe("gpt-5.2");
    expect(afterHelpBot?.apiName).toBe("gpt-5.2");
    expect(fetchCalls).toBe(2);
  });

  it("serves stale remote data while a background refresh is in flight", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(jsonResponse(remoteCatalogBody()));
        }
        // Subsequent refreshes resolve after a short delay with new remote data.
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                jsonResponse(
                  remoteCatalogBody({
                    version: "remote-v2",
                    aliases: [
                      {
                        id: "dyad/auto/openai",
                        providerId: "openai",
                        apiName: "gpt-5.3",
                        purpose: "auto-mode",
                      },
                    ],
                  }),
                ),
              ),
            100,
          );
        });
      }),
    );

    const mod = await import("./remote_language_model_catalog");

    await mod.getBuiltinLanguageModelCatalog();
    expect(fetchCalls).toBe(1);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // Let the cache go stale.
    await new Promise((r) => setTimeout(r, 600));

    const firstStale = await mod.getBuiltinLanguageModelCatalog();
    expect(firstStale.source).toBe("remote");
    expect(fetchCalls).toBe(2);

    // A second read while the refresh is still in flight must NOT schedule
    // another fetch (the in-flight guard dedupes) and must keep serving the
    // stale remote data.
    const secondStale = await mod.getBuiltinLanguageModelCatalog();
    expect(secondStale.source).toBe("remote");
    expect(fetchCalls).toBe(2);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // Let the in-flight refresh resolve successfully; the next read reflects
    // the updated remote catalog (no regression on the happy SWR path).
    await new Promise((r) => setTimeout(r, 200));
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.3");
    expect(fetchCalls).toBe(2);
  });

  it("falls through to the fallback after the grace revalidation cycle is used", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(
            jsonResponse(remoteCatalogBody({ expiresInMs: 1000 })),
          );
        }
        return Promise.reject(new Error("transient outage"));
      }),
    );
    vi.useFakeTimers();

    const mod = await import("./remote_language_model_catalog");

    const cold = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    const coldCatalog = await cold;
    expect(coldCatalog.source).toBe("remote");
    expect(fetchCalls).toBe(1);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // Advance past the server-declared expiry; the stale read triggers a
    // failed refresh that preserves the remote data for one grace cycle.
    await vi.advanceTimersByTimeAsync(1500);

    const stalePromise = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    const staleCatalog = await stalePromise;
    expect(staleCatalog.source).toBe("remote");
    expect(fetchCalls).toBe(2);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // Advance past the 30s grace TTL; the next stale read triggers a second
    // failed refresh which must fall through to the app-vetted fallback.
    await vi.advanceTimersByTimeAsync(35_000);

    const stale2Promise = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await stale2Promise;
    expect(fetchCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(0);

    expect((await mod.getBuiltinLanguageModelCatalog()).source).toBe(
      "fallback",
    );
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe(GPT_5_5_MODEL_NAME);
    expect(fetchCalls).toBe(3);
  });

  it("a successful refresh after a grace-preserved cache resets the grace budget", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(
            jsonResponse(
              remoteCatalogBody({
                version: "remote-v1",
                expiresInMs: 1000,
                aliases: [
                  {
                    id: "dyad/auto/openai",
                    providerId: "openai",
                    apiName: "gpt-5.2",
                    purpose: "auto-mode",
                  },
                ],
              }),
            ),
          );
        }
        if (fetchCalls === 2) {
          return Promise.reject(new Error("transient outage"));
        }
        if (fetchCalls === 3) {
          return Promise.resolve(
            jsonResponse(
              remoteCatalogBody({
                version: "remote-v2",
                expiresInMs: 1000,
                aliases: [
                  {
                    id: "dyad/auto/openai",
                    providerId: "openai",
                    apiName: "gpt-5.3",
                    purpose: "auto-mode",
                  },
                ],
              }),
            ),
          );
        }
        if (fetchCalls === 4) {
          return Promise.reject(new Error("transient outage"));
        }
        return Promise.reject(new Error("transient outage"));
      }),
    );
    vi.useFakeTimers();

    const mod = await import("./remote_language_model_catalog");

    const cold = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await cold;
    expect(fetchCalls).toBe(1);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // (A) Advance past expiry; refresh #2 fails -> preserve remote (grace used).
    await vi.advanceTimersByTimeAsync(1500);
    let stale = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await stale;
    expect(fetchCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.2");

    // (B) Advance past the grace TTL; refresh #3 SUCCEEDS with gpt-5.3, which
    // must reset the grace budget.
    await vi.advanceTimersByTimeAsync(35_000);
    stale = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await stale;
    expect(fetchCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.3");

    // (C) Advance past expiry; refresh #4 fails. Because the successful refresh
    // reset the grace budget, the remote data is preserved again (NOT fallback).
    await vi.advanceTimersByTimeAsync(1500);
    stale = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await stale;
    expect(fetchCalls).toBe(4);
    await vi.advanceTimersByTimeAsync(0);
    expect((await mod.getBuiltinLanguageModelCatalog()).source).toBe("remote");
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe("gpt-5.3");

    // (D) Advance past the grace TTL; refresh #5 fails again and now falls
    // through to the fallback, proving the reset grace is itself bounded.
    await vi.advanceTimersByTimeAsync(35_000);
    stale = mod.getBuiltinLanguageModelCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await stale;
    expect(fetchCalls).toBe(5);
    await vi.advanceTimersByTimeAsync(0);
    expect((await mod.getBuiltinLanguageModelCatalog()).source).toBe(
      "fallback",
    );
    expect(
      (await mod.resolveBuiltinModelAlias("dyad/auto/openai"))?.apiName,
    ).toBe(GPT_5_5_MODEL_NAME);
  });
});
