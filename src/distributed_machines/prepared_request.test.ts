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
        ? { kind: "disconnect", retryable: true }
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
      kind: "not-admitted",
      reason: "disposed",
    });
    await expect(request.admission).resolves.toEqual({ kind: "disposed" });
    dispatch.resolve({ kind: "refused", reason: "unauthorized" });
    expect(scope.inspectActiveCount()).toBe(0);
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
