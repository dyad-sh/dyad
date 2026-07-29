import type { RequestIdentity, RequestId } from "./request_identity";

export type AdmissionRefusal<Reason> = {
  readonly kind: "refused";
  readonly reason: Reason;
};

export type PreparedAdmission<Admission, Refusal> =
  | {
      readonly kind: "admitted";
      readonly admission: Admission;
      readonly disposition: "fresh" | "replayed" | "coalesced";
    }
  | AdmissionRefusal<Refusal>
  | {
      readonly kind: "disconnected";
      readonly retryable: boolean;
      readonly error: unknown;
    }
  | {
      readonly kind: "disposed";
    };

export type RequestNotAdmitted<Refusal> = {
  readonly kind: "not-admitted";
  readonly reason: "refused" | "disconnected" | "disposed";
  readonly refusal?: Refusal;
};

export type RequestDetached = {
  readonly kind: "detached";
  readonly authoritativeOperationMayContinue: true;
};

export type PreparedRequestSettlement<Outcome, Refusal> =
  | { readonly kind: "completed"; readonly outcome: Outcome }
  | RequestNotAdmitted<Refusal>
  | RequestDetached;

export type PreparedDispatchResult<Admission, Outcome, Refusal> =
  | {
      readonly kind: "admitted";
      readonly admission: Admission;
      readonly disposition: "fresh" | "replayed" | "coalesced";
      readonly settled: Promise<Outcome>;
    }
  | AdmissionRefusal<Refusal>;

export type PreparedRequestFailureClassification =
  | {
      readonly kind: "disconnect";
      readonly retryable: boolean;
      /**
       * A lost response cannot prove that main did not accept the request.
       * Only failures classified at a pre-delivery boundary may claim that no
       * authoritative operation exists.
       */
      readonly admission: "definitely-not-admitted" | "unknown";
    }
  | { readonly kind: "unexpected" };

export interface PreparedRequest<Admission, Outcome, Refusal> {
  readonly identity: RequestIdentity;
  readonly requestId: RequestId;
  readonly admission: Promise<PreparedAdmission<Admission, Refusal>>;
  readonly settled: Promise<PreparedRequestSettlement<Outcome, Refusal>>;
  readonly retry:
    | { readonly kind: "disabled" }
    | {
        readonly kind: "enabled";
        dispatch(): Promise<PreparedAdmission<Admission, Refusal>>;
      };
  /**
   * Releases client ownership. Before admission this refuses the local request;
   * after admission it detaches without pretending main-owned work stopped.
   */
  detach(): void;
}

export class PreparedRequestIdentityConflictError extends Error {
  constructor(readonly requestId: RequestId) {
    super(`RequestId ${requestId} was reused with conflicting identity`);
    this.name = "PreparedRequestIdentityConflictError";
  }
}

interface ActivePreparedRequest {
  readonly identity: RequestIdentity;
  readonly fingerprint: string;
  readonly dispose: () => void;
}

/**
 * Owns only client/pre-admission request registrations for one renderer
 * window-session lifetime.
 */
export class PreparedRequestScope {
  private readonly active = new Map<RequestId, ActivePreparedRequest>();
  private disposed = false;

  constructor(readonly windowSessionId: string) {
    if (windowSessionId.length === 0) {
      throw new Error(
        "PreparedRequestScope requires a window-session identity",
      );
    }
  }

