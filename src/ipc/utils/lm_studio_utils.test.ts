import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLMStudioModelContextLength } from "@/ipc/utils/lm_studio_utils";

const originalLmStudioUrl = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalLmStudioUrl === undefined) {
    delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
  } else {
    process.env.LM_STUDIO_BASE_URL_FOR_TESTING = originalLmStudioUrl;
  }
});

function stubFetchWith(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchLMStudioModelContextLength", () => {
  it("prefers the loaded context length of a loaded model", async () => {
    stubFetchWith({
      data: [
        {
          id: "qwen/qwen3-30b",
          state: "loaded",
          max_context_length: 262_144,
          loaded_context_length: 204_800,
        },
      ],
    });

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBe(204_800);
  });

  it("falls back to max_context_length when the model is not loaded", async () => {
    stubFetchWith({
      data: [
        {
          id: "qwen/qwen3-30b",
          state: "not-loaded",
          max_context_length: 131_072,
        },
      ],
    });

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBe(131_072);
  });

  it("falls back to max_context_length when loaded_context_length is unusable", async () => {
    stubFetchWith({
      data: [
        {
          id: "qwen/qwen3-30b",
          state: "loaded",
          loaded_context_length: 0,
          max_context_length: 131_072,
        },
      ],
    });

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBe(131_072);
  });

  it("returns undefined for a model LM Studio does not list", async () => {
    stubFetchWith({
      data: [{ id: "some-other-model", max_context_length: 4096 }],
    });

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when LM Studio responds with an error status", async () => {
    stubFetchWith({}, false);

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when LM Studio is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBeUndefined();
  });

  it("degrades to undefined when the request times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("The operation was aborted.", "TimeoutError"),
        ),
    );

    await expect(
      fetchLMStudioModelContextLength("qwen/qwen3-30b"),
    ).resolves.toBeUndefined();
  });

  it("ignores context lengths that are not positive numbers", async () => {
    for (const max_context_length of [0, -1, "32768", undefined]) {
      stubFetchWith({ data: [{ id: "m", max_context_length }] });

      await expect(
        fetchLMStudioModelContextLength("m"),
      ).resolves.toBeUndefined();
    }
  });

  it("queries the configured LM Studio base URL", async () => {
    process.env.LM_STUDIO_BASE_URL_FOR_TESTING = "http://127.0.0.1:9876";
    const fetchMock = stubFetchWith({ data: [] });

    await fetchLMStudioModelContextLength("m");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9876/api/v0/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
