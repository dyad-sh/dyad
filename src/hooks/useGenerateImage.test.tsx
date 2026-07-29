import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedRequest } from "@/distributed_machines/prepared_request";
import { useGenerateImage } from "./useGenerateImage";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  cancel: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/image_generation/hooks", () => ({
  useImageGenerationActor: () => ({
    state: { jobs: [] },
    connection: "ready",
    snapshot: {
      kind: "available",
      observedRevision: {
        kind: "actor",
        actorInstanceId: "actor",
        revision: 0,
      },
    },
    observedRevision: {
      kind: "actor",
      actorInstanceId: "actor",
      revision: 0,
    },
  }),
  useImageGenerationRequestActor: () => ({
    request: mocks.request,
    cancel: mocks.cancel,
  }),
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

const params = {
  prompt: "A lighthouse",
  themeMode: "plain" as const,
  targetAppId: 7,
  targetAppName: "App",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function prepared(options: {
  admitted: boolean;
}): PreparedRequest<any, any, any> {
  const admission = options.admitted
    ? Promise.resolve({
        kind: "admitted" as const,
        admission: {
          kind: "applied" as const,
          actorInstanceId: "actor",
          revision: 1,
          transactionSequence: 1,
          messageId: "message",
        },
        disposition: "fresh" as const,
      })
    : Promise.resolve({
        kind: "refused" as const,
        reason: "unauthorized",
      });
  return {
    identity: {
      requestId: "request",
      messageId: "message",
      idempotencyKey: "delivery",
      windowSessionId: "window",
    },
    requestId: "request",
    admission,
    settled: options.admitted
      ? Promise.resolve({
          kind: "completed" as const,
          outcome: {
            kind: "succeeded" as const,
            jobId: "job",
            result: { fileName: "image.png", appId: 7, appName: "App" },
          },
        })
      : Promise.resolve({
          kind: "not-admitted" as const,
          reason: "refused" as const,
          refusal: "unauthorized",
        }),
    retry: { kind: "disabled" },
    detach: vi.fn(),
  } as unknown as PreparedRequest<any, any, any>;
}

describe("useGenerateImage", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.cancel.mockReset();
    mocks.showError.mockReset();
  });

  it("returns a job ID only after authoritative admission", async () => {
    mocks.request.mockReturnValue(prepared({ admitted: true }));
    const { result } = renderHook(() => useGenerateImage());

    let jobId: string | null = null;
    await act(async () => {
      jobId = await result.current.start(params);
    });

    expect(jobId).toMatch(/^image-generation-job:/);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("reports refused admission without returning a started job", async () => {
    mocks.request.mockReturnValue(prepared({ admitted: false }));
    const { result } = renderHook(() => useGenerateImage());

    let jobId: string | null = "not-set";
    await act(async () => {
      jobId = await result.current.start(params);
    });

    expect(jobId).toBeNull();
    expect(mocks.showError).toHaveBeenCalledOnce();
  });

  it("mints distinct logical request and runtime invocation identities", async () => {
    mocks.request.mockReturnValue(prepared({ admitted: true }));
    const { result } = renderHook(() => useGenerateImage());

    await act(async () => {
      await result.current.start(params);
    });

    const intent = mocks.request.mock.calls[0][0];
    expect(intent.requestId).toMatch(/^image-generation-request:/);
    expect(intent.operationId).toMatch(/^image-generation-runtime:/);
    expect(intent.requestId).not.toBe(intent.operationId);
    expect(intent.job.id).toMatch(/^image-generation-job:/);
  });

  it("preserves the public refusal result for unexpected admission failure", async () => {
    const request = prepared({ admitted: true });
    Object.assign(request, {
      admission: Promise.reject(new Error("transport failed")),
    });
    mocks.request.mockReturnValue(request);
    const { result } = renderHook(() => useGenerateImage());

    await expect(result.current.start(params)).resolves.toBeNull();
    expect(mocks.showError).toHaveBeenCalledOnce();
  });

  it("detaches renderer ownership when unmounted during admission", async () => {
    const admission = deferred<any>();
    const detach = vi.fn();
    const request = {
      ...prepared({ admitted: true }),
      admission: admission.promise,
      settled: new Promise(() => undefined),
      detach,
    };
    mocks.request.mockReturnValue(request);
    const view = renderHook(() => useGenerateImage());
    const started = view.result.current.start(params);

    view.unmount();
    expect(detach).toHaveBeenCalledOnce();
    admission.resolve({ kind: "refused", reason: "disposed" });
    await expect(started).resolves.toBeNull();
  });
});
