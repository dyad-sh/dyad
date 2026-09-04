/**
 * Main-authoritative connection-flow resource registry.
 *
 * The specialized timer and provider-resource ownership remains here. Remote
 * intents are admitted against an authoritative revision, while all
 * cross-lifetime correlation uses a typed invocation reference minted by the
 * shared IdSource and claimed through InvocationRegistry.
 */

import { systemClock, uuidIdSource } from "@/state_machines/clock";
import type { Clock, IdSource } from "@/state_machines/clock";
import {
  createInvocationRef,
  InvocationRegistry,
  sameInvocationRef,
} from "@/state_machines/invocation_ref";
import { createTraceObserver } from "@/state_machines/trace";
import type { TransitionObserver } from "@/state_machines/types";
import {
  CONNECTION_FLOW_INVOCATION_KIND,
  CONNECTION_FLOW_PROVIDERS,
  DISCONNECTED_FLOW_STATE,
  type ConnectionFlowEvent,
  type ConnectionFlowFailureReason,
  type ConnectionFlowInvocationRef,
  type ConnectionFlowProvider,
  type ConnectionFlowState,
  isActiveFlowState,
} from "./state";
import { transition, type IgnoreReason } from "./transition";

export const DEFAULT_FLOW_TIMEOUTS_MS: Record<
  ConnectionFlowProvider,
  number | null
> = {
  neon: 5 * 60_000,
  supabase: 5 * 60_000,
  github: null,
};

export interface ConnectionFlowRegistryOptions {
  onStateChange?: (
    provider: ConnectionFlowProvider,
    state: ConnectionFlowState,
    previous: ConnectionFlowState,
  ) => void;
  onUnsolicitedReturn?: (provider: ConnectionFlowProvider) => void;
  onIgnoredEvent?: (
    provider: ConnectionFlowProvider,
    event: ConnectionFlowEvent,
    reason: IgnoreReason,
  ) => void;
  observer?: TransitionObserver<
    ConnectionFlowState,
    ConnectionFlowEvent,
    never,
    IgnoreReason
  >;
  timeoutsMs?: Partial<Record<ConnectionFlowProvider, number | null>>;
  clock?: Clock;
  ids?: IdSource;
}

export type StartFlowResult =
  | {
      admitted: true;
      started: boolean;
      invocationRef: ConnectionFlowInvocationRef;
      state: ConnectionFlowState;
    }
  | {
      admitted: false;
      reason: "stale-revision" | "disposed";
      state: ConnectionFlowState;
    };

export type RevisionedIntentResult =
  | { admitted: true; applied: boolean; state: ConnectionFlowState }
  | {
      admitted: false;
      reason: "stale-revision" | "disposed";
      state: ConnectionFlowState;
    };

export type ClaimReturnResult =
  | { claimed: true; invocationRef: ConnectionFlowInvocationRef }
  | { claimed: false };

export type ConnectionFlowRegistry = ReturnType<
  typeof createConnectionFlowRegistry
>;

