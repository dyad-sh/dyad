import { describe, expect, it } from "vitest";

import {
  buildMxServeHeaders,
  dedupeMxServeModels,
  loopbackVariants,
  DEFAULT_MX_SERVE_BASE_URL,
  describeConnectionError,
  getMxServeApiBaseUrl,
  getMxServeHealthUrl,
  parseModelsResponse,
  parseMxServeBaseUrl,
  testMxServeConnection,
} from "@/lib/mx_serve";
import { isLocalProviderId } from "@/lib/local_provider_utils";

/** A stand-in MX Serve, so no test needs the real server. */
function fakeServer(
  options: {
    healthOk?: boolean;
    healthStatus?: number;
    models?: string[];
    modelsStatus?: number;
  } = {},
) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });

    if (String(url).endsWith("/health")) {
      const ok = options.healthOk ?? true;
      return { ok, status: options.healthStatus ?? (ok ? 200 : 503) } as any;
    }
    const status = options.modelsStatus ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => ({
        data: (options.models ?? ["mx-llama-3-8b"]).map((id) => ({ id })),
      }),
    } as any;
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

describe("registration", () => {
  it("counts as a local provider", () => {
    // This is what lets private memory reach it and suppresses cloud warnings.
    expect(isLocalProviderId("mx_serve")).toBe(true);
  });

  it("defaults to the documented port", () => {
    expect(DEFAULT_MX_SERVE_BASE_URL).toBe("http://127.0.0.1:8080/v1");
  });
});

