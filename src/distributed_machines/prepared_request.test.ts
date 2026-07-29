import { describe, expect, it, vi } from "vitest";
import {
  prepareRequest,
  PreparedRequestIdentityConflictError,
  PreparedRequestScope,
  type PreparedDispatchResult,
} from "./prepared_request";
import type {
  RequestId,
  RequestIdentity,
  RequestIdempotencyKey,
  RequestMessageId,
} from "./request_identity";

function identity(suffix = "one"): RequestIdentity {
  return {
    requestId: `request-${suffix}` as RequestId,
    messageId: `message-${suffix}` as RequestMessageId,
    idempotencyKey: `idempotency-${suffix}` as RequestIdempotencyKey,
    windowSessionId: "window-session",
  };
}

function controlled<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type DispatchResult = PreparedDispatchResult<
  { readonly accepted: true },
  { readonly kind: "succeeded" },
  "unauthorized"
>;

const disconnect = new Error("disconnected");

function prepare(options: {
  readonly scope?: PreparedRequestScope;
  readonly identity?: RequestIdentity;
  readonly retry?: "none" | "stable-id";
  readonly dispatch: (identity: RequestIdentity) => Promise<DispatchResult>;
}) {
  return prepareRequest({
    identity: options.identity ?? identity(),
    fingerprint: "immutable-request",
    scope: options.scope ?? new PreparedRequestScope("window-session"),
    retry:
      options.retry === "stable-id"
        ? { kind: "stable-id", receiverDeduplication: "required" }
        : { kind: "none" },
    dispatch: options.dispatch,
    classifyFailure: (error) =>
      error === disconnect
        ? {
            kind: "disconnect",
            retryable: true,
            admission: "definitely-not-admitted",
          }
        : { kind: "unexpected" },
  });
}

