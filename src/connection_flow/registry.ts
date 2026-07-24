/**
 * Connection flow registry — the main process' authoritative, per-provider
 * flow controller.
 *
 * Replaces the previous module-global `currentFlowState` singleton (GitHub)
 * and the renderer-side ad-hoc timers (Neon/Supabase). Each provider has at
 * most one flow at a time, keyed by a freshly allocated `flowId`. Timeouts
 * are scheduled here and dispatched through the same pure transition
 * function as returns, so a timeout and a return are mutually exclusive:
 * whichever event arrives first wins; the loser is ignored by the machine.
 *
 * The registry itself is dependency-free (timers, id allocation and
 * broadcasting are injected) so it can be unit-tested without Electron.
 * Unlike renderer machines, it has no command channel: as an explicitly
 * constructed main-process registry it derives injected timer/broadcast
 * effects from applied transitions, keeping flowId correlation authoritative
 * in one process.
 */

import {
  CONNECTION_FLOW_PROVIDERS,
  DISCONNECTED_FLOW_STATE,
  type ConnectionFlowEvent,
  type ConnectionFlowFailureReason,
  type ConnectionFlowProvider,
  type ConnectionFlowState,
} from "./state";
import { transition, type IgnoreReason } from "./transition";
import type { TransitionObserver } from "@/state_machines/types";
import { createTraceObserver } from "@/state_machines/trace";

/**
 * How long a provider waits in `awaiting-return` before the flow times out.
 * `null` disables the registry timeout (GitHub's device flow has its own
 * expiry, surfaced by GitHub as `expired_token` during polling).
 */
export const DEFAULT_FLOW_TIMEOUTS_MS: Record<
  ConnectionFlowProvider,
  number | null
> = {
  // Generous: users routinely take well over the old renderer-side 20s to
  // finish a real browser sign-in (the 20s timer produced spurious "timed
  // out" toasts). Supabase historically had no timeout at all (a closed
  // browser left it silently stuck) and now shares the same one. A return
  // that arrives after the timeout still stores tokens via the unsolicited
  // path.
  neon: 5 * 60_000,
  supabase: 5 * 60_000,
  github: null,
};

export interface ConnectionFlowRegistryOptions {
  /** Called after every applied transition. */
  onStateChange?: (
    provider: ConnectionFlowProvider,
    state: ConnectionFlowState,
    previous: ConnectionFlowState,
  ) => void;
  /**
   * Called when an OAuth return was completed with no matching active flow
   * (cold start, app restarted mid-flow, or a return that lost the race
   * against a timeout). Tokens have already been written; the renderer
   * should refresh connection state without transitioning any flow.
   */
  onUnsolicitedReturn?: (provider: ConnectionFlowProvider) => void;
  /** Called whenever an event is ignored by the machine (for logging). */
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
  createFlowId?: (provider: ConnectionFlowProvider) => string;
  scheduleTimeout?: (callback: () => void, ms: number) => unknown;
  clearScheduledTimeout?: (handle: unknown) => void;
}

export interface StartFlowResult {
  /** flowId of the freshly started flow, or of the already-active one. */
  flowId: string;
  /** false when a flow was already active (double-start is a no-op). */
  started: boolean;
  state: ConnectionFlowState;
}