describe("parseMxServeBaseUrl", () => {
  it("falls back to the default when nothing is set", () => {
    expect(parseMxServeBaseUrl()).toBe("http://127.0.0.1:8080");
    expect(parseMxServeBaseUrl("   ")).toBe("http://127.0.0.1:8080");
  });

  it("accepts the /v1 root a user is most likely to paste", () => {
    expect(parseMxServeBaseUrl("http://127.0.0.1:8080/v1")).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("tolerates trailing slashes and a missing scheme", () => {
    expect(parseMxServeBaseUrl("127.0.0.1:8080/")).toBe(
      "http://127.0.0.1:8080",
    );
    expect(parseMxServeBaseUrl("http://localhost:9000//")).toBe(
      "http://localhost:9000",
    );
  });

  it("keeps a custom port", () => {
    expect(parseMxServeBaseUrl("http://127.0.0.1:9999")).toBe(
      "http://127.0.0.1:9999",
    );
  });
});

describe("derived URLs", () => {
  const settings = {
    providerSettings: { mx_serve: { apiBaseUrl: "http://127.0.0.1:8080/v1" } },
  } as never;

  it("puts chat completions under /v1", () => {
    expect(getMxServeApiBaseUrl(settings)).toBe("http://127.0.0.1:8080/v1");
  });

  it("puts health beside /v1, not inside it", () => {
    expect(getMxServeHealthUrl(settings)).toBe("http://127.0.0.1:8080/health");
  });
});

describe("buildMxServeHeaders — the optional key", () => {
  it("sends no Authorization header when no key is set", () => {
    // An empty bearer token is worse than none: a server with auth disabled
    // may still reject a malformed one.
    expect(buildMxServeHeaders()).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("sends no header for a blank or whitespace key", () => {
    expect(buildMxServeHeaders("")).not.toHaveProperty("Authorization");
    expect(buildMxServeHeaders("   ")).not.toHaveProperty("Authorization");
  });

  it("sends a bearer token when a key is supplied", () => {
    expect(buildMxServeHeaders("sk-local-123").Authorization).toBe(
      "Bearer sk-local-123",
    );
  });

  it("trims a pasted key", () => {
    expect(buildMxServeHeaders("  sk-local-123  ").Authorization).toBe(
      "Bearer sk-local-123",
    );
  });
});

describe("parseModelsResponse", () => {
  it("reads the model ids", () => {
    expect(parseModelsResponse({ data: [{ id: "a" }, { id: "b" }] })).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "b" },
    ]);
  });

  it("ignores malformed entries rather than failing", () => {
    expect(
      parseModelsResponse({ data: [{ id: "" }, {}, { id: "good" }] }),
    ).toEqual([{ id: "good", label: "good" }]);
  });

  it("returns nothing for an unexpected shape", () => {
    expect(parseModelsResponse({})).toEqual([]);
    expect(parseModelsResponse(null)).toEqual([]);
  });
});

describe("testMxServeConnection", () => {
  it("checks health first, then the models", async () => {
    const { fetcher, calls } = fakeServer();
    const result = await testMxServeConnection({ fetcher });

    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toContain("/health");
    expect(calls[1]!.url).toContain("/v1/models");
  });

  it("returns the models for the selector", async () => {
    const { fetcher } = fakeServer({ models: ["mx-qwen-7b", "mx-llama-8b"] });
    const result = await testMxServeConnection({ fetcher });

    expect(result).toEqual({
      ok: true,
      models: [
        { id: "mx-qwen-7b", label: "mx-qwen-7b" },
        { id: "mx-llama-8b", label: "mx-llama-8b" },
      ],
    });
  });

  it("omits Authorization on every call when no key is set", async () => {
    const { fetcher, calls } = fakeServer();
    await testMxServeConnection({ fetcher });
    for (const call of calls) {
      expect(call.headers).not.toHaveProperty("Authorization");
    }
  });

  it("sends the key on every call when one is set", async () => {
    const { fetcher, calls } = fakeServer();
    await testMxServeConnection({ fetcher, apiKey: "sk-local-123" });
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer sk-local-123");
    }
  });

  it("explains a server that is not running", async () => {
    const dead = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const result = await testMxServeConnection({ fetcher: dead });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Open MX Serve");
    }
  });

  it("explains a rejected key rather than blaming the server", async () => {
    const { fetcher } = fakeServer({ healthOk: false, healthStatus: 401 });
    const result = await testMxServeConnection({ fetcher, apiKey: "wrong" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/api key/i);
  });

  it("explains a running server with no model loaded", async () => {
    // Different problem, different fix — worth distinguishing.
    const { fetcher } = fakeServer({ models: [] });
    const result = await testMxServeConnection({ fetcher });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no model loaded/i);
  });

  it("explains a timeout as a loading model", async () => {
    const slow = (async () => {
      throw new Error("The operation was aborted due to timeout");
    }) as unknown as typeof fetch;
    const result = await testMxServeConnection({ fetcher: slow });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/still loading|in time/i);
  });

  it("never puts the key in an error message", async () => {
    const { fetcher } = fakeServer({ modelsStatus: 500 });
    const result = await testMxServeConnection({
      fetcher,
      apiKey: "sk-super-secret",
    });
    if (!result.ok) expect(result.message).not.toContain("sk-super-secret");
  });
});

describe("describeConnectionError", () => {
  it("gives a server error its status", () => {
    expect(describeConnectionError("models", null, 503)).toContain("503");
  });

  it("treats a missing model list as a loadable state", () => {
    expect(describeConnectionError("models", null, 404)).toMatch(
      /load a model/i,
    );
  });
});

describe("universal treatment alongside the other local providers", () => {
  it("is discovered on its own port like Ollama and LM Studio", async () => {
    // Discovery probes a fixed set of known local servers; MX Serve joins it
    // rather than needing its own separate path.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "src/ipc/handlers/local_model_discovery_handler.ts",
        "utf8",
      ),
    );
    expect(source).toContain('addProbe("mx_serve", "http://127.0.0.1:8080")');
    expect(source).toContain("port === 8080");
  });

  it("uses the OpenAI model route, not a bespoke one", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "src/ipc/handlers/local_model_discovery_handler.ts",
        "utf8",
      ),
    );
    // Only Ollama has its own shape; everything else shares /v1/models.
    expect(source).toContain('provider === "ollama" ? `${origin}/api/tags`');
  });

  it("offers its models to the role pickers on the same terms", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/settings/ModelRolesSettings.tsx", "utf8"),
    );
    expect(source).toContain('"ollama" | "lmstudio" | "mx_serve"');
  });

  it("is named in discovery results", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "src/ipc/handlers/local_model_discovery_handler.ts",
        "utf8",
      ),
    );
    expect(source).toContain('mx_serve: "MX Serve"');
  });
});

