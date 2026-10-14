import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connected: true,
  credentialError: false,
  credentials: vi.fn(),
  catalog: vi.fn(),
  codexClientVersion: vi.fn(),
}));
vi.mock("../shared/remote_language_model_catalog", () => ({
  FALLBACK_CODEX_CLIENT_VERSION: "0.155.1",
  getBuiltinLanguageModelCatalog: mocks.catalog,
  getCodexClientVersion: mocks.codexClientVersion,
}));
vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModelProviders: async () => [],
}));
import { resolveSubscriptionModel } from "./resolve_subscription_model";
import { usesChatGPTSubscription } from "@/lib/subscriptionModels";
import type { UserSettings } from "@/lib/schemas";
import { DyadErrorKind } from "@/errors/dyad_error";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
const settings = {
  enableDyadPro: true,
  proModelUsage: "subscription",
  providerSettings: { auto: { apiKey: { value: "test-key" } } },
} as unknown as UserSettings;

vi.mock("./codex_subscription_auth", () => ({
  getCodexSubscriptionStatus: () => ({
    connected: mocks.connected,
    credentialError: mocks.credentialError,
    pending: false,
  }),
  getCodexSubscriptionCredentials: mocks.credentials,
}));
import {
  getSubscriptionAccount,
  parseSubscriptionLimits,
  resetSubscriptionAccount,
} from "./codex_subscription_account";
beforeEach(() => {
  vi.spyOn(queryInvalidationBus, "publish").mockReturnValue(0);
  resetSubscriptionAccount();
  mocks.catalog
    .mockReset()
    .mockResolvedValue({ modelsByProvider: { openai: [] } });
  mocks.codexClientVersion.mockReset().mockReturnValue("0.155.1");
  mocks.credentials
    .mockReset()
    .mockResolvedValue({ access: "test-access", accountId: "test-account" });
  mocks.connected = true;
  mocks.credentialError = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
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
                  { slug: "gpt-6-sol", visibility: "list" },
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
  expect(a).toMatchObject({
    models: ["gpt-eligible", "gpt-6-sol"],
    limitReached: true,
  });
  expect(JSON.stringify(a)).not.toContain("test-access");
  await getSubscriptionAccount();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.some(([url]) =>
      url.includes("/codex/models?client_version=0.155.1"),
    ),
  ).toBe(true);
});
it("uses the Codex client version from the remote model catalog", async () => {
  mocks.codexClientVersion.mockReturnValue("0.156.0");
  const fetcher = vi.fn().mockResolvedValue(accountResponse(["gpt-6-sol"]));
  vi.stubGlobal("fetch", fetcher);

  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    models: ["gpt-6-sol"],
  });
  expect(fetcher.mock.calls[0][0]).toContain("client_version=0.156.0");
});
it("retries a rejected remote client version with the pinned version", async () => {
  mocks.codexClientVersion.mockReturnValue("0.156.0");
  const fetcher = vi.fn(async (url: string) =>
    url.includes("client_version=0.156.0")
      ? new Response(null, { status: 400 })
      : accountResponse(["gpt-6-sol"]),
  );
  vi.stubGlobal("fetch", fetcher);

  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    models: ["gpt-6-sol"],
    modelsError: undefined,
  });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "https://chatgpt.com/backend-api/codex/models?client_version=0.156.0",
    "https://chatgpt.com/backend-api/codex/models?client_version=0.155.1",
  ]);
});
it("does not retry authentication failures with another client version", async () => {
  mocks.codexClientVersion.mockReturnValue("0.156.0");
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);

  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    error: "Reconnect your ChatGPT subscription to continue.",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refreshes cached models when the remote Codex client version changes", async () => {
  const fetcher = vi.fn(async (url: string) =>
    accountResponse([
      url.includes("client_version=0.156.0") ? "new-model" : "old-model",
    ]),
  );
  vi.stubGlobal("fetch", fetcher);

  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    models: ["old-model"],
  });
  mocks.codexClientVersion.mockReturnValue("0.156.0");
  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    models: ["new-model"],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(queryInvalidationBus.publish).toHaveBeenCalledTimes(2);
});
it("refreshes a changed version without delaying the first model lookup", async () => {
  let finishOld!: (response: Response) => void;
  const fetcher = vi.fn((url: string) =>
    url.includes("client_version=0.155.1")
      ? new Promise<Response>((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve(accountResponse(["new-model"])),
  );
  vi.stubGlobal("fetch", fetcher);

  const pending = getSubscriptionAccount({ includeUsage: false });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  mocks.codexClientVersion.mockReturnValue("0.156.0");
  finishOld(accountResponse(["old-model"]));
  expect(await pending).toMatchObject({ models: ["old-model"] });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject({
    models: ["new-model"],
  });
  expect(queryInvalidationBus.publish).toHaveBeenCalledTimes(2);
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

it("caches the catalog for one hour independently of usage refreshes", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/models?")
            ? { models: [{ slug: "gpt-eligible" }] }
            : { rate_limit: { allowed: true, limit_reached: false } },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  try {
    await getSubscriptionAccount({ includeUsage: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/models?");
    now.mockReturnValue(1_000_000 + 60_000);
    await getSubscriptionAccount();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("/wham/usage");
    now.mockReturnValue(1_000_000 + 3_599_999);
    await getSubscriptionAccount({ includeUsage: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_000_000 + 3_600_000);
    await getSubscriptionAccount({ includeUsage: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
    resetSubscriptionAccount();
    await getSubscriptionAccount({ includeUsage: false });
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally {
    now.mockRestore();
  }
});

it("does not wait for an in-flight usage display refresh", async () => {
  let finish!: (response: Response) => void;
  const usage = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/models?")
        ? new Response(JSON.stringify({ models: [{ slug: "gpt-eligible" }] }))
        : usage,
    ),
  );
  const display = getSubscriptionAccount();
  try {
    expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject(
      { models: ["gpt-eligible"] },
    );
  } finally {
    finish(
      new Response(
        JSON.stringify({ rate_limit: { allowed: true, limit_reached: false } }),
      ),
    );
    await display;
  }
});

it("retries failed catalog lookups after a minute instead of caching failure for an hour", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ slug: "recovered" }] })),
    );
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(
      await getSubscriptionAccount({ includeUsage: false }),
    ).toHaveProperty("modelsError");
    await getSubscriptionAccount({ includeUsage: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_060_000);
    expect(await getSubscriptionAccount({ includeUsage: false })).toMatchObject(
      { models: ["recovered"], modelsError: undefined },
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});

const accountResponse = (models: string[]) =>
  new Response(JSON.stringify({ models: models.map((slug) => ({ slug })) }));

it.each(["empty", "error", "hidden"])(
  "uses the built-in OpenAI catalog for a %s ChatGPT catalog in labels and routing",
  async (failure) => {
    mocks.catalog.mockResolvedValue({
      modelsByProvider: {
        openai: [{ apiName: "gpt-fallback" }, { apiName: "gpt-second" }],
        anthropic: [{ apiName: "claude-excluded" }],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failure === "error") throw new Error("offline");
        if (failure === "hidden")
          return new Response(
            JSON.stringify({
              models: [{ slug: "hidden", visibility: "hide" }],
            }),
          );
        return accountResponse([]);
      }),
    );
    const account = await getSubscriptionAccount({ includeUsage: false });
    expect(account.models).toEqual(["gpt-fallback", "gpt-second"]);
    expect(account.modelsError).toBeDefined();
    const model = {
      provider: "openai",
      name: "gpt-fallback",
      effortLevel: "medium",
    };
    expect(usesChatGPTSubscription(model, settings, account)).toBe(true);
    expect(await resolveSubscriptionModel(model, settings)).toMatchObject({
      connection: "subscription",
    });
    expect(mocks.catalog).toHaveBeenCalled();
  },
);

it.each(["empty", "error"])(
  "retains the last successful ChatGPT catalog after a %s refresh",
  async (failure) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accountResponse(["gpt-account"]));
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(
        (await getSubscriptionAccount({ includeUsage: false })).models,
      ).toEqual(["gpt-account"]);
      now.mockReturnValue(4_600_000);
      if (failure === "error")
        fetcher.mockRejectedValueOnce(new Error("offline"));
      else fetcher.mockResolvedValueOnce(accountResponse([]));
      expect(
        (await getSubscriptionAccount({ includeUsage: false })).models,
      ).toEqual(["gpt-account"]);
      expect(mocks.catalog).not.toHaveBeenCalled();
      now.mockReturnValue(4_660_000);
      fetcher.mockResolvedValueOnce(accountResponse(["gpt-new-account"]));
      expect(
        (await getSubscriptionAccount({ includeUsage: false })).models,
      ).toEqual(["gpt-new-account"]);
    } finally {
      now.mockRestore();
    }
  },
);