/** Result of claiming an OAuth return for an active flow. */
export type ClaimReturnResult =
  | { claimed: true; flowId: string }
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
    scheduleTimeout = (callback, ms) => setTimeout(callback, ms),
    clearScheduledTimeout = (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  const timeoutsMs: Record<ConnectionFlowProvider, number | null> = {
    ...DEFAULT_FLOW_TIMEOUTS_MS,
    ...options.timeoutsMs,
  };

  let flowCounter = 0;
  const createFlowId =
    options.createFlowId ??
    ((provider: ConnectionFlowProvider) =>
      `${provider}-${++flowCounter}-${Date.now().toString(36)}`);

  const states = new Map<ConnectionFlowProvider, ConnectionFlowState>();
  const pendingTimeouts = new Map<ConnectionFlowProvider, unknown>();

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
    if (handle !== undefined) {
      pendingTimeouts.delete(provider);
      clearScheduledTimeout(handle);
    }
  }

  /**
   * Run an event through the pure transition function and apply side
   * effects (timer scheduling, notifications). Returns whether the event
   * transitioned the machine.
   */
  function dispatch(
    provider: ConnectionFlowProvider,
    event: ConnectionFlowEvent,
  ): boolean {
    const previous = getState(provider);
    const result = transition(previous, event);
    if (result.kind === "ignored") {
      notifyIgnored(provider, previous, event, result.reason);
      return false;
    }

    states.set(provider, result.state);

    // A timeout only makes sense while we wait for the user to come back
    // from the browser; any transition away from `awaiting-return` (return,
    // cancel, failure) defuses it. The stale timer would be ignored by the
    // machine anyway (flowId + state guards), but clearing keeps it tidy.
    clearPendingTimeout(provider);
    if (result.state.status === "awaiting-return") {
      const timeoutMs = timeoutsMs[provider];
      if (timeoutMs !== null && timeoutMs !== undefined) {
        const flowId = result.state.flowId;
        pendingTimeouts.set(
          provider,
          scheduleTimeout(() => {
            pendingTimeouts.delete(provider);
            dispatch(provider, { type: "timeout", flowId });
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

  /**
   * Start a new flow. A no-op returning the active flow when one is already
   * running (double-clicking Connect must not orphan timers or duplicate
   * polling).
   */
  function start(provider: ConnectionFlowProvider): StartFlowResult {
    const current = getState(provider);
    const flowId = createFlowId(provider);
    const started = dispatch(provider, { type: "start", flowId, provider });
    if (!started) {
      return {
        flowId: "flowId" in current ? current.flowId : flowId,
        started: false,
        state: current,
      };
    }
    return { flowId, started: true, state: getState(provider) };
  }

  /**
   * Move a starting flow to `awaiting-return` (optionally attaching the
   * GitHub device-flow user code). Returns false if the flow is no longer
   * in a state that can be prepared (e.g. it was cancelled meanwhile).
   */
  function markPrepared(
    provider: ConnectionFlowProvider,
    flowId: string,
    info: { userCode?: string; verificationUri?: string } = {},
  ): boolean {
    return dispatch(provider, { type: "prepared", flowId, ...info });
  }

  /**
   * An OAuth return arrived for `provider`. If an active flow is awaiting
   * it, the flow advances to `exchanging-token` and is claimed; otherwise
   * the return is unsolicited (no pending flow, or the flow already timed
   * out/was cancelled) and the machine is left untouched.
   *
   * When the caller knows which flow produced the return (`expectedFlowId`
   * — e.g. the GitHub device poll chain carries the flowId it was started
   * for), a mismatch with the currently awaiting flow means the return is
   * stale (the user has since started a newer flow) and it is routed to the
   * unsolicited path instead of claiming — and advancing — the newer flow.
   */
  function claimReturn(
    provider: ConnectionFlowProvider,
    expectedFlowId?: string,
  ): ClaimReturnResult {
    const current = getState(provider);
    if (current.status !== "awaiting-return") {
      return { claimed: false };
    }
    if (expectedFlowId !== undefined && current.flowId !== expectedFlowId) {
      notifyIgnored(
        provider,
        current,
        { type: "return-received", flowId: expectedFlowId },
        "flow-id-mismatch",
      );
      return { claimed: false };
    }
    const claimed = dispatch(provider, {
      type: "return-received",
      flowId: current.flowId,
    });
    return claimed ? { claimed: true, flowId: current.flowId } : { claimed };
  }

  /** The token write for a claimed return succeeded. */
  function completeTokenExchange(
    provider: ConnectionFlowProvider,
    flowId: string,
  ): boolean {
    return dispatch(provider, { type: "token-exchanged", flowId });
  }

  /**
   * A token was written with no claimed flow. Notifies listeners so the
   * renderer can refresh connection state without transitioning any flow.
   * Unsolicited returns are legitimate (cold-start deep links, app restarted
   * mid-flow) — the flowId correlation exists to stop stale returns from
   * corrupting an active flow, not to reject tokens.
   */
  function notifyUnsolicitedReturn(provider: ConnectionFlowProvider): void {
    onUnsolicitedReturn?.(provider);
  }

  /** The renderer finished refreshing resources for the flow. */
  function completeResourceLoad(
    provider: ConnectionFlowProvider,
    flowId: string,
  ): boolean {
    return dispatch(provider, { type: "resources-loaded", flowId });
  }

  function fail(
    provider: ConnectionFlowProvider,
    flowId: string,
    reason: ConnectionFlowFailureReason,
    message?: string,
  ): boolean {
    return dispatch(provider, { type: "fail", flowId, reason, message });
  }

  /**
   * Cancel a flow. When `flowId` is omitted, cancels whatever flow is
   * currently active for the provider.
   */
  function cancel(provider: ConnectionFlowProvider, flowId?: string): boolean {
    const current = getState(provider);
    const targetFlowId =
      flowId ?? ("flowId" in current ? current.flowId : undefined);
    if (targetFlowId === undefined) {
      return false;
    }
    return dispatch(provider, { type: "cancel", flowId: targetFlowId });
  }

  /** Acknowledge a terminal state, resetting the provider to idle. */
  function acknowledge(
    provider: ConnectionFlowProvider,
    flowId: string,
  ): boolean {
    return dispatch(provider, { type: "acknowledge", flowId });
  }

  return {
    getState,
    getSnapshot,
    start,
    markPrepared,
    claimReturn,
    completeTokenExchange,
    notifyUnsolicitedReturn,
    completeResourceLoad,
    fail,
    cancel,
    acknowledge,
  };
}