  register(
    identity: RequestIdentity,
    fingerprint: string,
    dispose: () => void,
  ): () => void {
    if (identity.windowSessionId !== this.windowSessionId) {
      throw new Error(
        "Prepared request does not belong to this window-session lifetime",
      );
    }
    if (this.disposed) {
      dispose();
      return () => undefined;
    }
    const existing = this.active.get(identity.requestId);
    if (existing) {
      if (
        existing.fingerprint !== fingerprint ||
        existing.identity.messageId !== identity.messageId ||
        existing.identity.idempotencyKey !== identity.idempotencyKey ||
        existing.identity.windowSessionId !== identity.windowSessionId
      ) {
        throw new PreparedRequestIdentityConflictError(identity.requestId);
      }
      throw new Error(`RequestId ${identity.requestId} is already active`);
    }
    const registration = { identity, fingerprint, dispose };
    this.active.set(identity.requestId, registration);
    return () => {
      if (this.active.get(identity.requestId) === registration) {
        this.active.delete(identity.requestId);
      }
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const active = [...this.active.values()];
    for (const registration of active) registration.dispose();
    this.active.clear();
  }

  inspectActiveCount(): number {
    return this.active.size;
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export interface PrepareRequestOptions<Admission, Outcome, Refusal> {
  readonly identity: RequestIdentity;
  /** Complete immutable request fingerprint, excluding delivery timing. */
  readonly fingerprint: string;
  readonly scope: PreparedRequestScope;
  readonly retry:
    | { readonly kind: "none" }
    | {
        readonly kind: "stable-id";
        readonly receiverDeduplication: "required";
      };
  readonly dispatch: (
    identity: RequestIdentity,
    signal: AbortSignal,
  ) => Promise<PreparedDispatchResult<Admission, Outcome, Refusal>>;
  readonly classifyFailure: (
    error: unknown,
  ) => PreparedRequestFailureClassification;
  readonly reportError?: (error: unknown) => void;
}

/**
 * Registers the owner rejector synchronously, then invokes transport dispatch.
 */
export function prepareRequest<Admission, Outcome, Refusal>(
  options: PrepareRequestOptions<Admission, Outcome, Refusal>,
): PreparedRequest<Admission, Outcome, Refusal> {
  const identity = Object.freeze({ ...options.identity });
  const firstAdmission = deferred<PreparedAdmission<Admission, Refusal>>();
  const terminal = deferred<PreparedRequestSettlement<Outcome, Refusal>>();
  let firstAdmissionPending = true;
  let terminalPending = true;
  let admitted = false;
  let dispatchInFlight = false;
  let admissionMayHaveOccurred = false;
  let retryEligible = false;
  const detached = new AbortController();
  let attemptPending:
    | Promise<PreparedAdmission<Admission, Refusal>>
    | undefined;
  let pendingAttemptIsRetry = false;

  const settleTerminal = (
    value: PreparedRequestSettlement<Outcome, Refusal>,
  ): boolean => {
    if (!terminalPending) return false;
    terminalPending = false;
    terminal.resolve(value);
    return true;
  };
  const rejectTerminal = (error: unknown): boolean => {
    if (!terminalPending) return false;
    terminalPending = false;
    terminal.reject(error);
    return true;
  };
  const releaseRegistration = options.scope.register(
    identity,
    options.fingerprint,
    () => {
      detached.abort();
      if (firstAdmissionPending) {
        firstAdmissionPending = false;
        firstAdmission.resolve({ kind: "disposed" });
      }
      settleTerminal(
        admitted || dispatchInFlight || admissionMayHaveOccurred
          ? { kind: "detached", authoritativeOperationMayContinue: true }
          : { kind: "not-admitted", reason: "disposed" },
      );
    },
  );
  void terminal.promise.then(releaseRegistration, releaseRegistration);

  const dispatchAttempt = (
    retryAttempt = false,
  ): Promise<PreparedAdmission<Admission, Refusal>> => {
    if (!terminalPending) {
      return Promise.reject(new Error("Prepared request is already settled"));
    }
    if (attemptPending) {
      if (!retryAttempt || pendingAttemptIsRetry) return attemptPending;
      return Promise.reject(
        new Error("Prepared request is not eligible for retry"),
      );
    }
    if (retryAttempt && !retryEligible) {
      return Promise.reject(
        new Error("Prepared request is not eligible for retry"),
      );
    }
    if (retryAttempt) retryEligible = false;
    pendingAttemptIsRetry = retryAttempt;
    const attempt = Promise.resolve()
      .then<
        | PreparedDispatchResult<Admission, Outcome, Refusal>
        | { readonly kind: "disposed" }
      >(() => {
        if (!terminalPending) {
          return { kind: "disposed" } as const;
        }
        dispatchInFlight = true;
        return options.dispatch(identity, detached.signal);
      })
      .then(
        (result): PreparedAdmission<Admission, Refusal> => {
          if (result.kind === "disposed") {
            return result;
          }
          if (result.kind === "refused") {
            retryEligible = false;
            settleTerminal(
              admissionMayHaveOccurred
                ? {
                    kind: "detached",
                    authoritativeOperationMayContinue: true,
                  }
                : {
                    kind: "not-admitted",
                    reason: "refused",
                    refusal: result.reason,
                  },
            );
            return result;
          }
          admitted = true;
          retryEligible = false;
          void result.settled.then(
            (outcome) =>
              settleTerminal({
                kind: "completed",
                outcome,
              }),
            (error) => {
              if (!rejectTerminal(error)) {
                try {
                  options.reportError?.(error);
                } catch {
                  // Reporting cannot replace the authoritative failure.
                }
              }
            },
          );
          return {
            kind: "admitted",
            admission: result.admission,
            disposition: result.disposition,
          };
        },
        (error): PreparedAdmission<Admission, Refusal> => {
          let classification: PreparedRequestFailureClassification;
          try {
            classification = options.classifyFailure(error);
          } catch (classificationError) {
            if (!rejectTerminal(classificationError)) {
              try {
                options.reportError?.(classificationError);
              } catch {
                // Reporting cannot replace the classifier failure.
              }
            }
            throw classificationError;
          }
          if (classification.kind === "unexpected") {
            if (!rejectTerminal(error)) {
              try {
                options.reportError?.(error);
              } catch {
                // Reporting cannot replace the transport failure.
              }
            }
            throw error;
          }
          const retryable =
            classification.retryable && options.retry.kind === "stable-id";
          admissionMayHaveOccurred ||= classification.admission === "unknown";
          retryEligible = retryable;
          if (!retryable) {
            settleTerminal(
              admissionMayHaveOccurred
                ? {
                    kind: "detached",
                    authoritativeOperationMayContinue: true,
                  }
                : { kind: "not-admitted", reason: "disconnected" },
            );
          }
          return { kind: "disconnected", retryable, error };
        },
      )
      .finally(() => {
        dispatchInFlight = false;
        if (attemptPending === attempt) {
          attemptPending = undefined;
          pendingAttemptIsRetry = false;
        }
      });
    attemptPending = attempt;
    return attempt;
  };

  const initialAttempt = dispatchAttempt();
  void initialAttempt.then(
    (result) => {
      if (!firstAdmissionPending) return;
      firstAdmissionPending = false;
      firstAdmission.resolve(result);
    },
    (error) => {
      if (!firstAdmissionPending) return;
      firstAdmissionPending = false;
      firstAdmission.reject(error);
    },
  );

  return {
    identity,
    requestId: identity.requestId,
    admission: firstAdmission.promise,
    settled: terminal.promise,
    retry:
      options.retry.kind === "stable-id"
        ? {
            kind: "enabled",
            dispatch: () => dispatchAttempt(true),
          }
        : { kind: "disabled" },
    detach() {
      detached.abort();
      if (firstAdmissionPending) {
        firstAdmissionPending = false;
        firstAdmission.resolve({ kind: "disposed" });
      }
      settleTerminal(
        admitted || dispatchInFlight || admissionMayHaveOccurred
          ? { kind: "detached", authoritativeOperationMayContinue: true }
          : { kind: "not-admitted", reason: "disposed" },
      );
    },
  };
}
