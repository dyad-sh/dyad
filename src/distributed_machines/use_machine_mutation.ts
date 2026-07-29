import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PreparedAdmission,
  PreparedRequest,
  PreparedRequestSettlement,
} from "./prepared_request";
import type {
  ObservedRevisionToken,
  RemoteConnectionStatus,
} from "./remote_client";

export type MachineMutationAdmission<Admission, Refusal> =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing" }
  | {
      readonly kind: "admitted";
      readonly admission: Admission;
      readonly disposition: "fresh" | "replayed" | "coalesced";
    }
  | {
      readonly kind: "refused";
      readonly reason: Refusal | "disconnected" | "disposed";
      readonly retryable: boolean;
    };

export type MachineMutationExecution<Failure = unknown> =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "succeeded" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed"; readonly error: Failure };

export type MachineMutationTerminalExecution<Failure = unknown> = Exclude<
  MachineMutationExecution<Failure>,
  { readonly kind: "idle" } | { readonly kind: "running" }
>;

export interface UseMachineMutationOptions<
  Input,
  Admission,
  Outcome,
  Refusal,
  Failure,
> {
  readonly connection: RemoteConnectionStatus;
  readonly snapshot:
    | { readonly kind: "unavailable" }
    | {
        readonly kind: "available";
        readonly observedRevision: ObservedRevisionToken;
      };
  readonly request: (
    input: Input,
    observedRevision: ObservedRevisionToken | undefined,
  ) => PreparedRequest<Admission, Outcome, Refusal>;
  readonly classifyOutcome: (
    outcome: Outcome,
  ) => MachineMutationTerminalExecution<Failure>;
  readonly onUnexpectedError?: (error: unknown) => void;
  /**
   * Parallel ownership preserves every caller's authoritative promise while
   * projecting only the newest request into presentation state.
   */
  readonly requestOwnership?: "supersede" | "parallel";
}

export interface MachineMutation<Input, Admission, Outcome, Refusal, Failure> {
  readonly connection: RemoteConnectionStatus;
  readonly snapshot: UseMachineMutationOptions<
    Input,
    Admission,
    Outcome,
    Refusal,
    Failure
  >["snapshot"];
  readonly admission: MachineMutationAdmission<Admission, Refusal>;
  readonly execution: MachineMutationExecution<Failure>;
  mutate(input: Input): Promise<PreparedRequestSettlement<Outcome, Refusal>>;
  retry(): Promise<PreparedAdmission<Admission, Refusal> | undefined>;
}

/**
 * Handwritten framework helper. Presentation remains domain-owned; this hook
 * only exposes orthogonal transport, snapshot, admission, and execution facts.
 */
export function useMachineMutation<
  Input,
  Admission,
  Outcome,
  Refusal,
  Failure = unknown,
