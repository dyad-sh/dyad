import { languageModelContracts } from "@/ipc/types/language-model";
import { DyadError } from "@/errors/dyad_error";
import {
  fetchOpenAICompatibleModels,
  selectModelsToImport,
} from "@/ipc/handlers/fetch_openai_compatible_models";
import { afterEach, describe, it, expect, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, ...response });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("fetchOpenAICompatibleModels", () => {
  it("maps vLLM max_model_len to contextWindow and drops entries without an id", async () => {
    stubFetch({
      json: async () => ({
        data: [
          { id: "qwen/qwen3-8b", owned_by: "vllm", max_model_len: 32768 },
          { id: "plain-model" },
          { owned_by: "nobody" },
        ],
      }),
    });

    expect(await fetchOpenAICompatibleModels("http://host:8000/v1")).toEqual([
      {
        apiName: "qwen/qwen3-8b",
        displayName: "qwen/qwen3-8b",
        contextWindow: 32768,
      },
      {
        apiName: "plain-model",
        displayName: "plain-model",
        contextWindow: undefined,
      },
    ]);
  });

  it("returns each model id once", async () => {
    stubFetch({
      json: async () => ({ data: [{ id: "a" }, { id: "a" }, { id: "b" }] }),
    });
    const models = await fetchOpenAICompatibleModels("http://host:8000/v1");
    expect(models.map((m) => m.apiName)).toEqual(["a", "b"]);
  });

  it("strips trailing slashes and only sends Authorization when a key is given", async () => {
    const fetchMock = stubFetch({ json: async () => ({ data: [] }) });

    await fetchOpenAICompatibleModels("http://host:8000/v1/");
    expect(fetchMock.mock.calls[0][0]).toBe("http://host:8000/v1/models");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});

    await fetchOpenAICompatibleModels("http://host:8000/v1", "sk-test");
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      Authorization: "Bearer sk-test",
    });
  });

  it("hints at the API key on 401", async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(
      fetchOpenAICompatibleModels("http://host:8000/v1"),
    ).rejects.toThrow(/API key/);
  });

  it("does not include private endpoint URLs or credentials in failures", async () => {
    const privateUrl =
      "https://user:secret@private-host.example/v1?token=query-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error(`connect ECONNREFUSED ${privateUrl}`), {
          code: "ECONNREFUSED",
        }),
      ),
    );

    let failure: unknown;
    try {
      await fetchOpenAICompatibleModels(privateUrl);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) {
      throw new Error("Expected provider discovery to fail");
    }
    expect(failure.message).toContain("ECONNREFUSED");
    expect(failure.message).not.toContain("private-host.example");
    expect(failure.message).not.toContain("secret");
    expect(failure.message).not.toContain("query-secret");
    expect(failure.cause).toBeUndefined();
  });

  it("includes nested transport diagnostics", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const notFound = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new TypeError("fetch failed", {
          cause: new AggregateError([refused, notFound]),
        }),
      ),
    );

    await expect(
      fetchOpenAICompatibleModels("http://host:8000/v1"),
    ).rejects.toThrow(/ECONNREFUSED.*ENOTFOUND/);
  });

  it("throws a DyadError when the server is unreachable or the body is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    await expect(
      fetchOpenAICompatibleModels("http://host:8000/v1"),
    ).rejects.toBeInstanceOf(DyadError);

    stubFetch({ json: async () => ({ nope: true }) });
    await expect(
      fetchOpenAICompatibleModels("http://host:8000/v1"),
    ).rejects.toBeInstanceOf(DyadError);
  });
});

describe("selectModelsToImport", () => {
  it("skips models already saved for the provider, even if a stale UI offered them", () => {
    const models = [{ apiName: "a" }, { apiName: "b" }, { apiName: "c" }];
    expect(selectModelsToImport(models, ["b"])).toEqual([
      { apiName: "a" },
      { apiName: "c" },
    ]);
  });

  it("drops duplicates within the same import", () => {
    expect(
      selectModelsToImport([{ apiName: "a" }, { apiName: "a" }], []),
    ).toEqual([{ apiName: "a" }]);
  });
});

describe("importCustomProviderModels contract", () => {
  it("invalidates model lists in every window", () => {
    const { invalidates } = languageModelContracts.importCustomProviderModels;
    expect(
      invalidates?.(
        { providerId: "custom::x", models: [] },
        { added: 0, skipped: 0 },
      ),
    ).toEqual([{ family: "language-models" }]);
  });
});
