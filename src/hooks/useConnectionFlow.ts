/**
 * Renderer projection of the main process' connection flow state machine.
 *
 * Main is authoritative: it pushes `connection-flow:state-changed` events on
 * every transition and this module keeps a per-provider snapshot that
 * components bind to via `useSyncExternalStore`. There is no renderer-side
 * flow state to get out of sync — remounting a connector re-projects the
 * current flow (e.g. a GitHub device poll that succeeded while the component
 * was unmounted).
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ipc } from "@/ipc/types";
import {
  DISCONNECTED_FLOW_STATE,
  isActiveFlowState,
  type ConnectionFlowProvider,
  type ConnectionFlowState,
} from "@/connection_flow/state";

type FlowSnapshot = Record<ConnectionFlowProvider, ConnectionFlowState>;

let snapshot: FlowSnapshot = {
  github: DISCONNECTED_FLOW_STATE,
  supabase: DISCONNECTED_FLOW_STATE,
  neon: DISCONNECTED_FLOW_STATE,
};

const listeners = new Set<() => void>();
const unsolicitedReturnListeners = new Set<{
  provider: ConnectionFlowProvider;
  handler: () => void;
}>();

// Providers that already received a pushed state; the initial getStates()
// fetch must not clobber fresher event-driven state with a stale snapshot.
const pushedProviders = new Set<ConnectionFlowProvider>();

let subscribedToIpc = false;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function ensureIpcSubscription(): void {
  if (subscribedToIpc) {
    return;
  }
  subscribedToIpc = true;

  ipc.events.connectionFlow.onStateChanged(({ provider, state }) => {
    pushedProviders.add(provider);
    snapshot = { ...snapshot, [provider]: state };
    emit();
  });

  ipc.events.connectionFlow.onUnsolicitedReturn(({ provider }) => {
    for (const entry of unsolicitedReturnListeners) {
      if (entry.provider === provider) {
        entry.handler();
      }
    }
  });

  // Hydrate with the current main-process state (covers flows that were
  // already running before this renderer/store loaded).
  void ipc.connectionFlow
    .getStates()
    .then((states) => {
      let changed = false;
      const next = { ...snapshot };
      for (const provider of Object.keys(states) as ConnectionFlowProvider[]) {
        if (!pushedProviders.has(provider)) {
          next[provider] = states[provider];
          changed = true;
        }
      }
      if (changed) {
        snapshot = next;
        emit();
      }
    })
    .catch((error) => {
      console.error("Failed to load connection flow states:", error);
    });
}

function subscribe(listener: () => void): () => void {
  ensureIpcSubscription();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start a flow for a provider. Returns `started: false` when a flow is
 * already active (double-clicking Connect is a no-op — the existing flow's
 * flowId is returned).
 */
export async function startConnectionFlow(
  provider: ConnectionFlowProvider,
  args?: { appId?: number | null },
): Promise<{ flowId: string; started: boolean }> {
  const result = await ipc.connectionFlow.start({
    provider,
    appId: args?.appId ?? null,
  });
  return { flowId: result.flowId, started: result.started };
}

/** Cancel the provider's active flow (or a specific flowId). */
export async function cancelConnectionFlow(
  provider: ConnectionFlowProvider,
  flowId?: string,
): Promise<void> {
  await ipc.connectionFlow.cancel({ provider, flowId });
}

/** Acknowledge a terminal flow state, resetting the provider to idle. */
export async function acknowledgeConnectionFlow(
  provider: ConnectionFlowProvider,
  flowId: string,
): Promise<void> {
  await ipc.connectionFlow.acknowledge({ provider, flowId });
}

/** Report that the renderer finished refreshing resources for a flow. */
export async function reportConnectionFlowResourcesLoaded(
  provider: ConnectionFlowProvider,
  flowId: string,
): Promise<void> {
  await ipc.connectionFlow.resourcesLoaded({ provider, flowId });
}

/**
 * The provider's current connection flow state, pushed from main. This hook
 * never fabricates state locally.
 */
export function useConnectionFlow(provider: ConnectionFlowProvider): {
  flowState: ConnectionFlowState;
  isFlowActive: boolean;
} {
  const flowState = useSyncExternalStore(
    subscribe,
    () => snapshot[provider],
    () => snapshot[provider],
  );

  return { flowState, isFlowActive: isActiveFlowState(flowState) };
}

/**
 * Runs `handler` whenever main processed an OAuth return for `provider` with
 * no matching active flow (cold-start deep link, app restarted mid-flow, or
 * a return that lost the race against a timeout). Tokens are already
 * written; the handler should refresh connection state — no flow transitions
 * are involved. The latest handler is always invoked (no stale closures).
 */
export function useUnsolicitedConnectionReturn(
  provider: ConnectionFlowProvider,
  handler: () => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    ensureIpcSubscription();
    const entry = { provider, handler: () => handlerRef.current() };
    unsolicitedReturnListeners.add(entry);
    return () => {
      unsolicitedReturnListeners.delete(entry);
    };
  }, [provider]);
}