it("reuses the built-in catalog service rather than caching its fallback as a ChatGPT success", async () => {
  mocks.catalog
    .mockResolvedValueOnce({
      modelsByProvider: { openai: [{ apiName: "local-model" }] },
    })
    .mockResolvedValueOnce({
      modelsByProvider: { openai: [{ apiName: "remote-model" }] },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => accountResponse([])),
  );
  expect(
    (await getSubscriptionAccount({ includeUsage: false })).models,
  ).toEqual(["local-model"]);
  expect(
    (await getSubscriptionAccount({ includeUsage: false })).models,
  ).toEqual(["remote-model"]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([401, 403, "credentials"])(
  "preserves %s authentication errors when a built-in fallback is available",
  async (failure) => {
    mocks.catalog.mockResolvedValue({
      modelsByProvider: { openai: [{ apiName: "gpt-fallback" }] },
    });
    if (failure === "credentials")
      mocks.credentials.mockRejectedValue(new Error("refresh failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("denied", {
            status: typeof failure === "number" ? failure : 500,
          }),
      ),
    );
    const account = await getSubscriptionAccount({ includeUsage: false });
    expect(account.error).toContain("Reconnect");
    await expect(
      resolveSubscriptionModel(
        { provider: "openai", name: "gpt-fallback", effortLevel: "medium" },
        settings,
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
  },
);

it("discards built-in fallback results if the account disconnects during lookup", async () => {
  let entered!: () => void;
  let finish!: (catalog: unknown) => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mocks.catalog.mockImplementation(() => {
    entered();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => accountResponse([])),
  );
  const pending = getSubscriptionAccount({ includeUsage: false });
  await started;
  resetSubscriptionAccount();
  mocks.connected = false;
  finish({ modelsByProvider: { openai: [{ apiName: "old-account-model" }] } });
  expect(await pending).toMatchObject({ connected: false, models: [] });
});

it("prefers a recovered ChatGPT catalog over a still-pending built-in fallback", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  let entered!: () => void;
  let finish!: (catalog: unknown) => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mocks.catalog.mockImplementation(() => {
    entered();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(accountResponse([]))
      .mockResolvedValueOnce(accountResponse(["recovered"])),
  );
  const pending = getSubscriptionAccount({ includeUsage: false });
  try {
    await started;
    now.mockReturnValue(1_060_000);
    expect(
      (await getSubscriptionAccount({ includeUsage: false })).models,
    ).toEqual(["recovered"]);
    finish({ modelsByProvider: { openai: [{ apiName: "builtin-fallback" }] } });
    expect((await pending).models).toEqual(["recovered"]);
  } finally {
    now.mockRestore();
  }
});

it("refuses unknown eligibility when both catalogs are empty instead of routing to Pro", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => accountResponse([])),
  );
  await expect(
    resolveSubscriptionModel(
      { provider: "openai", name: "unknown", effortLevel: "medium" },
      settings,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.External });
});

it("preserves authentication errors even when the built-in catalog is empty", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("denied", { status: 401 })),
  );
  await expect(
    resolveSubscriptionModel(
      { provider: "openai", name: "unknown", effortLevel: "medium" },
      settings,
    ),
  ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
});