describe("PreparedRequest", () => {
  it("registers synchronously before dispatch starts", async () => {
    const order: string[] = [];
    const scope = new PreparedRequestScope("window-session");
    const originalRegister = scope.register.bind(scope);
    scope.register = (...args) => {
      order.push("registered");
      return originalRegister(...args);
    };

    const request = prepare({
      scope,
      dispatch: async () => {
        order.push("ipc");
        return { kind: "refused", reason: "unauthorized" };
      },
    });

    expect(order).toEqual(["registered"]);
    await request.admission;
    expect(order).toEqual(["registered", "ipc"]);
  });

  it("settles disposal during pending IPC without stranding the request", async () => {
    const scope = new PreparedRequestScope("window-session");
    const dispatch = controlled<DispatchResult>();
    const request = prepare({ scope, dispatch: () => dispatch.promise });
    await Promise.resolve();

    scope.dispose();

    expect(scope.inspectActiveCount()).toBe(0);
    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
    await expect(request.admission).resolves.toEqual({ kind: "disposed" });
    dispatch.resolve({ kind: "refused", reason: "unauthorized" });
    expect(scope.inspectActiveCount()).toBe(0);
  });

  it("does not start dispatch when detached before the transport microtask", async () => {
    const dispatch = vi.fn<() => Promise<DispatchResult>>();
    const request = prepare({ dispatch });

    request.detach();

    await expect(request.admission).resolves.toEqual({ kind: "disposed" });
    await expect(request.settled).resolves.toEqual({
      kind: "not-admitted",
      reason: "disposed",
    });
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("consumes and reports a late admitted rejection after in-flight disposal", async () => {
    const scope = new PreparedRequestScope("window-session");
    const dispatch = controlled<DispatchResult>();
    const authoritative = controlled<{ readonly kind: "succeeded" }>();
    const reportError = vi.fn();
    const request = prepareRequest({
      identity: identity(),
      fingerprint: "immutable-request",
      scope,
      retry: { kind: "none" },
      classifyFailure: () => ({ kind: "unexpected" }),
      reportError,
      dispatch: () => dispatch.promise,
    });
    await Promise.resolve();
    scope.dispose();
    dispatch.resolve({
      kind: "admitted",
      admission: { accepted: true },
      disposition: "fresh",
      settled: authoritative.promise,
    });
    await Promise.resolve();
    const failure = new Error("late authoritative failure");
    authoritative.reject(failure);

    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
  });

  it("models authorization refusal as typed data", async () => {
    const request = prepare({
      dispatch: async () => ({ kind: "refused", reason: "unauthorized" }),
    });

    await expect(request.admission).resolves.toEqual({
      kind: "refused",
      reason: "unauthorized",
    });
    await expect(request.settled).resolves.toEqual({
      kind: "not-admitted",
      reason: "refused",
      refusal: "unauthorized",
    });
  });

  it("keeps unexpected authorization failures as rejected errors", async () => {
    const failure = new Error("authorization dependency failed");
    const request = prepare({
      dispatch: async () => {
        throw failure;
      },
    });

    await expect(request.admission).rejects.toBe(failure);
    await expect(request.settled).rejects.toBe(failure);
  });

  it("settles a non-retryable disconnect", async () => {
    const request = prepare({
      dispatch: async () => {
        throw disconnect;
      },
    });

    await expect(request.admission).resolves.toEqual({
      kind: "disconnected",
      retryable: false,
      error: disconnect,
    });
    await expect(request.settled).resolves.toEqual({
      kind: "not-admitted",
      reason: "disconnected",
    });
  });

  it("detaches when a disconnect leaves authoritative admission unknown", async () => {
    const request = prepareRequest({
      identity: identity(),
      fingerprint: "immutable-request",
      scope: new PreparedRequestScope("window-session"),
      retry: { kind: "none" },
      dispatch: async () => {
        throw disconnect;
      },
      classifyFailure: () => ({
        kind: "disconnect",
        retryable: false,
        admission: "unknown",
      }),
    });

    await expect(request.admission).resolves.toMatchObject({
      kind: "disconnected",
      retryable: false,
    });
    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
  });

  it("preserves unknown admission through retryable disconnect disposal", async () => {
    const scope = new PreparedRequestScope("window-session");
    const request = prepareRequest({
      identity: identity(),
      fingerprint: "immutable-request",
      scope,
      retry: { kind: "stable-id", receiverDeduplication: "required" },
      dispatch: async () => {
        throw disconnect;
      },
      classifyFailure: () => ({
        kind: "disconnect",
        retryable: true,
        admission: "unknown",
      }),
    });

    await expect(request.admission).resolves.toMatchObject({
      kind: "disconnected",
      retryable: true,
    });
    scope.dispose();
    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
  });

  it("preserves retry eligibility and stable logical identity", async () => {
    const authoritative = controlled<{ readonly kind: "succeeded" }>();
    const identities: RequestIdentity[] = [];
    const dispatch = vi
      .fn<(stable: RequestIdentity) => Promise<DispatchResult>>()
      .mockImplementationOnce(async (stable) => {
        identities.push(stable);
        throw disconnect;
      })
      .mockImplementationOnce(async (stable) => {
        identities.push(stable);
        return {
          kind: "admitted",
          admission: { accepted: true },
          disposition: "fresh",
          settled: authoritative.promise,
        };
      });
    const request = prepare({
      retry: "stable-id",
      dispatch,
    });

    await expect(request.admission).resolves.toMatchObject({
      kind: "disconnected",
      retryable: true,
    });
    expect(request.retry.kind).toBe("enabled");
    if (request.retry.kind === "disabled") throw new Error("retry disabled");
    await expect(request.retry.dispatch()).resolves.toMatchObject({
      kind: "admitted",
    });
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
    authoritative.resolve({ kind: "succeeded" });
    await expect(request.settled).resolves.toEqual({
      kind: "completed",
      outcome: { kind: "succeeded" },
    });
  });

  it("rejects retry dispatch unless a classified disconnect grants eligibility", async () => {
    const authoritative = controlled<{ readonly kind: "succeeded" }>();
    const dispatch = vi.fn(async () => ({
      kind: "admitted" as const,
      admission: { accepted: true as const },
      disposition: "fresh" as const,
      settled: authoritative.promise,
    }));
    const request = prepare({ retry: "stable-id", dispatch });

    await expect(request.admission).resolves.toMatchObject({
      kind: "admitted",
    });
    if (request.retry.kind === "disabled") throw new Error("retry disabled");
    await expect(request.retry.dispatch()).rejects.toThrow(
      "not eligible for retry",
    );
    expect(dispatch).toHaveBeenCalledOnce();
    authoritative.resolve({ kind: "succeeded" });
  });

  it("rejects a retry that overlaps the initial unclassified attempt", async () => {
    const dispatch = controlled<DispatchResult>();
    const dispatchFn = vi.fn(() => dispatch.promise);
    const request = prepare({ retry: "stable-id", dispatch: dispatchFn });
    await Promise.resolve();

    if (request.retry.kind === "disabled") throw new Error("retry disabled");
    await expect(request.retry.dispatch()).rejects.toThrow(
      "not eligible for retry",
    );
    expect(dispatchFn).toHaveBeenCalledOnce();

    dispatch.resolve({ kind: "refused", reason: "unauthorized" });
    await expect(request.admission).resolves.toMatchObject({ kind: "refused" });
  });

  it("reports a late failure-classifier bug after disposal", async () => {
    const scope = new PreparedRequestScope("window-session");
    const dispatch = controlled<DispatchResult>();
    const classifierFailure = new Error("classifier failed");
    const reportError = vi.fn();
    const request = prepareRequest({
      identity: identity(),
      fingerprint: "immutable-request",
      scope,
      retry: { kind: "none" },
      dispatch: () => dispatch.promise,
      classifyFailure: () => {
        throw classifierFailure;
      },
      reportError,
    });
    await Promise.resolve();
    scope.dispose();
    dispatch.reject(disconnect);

    await expect(request.settled).resolves.toEqual({
      kind: "detached",
      authoritativeOperationMayContinue: true,
    });
    await vi.waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(classifierFailure),
    );
  });

  it("rejects conflicting RequestId reuse and removes registrations in finally", async () => {
    const scope = new PreparedRequestScope("window-session");
    const pending = controlled<DispatchResult>();
    const stable = identity();
    const first = prepare({
      scope,
      identity: stable,
      dispatch: () => pending.promise,
    });
    expect(scope.inspectActiveCount()).toBe(1);

    expect(() =>
      prepareRequest({
        identity: { ...stable, messageId: "other" as RequestMessageId },
        fingerprint: "conflict",
        scope,
        retry: { kind: "none" },
        classifyFailure: () => ({ kind: "unexpected" }),
        dispatch: () => pending.promise,
      }),
    ).toThrow(PreparedRequestIdentityConflictError);

    pending.resolve({ kind: "refused", reason: "unauthorized" });
    await first.settled;
    expect(scope.inspectActiveCount()).toBe(0);
  });
});
