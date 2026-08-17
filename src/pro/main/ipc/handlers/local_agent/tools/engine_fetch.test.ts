import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  getDyadEngineBaseUrl: vi.fn(),
}));

vi.mock("@/main/settings", () => ({ readSettings: mocks.readSettings }));
vi.mock("@/ipc/utils/dyad_engine_url", () => ({
  getDyadEngineBaseUrl: mocks.getDyadEngineBaseUrl,
}));

import {
  DEFAULT_ENGINE_FETCH_TIMEOUT_MS,
  EngineFetchTimeoutError,
  engineFetch,
} from "./engine_fetch";

describe("engineFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    mocks.readSettings.mockReturnValue({
      providerSettings: { auto: { apiKey: { value: "test-key" } } },
    });
    mocks.getDyadEngineBaseUrl.mockReturnValue("https://engine.test/v1");
  });

  it("uses a 300,000ms default timeout and reports it as a timeout", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        });
      });

    const request = engineFetch({ dyadRequestId: "request-1" }, "/tools/test");
    const rejection = expect(request).rejects.toBeInstanceOf(
      EngineFetchTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_ENGINE_FETCH_TIMEOUT_MS - 1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(DEFAULT_ENGINE_FETCH_TIMEOUT_MS).toBe(300_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation to fetch without calling it a timeout", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    });

    const request = engineFetch({ dyadRequestId: "request-2" }, "/tools/test", {
      signal: controller.signal,
    });
    const rejection = request.catch((error) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(EngineFetchTimeoutError);
      expect((error as Error).message).toBe("user cancelled");
    });
    controller.abort(new Error("user cancelled"));

    await rejection;
  });

  it("does no useful work for an already-aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      engineFetch({ dyadRequestId: "request-3" }, "/tools/test", {
        signal: controller.signal,
      }),
    ).rejects.toThrow("already cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout and caller listener after success", async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await expect(
      engineFetch({ dyadRequestId: "request-4" }, "/tools/test", {
        signal: controller.signal,
      }),
    ).resolves.toBeInstanceOf(Response);

    expect(vi.getTimerCount()).toBe(0);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      addListener.mock.calls[0]?.[1],
    );
  });

  it("cleans up the timeout and listener after cancellation", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    });

    const request = engineFetch({ dyadRequestId: "request-5" }, "/tools/test", {
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
