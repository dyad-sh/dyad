import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerImageGenerationHandlers } from "./image_generation_handlers";

vi.mock("@/main/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/settings")>();
  return {
    ...actual,
    readSettings: () => ({
      ...actual.DEFAULT_SETTINGS,
      providerSettings: { auto: { apiKey: { value: "test-api-key" } } },
    }),
  };
});

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const { default: nodePath } = await import("node:path");
  const { default: nodeOs } = await import("node:os");
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.join(nodeOs.tmpdir(), "dyad-image-generation-tests", appPath),
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function abortableFetch(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () =>
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) {
      rejectAbort();
    } else {
      signal?.addEventListener("abort", rejectAbort, { once: true });
    }
  });
}

describe("registerImageGenerationHandlers", () => {
  const tempBase = path.join(os.tmpdir(), "dyad-image-generation-tests");
  let harness: HandlerTestHarness;
  let appId: number;

  beforeEach(() => {
    fs.rmSync(tempBase, { recursive: true, force: true });
    harness = setupHandlerTestHarness();
    registerImageGenerationHandlers();
    const result = harness.db
      .insert(apps)
      .values({ name: "Test app", path: "test-app" })
      .run();
    appId = Number(result.lastInsertRowid);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    harness.dispose();
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  function generate(requestId: string) {
    return harness.invokeHandler("generate-image", {
      requestId,
      prompt: "A tiny lighthouse",
      themeMode: "plain",
      targetAppId: appId,
    });
  }

  async function cancel(requestId: string): Promise<{ cancelled: boolean }> {
    return harness.invokeHandler("cancel-image-generation", { requestId });
  }

  it("aborts the initial generation request", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      abortableFetch(init?.signal ?? undefined),
    );
    vi.stubGlobal("fetch", fetchMock);

    const generation = generate("generation-phase");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await expect(cancel("generation-phase")).resolves.toEqual({
      cancelled: true,
    });
    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    await expect(cancel("generation-phase")).resolves.toEqual({
      cancelled: false,
    });
  });

  it("aborts the URL download with the generation controller", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            created: 1,
            data: [{ url: "https://example.com/generated.png" }],
          }),
          { status: 200 },
        ),
      )
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        abortableFetch(init?.signal ?? undefined),
      );
    vi.stubGlobal("fetch", fetchMock);

    const generation = generate("download-phase");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await expect(cancel("download-phase")).resolves.toEqual({
      cancelled: true,
    });
    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
  });

  it("classifies a URL download timeout as an external error", async () => {
    const downloadTimeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      downloadTimeoutController.signal,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            created: 1,
            data: [{ url: "https://example.com/generated.png" }],
          }),
          { status: 200 },
        ),
      )
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        abortableFetch(init?.signal ?? undefined),
      );
    vi.stubGlobal("fetch", fetchMock);

    const generation = generate("download-timeout");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    downloadTimeoutController.abort(
      new DOMException("The operation timed out", "TimeoutError"),
    );

    await expect(generation).rejects.toMatchObject({
      message: "Image download timed out. Please try again.",
      kind: DyadErrorKind.External,
    });
    await expect(cancel("download-timeout")).resolves.toEqual({
      cancelled: false,
    });
  });

  it.each([
    [401, DyadErrorKind.Auth],
    [403, DyadErrorKind.Auth],
    [429, DyadErrorKind.RateLimited],
    [503, DyadErrorKind.External],
  ])("classifies generation HTTP %i as %s", async (status, expectedKind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );

    await expect(generate(`generation-http-${status}`)).rejects.toMatchObject({
      kind: expectedKind,
    });
  });

  it.each([
    [401, DyadErrorKind.Auth],
    [403, DyadErrorKind.Auth],
    [429, DyadErrorKind.RateLimited],
    [503, DyadErrorKind.External],
  ])("classifies download HTTP %i as %s", async (status, expectedKind) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              created: 1,
              data: [{ url: "https://example.com/generated.png" }],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status })),
    );

    await expect(generate(`download-http-${status}`)).rejects.toMatchObject({
      kind: expectedKind,
    });
  });

  it("checks for cancellation after a download body finishes", async () => {
    const body = deferred<ArrayBuffer>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            created: 1,
            data: [{ url: "https://example.com/generated.png" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => body.promise,
      });
    vi.stubGlobal("fetch", fetchMock);

    const generation = generate("download-body-phase");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(cancel("download-body-phase")).resolves.toEqual({
      cancelled: true,
    });
    body.resolve(new Uint8Array([1, 2, 3]).buffer);

    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
  });

  it("checks for cancellation inside the media lock before writing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            created: 1,
            data: [{ b64_json: Buffer.from("image").toString("base64") }],
          }),
          { status: 200 },
        ),
      ),
    );
    const mkdirStarted = deferred<void>();
    const releaseMkdir = deferred<void>();
    vi.spyOn(fs.promises, "mkdir").mockImplementationOnce(async () => {
      mkdirStarted.resolve();
      await releaseMkdir.promise;
      return undefined;
    });
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    const generation = generate("pre-write-phase");
    await mkdirStarted.promise;
    await expect(cancel("pre-write-phase")).resolves.toEqual({
      cancelled: true,
    });
    releaseMkdir.resolve();

    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("removes failed requests from the active controller registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("service unavailable", { status: 503 }),
        ),
    );

    await expect(generate("failed-request")).rejects.toThrow(
      "Image generation failed (HTTP 503)",
    );
    await expect(cancel("failed-request")).resolves.toEqual({
      cancelled: false,
    });
  });
});