describe("loopback families", () => {
  it("offers the IPv6 counterpart of an IPv4 address", () => {
    // MX Serve binds IPv6 loopback only on this machine, so 127.0.0.1 never
    // answers — trying only one family is wrong half the time.
    expect(loopbackVariants("http://127.0.0.1:8080")).toEqual([
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
    ]);
  });

  it("offers the IPv4 counterpart of an IPv6 address", () => {
    expect(loopbackVariants("http://[::1]:8080")).toEqual([
      "http://[::1]:8080",
      "http://127.0.0.1:8080",
    ]);
  });

  it("expands localhost to both families", () => {
    expect(loopbackVariants("http://localhost:8080")).toHaveLength(3);
  });

  it("leaves a remote host alone", () => {
    expect(loopbackVariants("http://nas.local:8080")).toEqual([
      "http://nas.local:8080",
    ]);
  });

  it("connects when only the IPv6 address answers", async () => {
    const calls: string[] = [];
    const ipv6Only = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("127.0.0.1")) throw new Error("ECONNREFUSED");
      if (String(url).endsWith("/health"))
        return { ok: true, status: 200 } as any;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "mx-model" }] }),
      } as any;
    }) as unknown as typeof fetch;

    const result = await testMxServeConnection({
      baseUrl: "http://127.0.0.1:8080",
      fetcher: ipv6Only,
    });

    expect(result.ok).toBe(true);
    // Models must be fetched from the address that actually answered.
    expect(calls.at(-1)).toContain("[::1]");
  });
});

describe("dedupeMxServeModels", () => {
  it("collapses the same model reached on two addresses", () => {
    // A dual-stack server is discovered twice; it is still one model.
    expect(
      dedupeMxServeModels([
        { id: "qwen3-0.6b-local" },
        { id: "qwen3-0.6b-local" },
      ]),
    ).toEqual([{ id: "qwen3-0.6b-local" }]);
  });

  it("keeps genuinely different models", () => {
    expect(
      dedupeMxServeModels([{ id: "qwen3-0.6b" }, { id: "llama-8b" }]),
    ).toHaveLength(2);
  });

  it("keeps the last entry for a repeated id", () => {
    const models = [
      { id: "a", label: "first" },
      { id: "a", label: "second" },
    ];
    expect(dedupeMxServeModels(models)).toEqual([{ id: "a", label: "second" }]);
  });

  it("handles an empty list", () => {
    expect(dedupeMxServeModels([])).toEqual([]);
  });

  it("produces one model for the real dual-stack case", () => {
    // Both loopback families report the same single model.
    const fromIpv4 = [{ id: "qwen3-0.6b-local" }];
    const fromIpv6 = [{ id: "qwen3-0.6b-local" }];
    expect(dedupeMxServeModels([...fromIpv4, ...fromIpv6])).toHaveLength(1);
  });
});

describe("chat routing", () => {
  it("has a model client, so selecting it does not fail at request time", async () => {
    // "Unsupported model provider: mx_serve" came from this switch having no
    // branch for it — the model was selectable but unusable.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/ipc/utils/get_model_client.ts", "utf8"),
    );
    expect(source).toContain('case "mx_serve":');
    expect(source).toContain("getMxServeApiBaseUrl(settings)");
  });

  it("offers each local model once to the role pickers", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/settings/ModelRolesSettings.tsx", "utf8"),
    );
    expect(source).toContain("seenLocalModels");
    expect(source).toContain("`${server.provider}:${model.modelName}`");
  });
});