export function createConnectionFlowRegistry(
  options: ConnectionFlowRegistryOptions = {},
) {
  const {
    onStateChange,
    onUnsolicitedReturn,
    onIgnoredEvent,
    observer = createTraceObserver("connection_flow"),
    clock = systemClock,
    ids = uuidIdSource,
  } = options;
  const timeoutsMs = {
    ...DEFAULT_FLOW_TIMEOUTS_MS,
    ...options.timeoutsMs,
  };
  const states = new Map<ConnectionFlowProvider, ConnectionFlowState>();
  const invocations = new InvocationRegistry<ConnectionFlowProvider>();
  const pendingTimeouts = new Map<
    ConnectionFlowProvider,
    ReturnType<Clock["schedule"]>
  >();
  let disposed = false;

  function notifyIgnored(
    provider: ConnectionFlowProvider,
    state: ConnectionFlowState,
    event: ConnectionFlowEvent,
    reason: IgnoreReason,
  ): void {
    onIgnoredEvent?.(provider, event, reason);
    observer?.onEventIgnored?.({ state, event, reason });
  }

  function getState(provider: ConnectionFlowProvider): ConnectionFlowState {
    return states.get(provider) ?? DISCONNECTED_FLOW_STATE;
  }

  function getSnapshot(): Record<ConnectionFlowProvider, ConnectionFlowState> {
    const snapshot = {} as Record<ConnectionFlowProvider, ConnectionFlowState>;
    for (const provider of CONNECTION_FLOW_PROVIDERS) {
      snapshot[provider] = getState(provider);
    }
    return snapshot;
  }

  function clearPendingTimeout(provider: ConnectionFlowProvider): void {
    const handle = pendingTimeouts.get(provider);
    if (handle === undefined) return;
    pendingTimeouts.delete(provider);
    clock.cancel(handle);
  }

  function dispatch(
    provider: ConnectionFlowProvider,
    event: ConnectionFlowEvent,
  ): boolean {
    if (disposed) return false;
    const previous = getState(provider);
    const result = transition(previous, event);
    if (result.kind === "ignored") {
      notifyIgnored(provider, previous, event, result.reason);
      return false;
    }

    states.set(provider, result.state);
    clearPendingTimeout(provider);
    if (result.state.status === "awaiting-return") {
      const timeoutMs = timeoutsMs[provider];
      if (timeoutMs !== null && timeoutMs !== undefined) {
        const invocationRef = result.state.invocationRef;
        pendingTimeouts.set(
          provider,
          clock.schedule(() => {
            pendingTimeouts.delete(provider);
            dispatch(provider, { type: "timeout", invocationRef });
          }, timeoutMs),
        );
      }
    }

    onStateChange?.(provider, result.state, previous);
    observer?.onTransitionApplied?.({
      previous,
      event,
      state: result.state,
      commands: [],
    });
    return true;
  }

  function start(
    provider: ConnectionFlowProvider,
    expectedRevision: number,
  ): StartFlowResult {
    const current = getState(provider);
    if (disposed)
      return { admitted: false, reason: "disposed", state: current };
    if (current.revision !== expectedRevision) {
      return { admitted: false, reason: "stale-revision", state: current };
    }
    if (isActiveFlowState(current) && "invocationRef" in current) {
      const started = false;
      dispatch(provider, {
        type: "start",
        invocationRef: current.invocationRef,
        provider,
      });
      return {
        admitted: true,
        started,
        invocationRef: current.invocationRef,
        state: current,
      };
    }

    const invocationRef = createInvocationRef(
      CONNECTION_FLOW_INVOCATION_KIND,
      provider,
      ids,
    );
    invocations.register(invocationRef, provider);
    const started = dispatch(provider, {
      type: "start",
      invocationRef,
      provider,
    });
    return {
      admitted: true,
      started,
      invocationRef,
      state: getState(provider),
    };
  }

  function markPrepared(
    provider: ConnectionFlowProvider,
    invocationRef: ConnectionFlowInvocationRef,
    info: { userCode?: string; verificationUri?: string } = {},
  ): boolean {
    if (invocations.claim(invocationRef).kind !== "claimed") return false;
    return dispatch(provider, { type: "prepared", invocationRef, ...info });
  }

  function claimReturn(
    provider: ConnectionFlowProvider,
    expectedInvocationRef?: ConnectionFlowInvocationRef,
  ): ClaimReturnResult {
    const current = getState(provider);
    if (disposed || current.status !== "awaiting-return") {
      return { claimed: false };
    }
    const claim =
      expectedInvocationRef === undefined
        ? invocations.claimStructurally(
            CONNECTION_FLOW_INVOCATION_KIND,
            provider,
            {
              structuralSafety:
                "Test-only provider callbacks execute inside the trusted main process immediately after the one active flow is started.",
            },
          )
        : invocations.claim(expectedInvocationRef);
    if (claim.kind !== "claimed") {
      if (expectedInvocationRef !== undefined) {
        notifyIgnored(
          provider,
          current,
          { type: "return-received", invocationRef: expectedInvocationRef },
          "invocation-mismatch",
        );
      }
      return { claimed: false };
    }
    const invocationRef = claim.ref as ConnectionFlowInvocationRef;
    const claimed = dispatch(provider, {
      type: "return-received",
      invocationRef,
    });
    return claimed ? { claimed: true, invocationRef } : { claimed: false };
  }

  function completeTokenExchange(
    provider: ConnectionFlowProvider,
    invocationRef: ConnectionFlowInvocationRef,
  ): boolean {
    if (invocations.claim(invocationRef).kind !== "claimed") return false;
    return dispatch(provider, { type: "token-exchanged", invocationRef });
  }

  function notifyUnsolicitedReturn(provider: ConnectionFlowProvider): void {
    if (!disposed) onUnsolicitedReturn?.(provider);
  }

  function fail(
    provider: ConnectionFlowProvider,
    invocationRef: ConnectionFlowInvocationRef,
    reason: ConnectionFlowFailureReason,
    message?: string,
  ): boolean {
    if (invocations.claim(invocationRef).kind !== "claimed") return false;
    return dispatch(provider, {
      type: "fail",
      invocationRef,
      reason,
      message,
    });
  }

  function cancel(
    provider: ConnectionFlowProvider,
    invocationRef: ConnectionFlowInvocationRef,
  ): boolean {
    if (
      invocationRef.entityKey !== provider ||
      invocations.claim(invocationRef).kind !== "claimed"
    ) {
      return false;
    }
    return dispatch(provider, { type: "cancel", invocationRef });
  }

  function acknowledge(
    provider: ConnectionFlowProvider,
    invocationRef: ConnectionFlowInvocationRef,
    expectedRevision: number,
  ): RevisionedIntentResult {
    const current = getState(provider);
    if (disposed)
      return { admitted: false, reason: "disposed", state: current };
    if (current.revision !== expectedRevision) {
      return { admitted: false, reason: "stale-revision", state: current };
    }
    if (
      invocationRef.entityKey !== provider ||
      !("invocationRef" in current) ||
      !sameInvocationRef(current.invocationRef, invocationRef) ||
      invocations.claim(invocationRef).kind !== "claimed"
    ) {
      return { admitted: true, applied: false, state: current };
    }
    const applied = dispatch(provider, { type: "acknowledge", invocationRef });
    if (applied) invocations.delete(invocationRef);
    return { admitted: true, applied, state: getState(provider) };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const provider of CONNECTION_FLOW_PROVIDERS) {
      clearPendingTimeout(provider);
      const state = states.get(provider);
      if (state && "invocationRef" in state) {
        invocations.delete(state.invocationRef);
      }
    }
    states.clear();
  }

  return {
    getState,
    getSnapshot,
    start,
    markPrepared,
    claimReturn,
    completeTokenExchange,
    notifyUnsolicitedReturn,
    fail,
    cancel,
    acknowledge,
    dispose,
  };
}
