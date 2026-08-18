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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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
    await expect(request).rejects.toMatchObject({
      kind: DyadErrorKind.External,
    });
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
      expect(error).toBeInstanceOf(DyadError);
      expect(error).not.toBeInstanceOf(EngineFetchTimeoutError);
      expect(error).toMatchObject({
        message: "This agent run was cancelled.",
        kind: DyadErrorKind.UserCancelled,
        cause: expect.objectContaining({ message: "user cancelled" }),
      });
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
    ).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
      cause: expect.objectContaining({ message: "already cancelled" }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps cancellation active until the response body settles", async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const response = await engineFetch(
      { dyadRequestId: "request-4", abortSignal: controller.signal },
      "/tools/test",
    );

    expect(vi.getTimerCount()).toBe(1);
    expect(removeListener).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("ok");

    expect(vi.getTimerCount()).toBe(0);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      addListener.mock.calls[0]?.[1],
    );
    expect("arrayBuffer" in response).toBe(false);
    expect("clone" in response).toBe(false);
  });

  it("combines an explicit signal with the turn abort signal", async () => {
    const explicitController = new AbortController();
    const turnController = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    });

    const request = engineFetch(
      {
        dyadRequestId: "request-combined-signals",
        abortSignal: turnController.signal,
      },
      "/tools/test",
      { signal: explicitController.signal },
    );
    turnController.abort(new Error("turn cancelled"));

    await expect(request).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
      cause: expect.objectContaining({ message: "turn cancelled" }),
    });
    expect(explicitController.signal.aborted).toBe(false);
  });

  it("supports a per-endpoint timeout override", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    });

    const request = engineFetch(
      { dyadRequestId: "request-short-timeout" },
      "/tools/test",
      { timeoutMs: 25 },
    );
    const rejection = expect(request).rejects.toMatchObject({
      message: "Dyad engine request to /tools/test timed out after 25ms",
      kind: DyadErrorKind.External,
    });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it("uses the context abort signal by default after headers arrive", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(streamController) {
              init?.signal?.addEventListener("abort", () => {
                streamController.error(init.signal?.reason);
              });
            },
          }),
        ),
      );
    });

    const response = await engineFetch(
      { dyadRequestId: "request-headers", abortSignal: controller.signal },
      "/tools/test",
    );
    const bodyRejection = expect(response.text()).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
      cause: expect.objectContaining({ message: "cancel body read" }),
    });
    controller.abort(new Error("cancel body read"));

    await bodyRejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("applies the timeout until the response body settles", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(streamController) {
              init?.signal?.addEventListener("abort", () => {
                streamController.error(init.signal?.reason);
              });
            },
          }),
        ),
      );
    });

    const response = await engineFetch(
      { dyadRequestId: "request-body-timeout" },
      "/tools/test",
    );
    const bodyRejection = expect(response.json()).rejects.toBeInstanceOf(
      EngineFetchTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_ENGINE_FETCH_TIMEOUT_MS);

    await bodyRejection;
    expect(vi.getTimerCount()).toBe(0);
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
      kind: DyadErrorKind.UserCancelled,
    });
    controller.abort();
    await rejection;

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cleans up when a caller abandons and cancels the response body", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const upstreamCancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel: upstreamCancel,
        }),
      ),
    );

    const response = await engineFetch(
      { dyadRequestId: "request-abandoned", abortSignal: controller.signal },
      "/tools/test",
    );
    await response.body?.cancel("consumer stopped");

    expect(upstreamCancel).toHaveBeenCalledWith("consumer stopped");
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
