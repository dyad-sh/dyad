import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import {
  observeDomainRevision,
  type ObservedRevisionToken,
} from "./remote_client";
import type {
  PreparedAdmission,
  PreparedRequest,
  PreparedRequestSettlement,
} from "./prepared_request";
import { useMachineMutation } from "./use_machine_mutation";

interface Outcome {
  readonly kind: "succeeded" | "cancelled" | "superseded";
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

function fakeRequest(
  admission: ReturnType<typeof controlled<PreparedAdmission<string, string>>>,
  settled: ReturnType<
    typeof controlled<PreparedRequestSettlement<Outcome, string>>
  >,
  detach = vi.fn(),
  retry?: () => Promise<PreparedAdmission<string, string>>,
): PreparedRequest<string, Outcome, string> {
  return {
    identity: {
      requestId: "request" as never,
      messageId: "message" as never,
      idempotencyKey: "idempotency" as never,
      windowSessionId: "window",
    },
    requestId: "request" as never,
    admission: admission.promise,
    settled: settled.promise,
    retry: retry ? { kind: "enabled", dispatch: retry } : { kind: "disabled" },
    detach,
  };
}

const unavailable = { kind: "unavailable" } as const;

function classify(outcome: Outcome) {
  switch (outcome.kind) {
    case "succeeded":
      return { kind: "succeeded" } as const;
    case "cancelled":
      return { kind: "cancelled" } as const;
    case "superseded":
      return { kind: "superseded" } as const;
  }
}

describe("useMachineMutation", () => {
  it("keeps connection, snapshot, admission, and execution orthogonal", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const request = vi.fn(() => fakeRequest(admission, settled));
    const firstRevision = observeDomainRevision("document", 1);
    const { result, rerender } = renderHook(
      (props: {
        connection: "ready" | "disconnected";
        snapshot:
          | typeof unavailable
          | {
              readonly kind: "available";
              readonly observedRevision: ObservedRevisionToken;
            };
      }) =>
        useMachineMutation({
          ...props,
          request,
          classifyOutcome: classify,
        }),
      {
        initialProps: {
          connection: "ready",
          snapshot: unavailable,
        } as {
          connection: "ready" | "disconnected";
          snapshot:
            | typeof unavailable
            | {
                readonly kind: "available";
                readonly observedRevision: ObservedRevisionToken;
              };
        },
      },
    );

    let mutation!: Promise<PreparedRequestSettlement<Outcome, string>>;
    act(() => {
      mutation = result.current.mutate("input");
    });
    expect(result.current.admission.kind).toBe("preparing");
    expect(result.current.execution.kind).toBe("idle");

    rerender({
      connection: "disconnected",
      snapshot: {
        kind: "available",
        observedRevision: firstRevision,
      },
    });
    expect(result.current.connection).toBe("disconnected");
    expect(result.current.snapshot.kind).toBe("available");
    expect(result.current.admission.kind).toBe("preparing");
    expect(result.current.execution.kind).toBe("idle");

    act(() =>
      admission.resolve({
        kind: "refused",
        reason: "unauthorized",
      }),
    );
    act(() =>
      settled.resolve({
        kind: "not-admitted",
        reason: "refused",
        refusal: "unauthorized",
      }),
    );
    await act(async () => mutation);
  });

  it("keeps typed refusal out of the unexpected error path", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const onUnexpectedError = vi.fn();
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () => fakeRequest(admission, settled),
        classifyOutcome: classify,
        onUnexpectedError,
      }),
    );

    let mutation!: Promise<PreparedRequestSettlement<Outcome, string>>;
    act(() => {
      mutation = result.current.mutate("input");
      admission.resolve({ kind: "refused", reason: "unauthorized" });
      settled.resolve({
        kind: "not-admitted",
        reason: "refused",
        refusal: "unauthorized",
      });
    });
    await act(async () => mutation);

    expect(result.current.admission).toEqual({
      kind: "refused",
      reason: "unauthorized",
      retryable: false,
    });
    expect(result.current.execution).toEqual({ kind: "idle" });
    expect(onUnexpectedError).not.toHaveBeenCalled();
  });

  it("drives success only from authoritative settlement", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () => fakeRequest(admission, settled),
        classifyOutcome: classify,
      }),
    );

    let mutation!: Promise<PreparedRequestSettlement<Outcome, string>>;
    act(() => {
      mutation = result.current.mutate("input");
      admission.resolve({
        kind: "admitted",
        admission: "accepted",
        disposition: "fresh",
      });
    });
    await waitFor(() => expect(result.current.execution.kind).toBe("running"));
    expect(result.current.execution.kind).not.toBe("succeeded");

    act(() =>
      settled.resolve({
        kind: "completed",
        outcome: { kind: "succeeded" },
      }),
    );
    await act(async () => mutation);
    await waitFor(() =>
      expect(result.current.execution).toEqual({ kind: "succeeded" }),
    );
  });

  it("preserves the observed revision captured by the rendered action", () => {
    const first = observeDomainRevision("document", 1);
    const second = observeDomainRevision("document", 2);
    const request = vi.fn(
      (_input: string, _revision: ObservedRevisionToken | undefined) => {
        const admission = controlled<PreparedAdmission<string, string>>();
        const settled =
          controlled<PreparedRequestSettlement<Outcome, string>>();
        return fakeRequest(admission, settled);
      },
    );
    const { result, rerender } = renderHook(
      ({ revision }: { revision: ObservedRevisionToken }) =>
        useMachineMutation({
          connection: "ready",
          snapshot: { kind: "available", observedRevision: revision },
          request,
          classifyOutcome: classify,
        }),
      { initialProps: { revision: first } },
    );
    const renderedAction = result.current.mutate;
    rerender({ revision: second });

    act(() => {
      void renderedAction("input");
    });

    expect(request).toHaveBeenCalledWith("input", first);
  });

  it("retains concurrent requests until settlement and detaches them on unmount", async () => {
    const firstAdmission = controlled<PreparedAdmission<string, string>>();
    const firstSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const firstDetach = vi.fn();
    const secondAdmission = controlled<PreparedAdmission<string, string>>();
    const secondSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const secondDetach = vi.fn();
    const requests = [
      fakeRequest(firstAdmission, firstSettlement, firstDetach),
      fakeRequest(secondAdmission, secondSettlement, secondDetach),
    ];
    const { result, unmount } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () => requests.shift()!,
        classifyOutcome: classify,
      }),
    );

    act(() => {
      void result.current.mutate("first");
      void result.current.mutate("second");
      secondAdmission.resolve({
        kind: "admitted",
        admission: "accepted",
        disposition: "fresh",
      });
      firstSettlement.resolve({
        kind: "completed",
        outcome: { kind: "succeeded" },
      });
    });
    expect(firstDetach).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.execution.kind).toBe("running"));

    unmount();
    expect(secondDetach).toHaveBeenCalledOnce();
    expect(firstDetach).toHaveBeenCalledOnce();
  });

  it("keeps parallel caller promises owned until their own settlements", async () => {
    const firstAdmission = controlled<PreparedAdmission<string, string>>();
    const firstSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const firstDetach = vi.fn();
    const secondAdmission = controlled<PreparedAdmission<string, string>>();
    const secondSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const secondDetach = vi.fn();
    const requests = [
      fakeRequest(firstAdmission, firstSettlement, firstDetach),
      fakeRequest(secondAdmission, secondSettlement, secondDetach),
    ];
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () => requests.shift()!,
        classifyOutcome: classify,
        requestOwnership: "parallel",
      }),
    );

    let first!: Promise<PreparedRequestSettlement<Outcome, string>>;
    let second!: Promise<PreparedRequestSettlement<Outcome, string>>;
    act(() => {
      first = result.current.mutate("first");
      second = result.current.mutate("second");
      firstAdmission.resolve({
        kind: "admitted",
        admission: "accepted",
        disposition: "fresh",
      });
      secondAdmission.resolve({
        kind: "admitted",
        admission: "accepted",
        disposition: "fresh",
      });
    });
    expect(firstDetach).not.toHaveBeenCalled();

    act(() => {
      secondSettlement.resolve({
        kind: "completed",
        outcome: { kind: "succeeded" },
      });
    });
    await second;
    let firstResolved = false;
    void first.then(() => {
      firstResolved = true;
    });
    await act(async () => Promise.resolve());
    expect(firstResolved).toBe(false);

    act(() => {
      firstSettlement.resolve({
        kind: "completed",
        outcome: { kind: "succeeded" },
      });
    });
    await first;
    expect(firstDetach).not.toHaveBeenCalled();
    expect(secondDetach).not.toHaveBeenCalled();
  });

  it("retries only through the prepared stable request handle", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const retry = vi.fn(async () => ({
      kind: "admitted" as const,
      admission: "accepted",
      disposition: "coalesced" as const,
    }));
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "disconnected",
        snapshot: unavailable,
        request: () => fakeRequest(admission, settled, vi.fn(), retry),
        classifyOutcome: classify,
      }),
    );
    act(() => {
      void result.current.mutate("input");
      admission.resolve({
        kind: "disconnected",
        retryable: true,
        error: new Error("offline"),
      });
    });
    await waitFor(() =>
      expect(result.current.admission).toMatchObject({
        kind: "refused",
        retryable: true,
      }),
    );

    await act(async () => {
      await result.current.retry();
    });

    expect(retry).toHaveBeenCalledOnce();
    expect(result.current.admission).toMatchObject({
      kind: "admitted",
      disposition: "coalesced",
    });
  });

  it("restores admission when a current retry rejects", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const retryFailure = new Error("retry transport failed");
    const onUnexpectedError = vi.fn();
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () =>
          fakeRequest(admission, settled, vi.fn(), async () => {
            throw retryFailure;
          }),
        classifyOutcome: classify,
        onUnexpectedError,
      }),
    );
    act(() => {
      void result.current.mutate("input");
      admission.resolve({
        kind: "disconnected",
        retryable: true,
        error: new Error("offline"),
      });
    });
    await waitFor(() =>
      expect(result.current.admission).toMatchObject({
        kind: "refused",
        reason: "disconnected",
        retryable: true,
      }),
    );

    await act(async () => {
      await expect(result.current.retry()).rejects.toBe(retryFailure);
    });

    expect(result.current.admission).toMatchObject({
      kind: "refused",
      reason: "disconnected",
      retryable: true,
    });
    expect(result.current.execution).toEqual({
      kind: "failed",
      error: retryFailure,
    });
    expect(onUnexpectedError).toHaveBeenCalledWith(retryFailure);
  });

  it("restores admission when settlement rejection clears active ownership before retry rejection", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const retry = controlled<PreparedAdmission<string, string>>();
    const failure = new Error("shared terminal failure");
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () =>
          fakeRequest(admission, settled, vi.fn(), () => retry.promise),
        classifyOutcome: classify,
      }),
    );
    let mutation!: Promise<PreparedRequestSettlement<Outcome, string>>;
    act(() => {
      mutation = result.current.mutate("input");
      admission.resolve({
        kind: "disconnected",
        retryable: true,
        error: new Error("offline"),
      });
    });
    await waitFor(() =>
      expect(result.current.admission).toMatchObject({
        kind: "refused",
        retryable: true,
      }),
    );
    const retrying = result.current.retry();

    settled.reject(failure);
    await expect(mutation).rejects.toBe(failure);
    retry.reject(failure);
    await expect(retrying).rejects.toBe(failure);

    await waitFor(() =>
      expect(result.current.admission).toMatchObject({
        kind: "refused",
        reason: "disconnected",
        retryable: true,
      }),
    );
  });

  it("remains active after StrictMode effect replay", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(StrictMode, undefined, children);
    const { result } = renderHook(
      () =>
        useMachineMutation({
          connection: "ready",
          snapshot: unavailable,
          request: () => fakeRequest(admission, settled),
          classifyOutcome: classify,
        }),
      { wrapper },
    );

    act(() => {
      void result.current.mutate("input");
      admission.resolve({
        kind: "admitted",
        admission: "accepted",
        disposition: "fresh",
      });
      settled.resolve({
        kind: "completed",
        outcome: { kind: "succeeded" },
      });
    });

    await waitFor(() =>
      expect(result.current.execution).toEqual({ kind: "succeeded" }),
    );
  });

  it("reports synchronous request preparation failures and clears stale ownership", async () => {
    const failure = new Error("identity conflict");
    const onUnexpectedError = vi.fn();
    const request = vi.fn(() => {
      throw failure;
    });
    const { result } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request,
        classifyOutcome: classify,
        onUnexpectedError,
      }),
    );

    await expect(result.current.mutate("input")).rejects.toBe(failure);

    await waitFor(() =>
      expect(result.current.execution).toEqual({
        kind: "failed",
        error: failure,
      }),
    );
    expect(result.current.admission).toEqual({ kind: "idle" });
    expect(onUnexpectedError).toHaveBeenCalledWith(failure);
    await expect(result.current.retry()).resolves.toBeUndefined();
  });

  it("detaches an outer request superseded by synchronous request reentry", () => {
    const outerAdmission = controlled<PreparedAdmission<string, string>>();
    const outerSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const innerAdmission = controlled<PreparedAdmission<string, string>>();
    const innerSettlement =
      controlled<PreparedRequestSettlement<Outcome, string>>();
    const outerDetach = vi.fn();
    const innerDetach = vi.fn();
    let reenter: ((input: string) => unknown) | undefined;
    const request = vi.fn((input: string) => {
      if (input === "outer") {
        reenter?.("inner");
        return fakeRequest(outerAdmission, outerSettlement, outerDetach);
      }
      return fakeRequest(innerAdmission, innerSettlement, innerDetach);
    });
    const { result, unmount } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request,
        classifyOutcome: classify,
      }),
    );
    reenter = result.current.mutate;

    act(() => {
      void result.current.mutate("outer");
    });

    expect(request).toHaveBeenNthCalledWith(1, "outer", undefined);
    expect(request).toHaveBeenNthCalledWith(2, "inner", undefined);
    expect(outerDetach).toHaveBeenCalledOnce();
    expect(innerDetach).not.toHaveBeenCalled();

    unmount();
    expect(innerDetach).toHaveBeenCalledOnce();
  });

  it("does not create request ownership through a retained callback after unmount", async () => {
    const request = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request,
        classifyOutcome: classify,
      }),
    );
    const retainedMutate = result.current.mutate;
    unmount();

    await expect(retainedMutate("input")).resolves.toEqual({
      kind: "not-admitted",
      reason: "disposed",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not report a stale retry failure after unmount", async () => {
    const admission = controlled<PreparedAdmission<string, string>>();
    const settled = controlled<PreparedRequestSettlement<Outcome, string>>();
    const retry = controlled<PreparedAdmission<string, string>>();
    const onUnexpectedError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMachineMutation({
        connection: "ready",
        snapshot: unavailable,
        request: () =>
          fakeRequest(admission, settled, vi.fn(), () => retry.promise),
        classifyOutcome: classify,
        onUnexpectedError,
      }),
    );
    act(() => {
      void result.current.mutate("input");
      admission.resolve({
        kind: "disconnected",
        retryable: true,
        error: new Error("offline"),
      });
    });
    await waitFor(() =>
      expect(result.current.admission).toMatchObject({
        kind: "refused",
        retryable: true,
      }),
    );
    const retrying = result.current.retry();
    unmount();
    const failure = new Error("late retry failure");
    retry.reject(failure);

    await expect(retrying).rejects.toBe(failure);
    expect(onUnexpectedError).not.toHaveBeenCalled();
  });
});
