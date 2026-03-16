import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function buildRemoteCatalogResponse() {
  return {
    version: "test-version",
    expiresAt: "2099-01-01T00:00:00.000Z",
    providers: [
      {
        id: "openai",
        displayName: "OpenAI",
        type: "cloud" as const,
      },
    ],
    modelsByProvider: {
      openai: [
        {
          apiName: "gpt-test-remote",
          displayName: "GPT Test Remote",
          description: "Remote model",
        },
      ],
    },
    aliases: [
      {
        id: "dyad/help-bot/default",
        resolvedModel: {
          providerId: "openai",
          apiName: "gpt-test-remote",
        },
        displayName: "Help Bot",
        purpose: "help-bot" as const,
      },
    ],
  };
}

async function waitForRemoteCatalog(
  getBuiltinLanguageModelCatalog: () => Promise<{
    source: "fallback" | "remote";
    version?: string;
  }>,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const catalog = await getBuiltinLanguageModelCatalog();
    if (catalog.source === "remote") {
      return catalog;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for remote catalog");
}

describe("remote_language_model_catalog", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns fallback data immediately on cold start while refreshing in the background", async () => {
    const deferred = createDeferredPromise<Response>();
    const fetchMock = vi.fn(() => deferred.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { getBuiltinLanguageModelCatalog } =
      await import("@/ipc/shared/remote_language_model_catalog");

    const catalog = await getBuiltinLanguageModelCatalog();

    expect(catalog.source).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    deferred.resolve(
      new Response(JSON.stringify(buildRemoteCatalogResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const refreshedCatalog = await waitForRemoteCatalog(
      getBuiltinLanguageModelCatalog,
    );

    expect(refreshedCatalog.source).toBe("remote");
    expect(refreshedCatalog.version).toBe("test-version");
  });

  it("keeps serving fallback data if the background refresh fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network failed"));
    vi.stubGlobal("fetch", fetchMock);

    const { getBuiltinLanguageModelCatalog } =
      await import("@/ipc/shared/remote_language_model_catalog");

    const firstCatalog = await getBuiltinLanguageModelCatalog();
    await Promise.resolve();
    await Promise.resolve();
    const secondCatalog = await getBuiltinLanguageModelCatalog();

    expect(firstCatalog.source).toBe("fallback");
    expect(secondCatalog.source).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