>(
  options: UseMachineMutationOptions<
    Input,
    Admission,
    Outcome,
    Refusal,
    Failure
  >,
): MachineMutation<Input, Admission, Outcome, Refusal, Failure> {
  const [admission, setAdmission] = useState<
    MachineMutationAdmission<Admission, Refusal>
  >({ kind: "idle" });
  const [execution, setExecution] = useState<MachineMutationExecution<Failure>>(
    { kind: "idle" },
  );
  const active = useRef<
    | {
        generation: number;
        request: PreparedRequest<Admission, Outcome, Refusal>;
      }
    | undefined
  >(undefined);
  const inFlight = useRef(
    new Set<PreparedRequest<Admission, Outcome, Refusal>>(),
  );
  const mounted = useRef(true);
  const nextGeneration = useRef(0);
  const { request, snapshot, classifyOutcome, onUnexpectedError } = options;
  const observedRevision =
    snapshot.kind === "available" ? snapshot.observedRevision : undefined;
  const reportUnexpected = useCallback(
    (error: unknown): void => {
      try {
        onUnexpectedError?.(error);
      } catch {
        // Presentation/telemetry failures cannot replace the real failure.
      }
    },
    [onUnexpectedError],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const request of inFlight.current) request.detach();
      inFlight.current.clear();
      active.current = undefined;
    };
  }, []);

  const applyAdmission = useCallback(
    (
      generation: number,
      result: PreparedAdmission<Admission, Refusal>,
    ): void => {
      if (!mounted.current || active.current?.generation !== generation) return;
      switch (result.kind) {
        case "admitted":
          setAdmission({
            kind: "admitted",
            admission: result.admission,
            disposition: result.disposition,
          });
          setExecution({ kind: "running" });
          return;
        case "refused":
          setAdmission({
            kind: "refused",
            reason: result.reason,
            retryable: false,
          });
          return;
        case "disconnected":
          setAdmission({
            kind: "refused",
            reason: "disconnected",
            retryable: result.retryable,
          });
          return;
        case "disposed":
          setAdmission({
            kind: "refused",
            reason: "disposed",
            retryable: false,
          });
          return;
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    },
    [],
  );

  const mutate = useCallback(
    async (
      input: Input,
    ): Promise<PreparedRequestSettlement<Outcome, Refusal>> => {
      if (!mounted.current) {
        return { kind: "not-admitted", reason: "disposed" };
      }
      if (options.requestOwnership === "supersede") {
        active.current?.request.detach();
      }
      active.current = undefined;
      const generation = ++nextGeneration.current;
      setAdmission({ kind: "preparing" });
      setExecution({ kind: "idle" });
      let authoritativeAdmissionAccepted = false;
      let prepared: PreparedRequest<Admission, Outcome, Refusal> | undefined;
      try {
        // request() synchronously creates and registers its client handle.
        prepared = request(input, observedRevision);
        if (!mounted.current || nextGeneration.current !== generation) {
          prepared.detach();
          return prepared.settled;
        }
        inFlight.current.add(prepared);
        active.current = { generation, request: prepared };
        const admissionResult = await prepared.admission;
        authoritativeAdmissionAccepted = admissionResult.kind === "admitted";
        applyAdmission(generation, admissionResult);
        const settlement = await prepared.settled;
        if (!mounted.current || active.current?.generation !== generation) {
          return settlement;
        }
        if (settlement.kind === "completed") {
          setExecution(classifyOutcome(settlement.outcome));
        }
        return settlement;
      } catch (error) {
        const isCurrent =
          mounted.current &&
          nextGeneration.current === generation &&
          (active.current === undefined ||
            active.current.generation === generation);
        if (isCurrent) {
          if (!authoritativeAdmissionAccepted) {
            setAdmission({ kind: "idle" });
          }
          setExecution({ kind: "failed", error: error as Failure });
          reportUnexpected(error);
        }
        throw error;
      } finally {
        if (prepared) inFlight.current.delete(prepared);
        if (active.current?.generation === generation) {
          active.current = undefined;
        }
      }
    },
    [
      applyAdmission,
      classifyOutcome,
      observedRevision,
      reportUnexpected,
      request,
      options.requestOwnership,
    ],
  );

  const retry = useCallback(async () => {
    const current = active.current;
    if (!current || current.request.retry.kind === "disabled") return undefined;
    const previousAdmission = admission;
    setAdmission({ kind: "preparing" });
    try {
      const result = await current.request.retry.dispatch();
      applyAdmission(current.generation, result);
      return result;
    } catch (error) {
      const isCurrent =
        mounted.current && nextGeneration.current === current.generation;
      if (isCurrent) {
        setAdmission(previousAdmission);
        setExecution({ kind: "failed", error: error as Failure });
        reportUnexpected(error);
      }
      throw error;
    }
  }, [admission, applyAdmission, reportUnexpected]);

  return {
    connection: options.connection,
    snapshot: options.snapshot,
    admission,
    execution,
    mutate,
    retry,
  };
}
