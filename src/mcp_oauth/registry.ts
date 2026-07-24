/**
 * MCP OAuth loopback registry — authoritative per-port main-process owner.
 *
 * Like connection_flow, this is an explicitly constructed, dependency-
 * injected main-process registry. It deliberately has no command channel:
 * listener, timer, provider-abort, and promise-settlement effects are derived
 * from applied transitions so the per-port state and its external resources
 * cannot drift apart. This is the documented commandless derived-effects
 * deviation permitted by rules/state-machines.md.
 */

import type { Clock, IdSource } from "@/state_machines/clock";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { createTraceObserver } from "@/state_machines/trace";
import type { TransitionObserver } from "@/state_machines/types";
import {
  IDLE_MCP_OAUTH_STATE,
  identityOf,
  isTerminalMcpOAuthState,
  type McpOAuthEvent,
  type McpOAuthFlowIdentity,
  type McpOAuthState,
} from "./state";
import { transition, type IgnoreReason } from "./transition";

export const MCP_OAUTH_TIMEOUT_MS = 5 * 60_000;

export interface McpOAuthBindResult {
  boundHosts: readonly string[];
  anyInUse: boolean;
}

export interface McpOAuthListenerHandle {
  settled: Promise<McpOAuthBindResult>;
  close(): Promise<void>;
}

export type ClaimCallbackResult =
  | { claimed: true }
  | { claimed: false; reason: "state-mismatch" | "inactive" };

export interface McpOAuthListenerRequest {
  port: number;
  flowId: string;
  onCallback(callback: {
    state: string | null;
    code?: string;
    error?: string;
  }): ClaimCallbackResult;
}

export interface McpOAuthConnectRequest {
  port: number;
  serverId: number;
  expectedState: string;
  authorize(code?: string): Promise<"AUTHORIZED" | "REDIRECT">;
  onAbort(): void;
}

export interface McpOAuthConnectResult {
  success: boolean;
  error: string | null;
}

interface FlowRuntime {
  authorize(code?: string): Promise<"AUTHORIZED" | "REDIRECT">;
  onAbort(): void;
  resolve(result: McpOAuthConnectResult): void;
  settled: boolean;
}

export interface McpOAuthRegistryOptions {
  clock?: Clock;
  ids?: IdSource;
  timeoutMs?: number;
  bindListener(request: McpOAuthListenerRequest): McpOAuthListenerHandle;
  observer?: TransitionObserver<
    McpOAuthState,
    McpOAuthEvent,
    never,
    IgnoreReason
  >;
}

export type McpOAuthRegistry = ReturnType<typeof createMcpOAuthRegistry>;

export function createMcpOAuthRegistry(options: McpOAuthRegistryOptions) {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? uuidIdSource;
  const timeoutMs = options.timeoutMs ?? MCP_OAUTH_TIMEOUT_MS;
  const observer = options.observer ?? createTraceObserver("mcp_oauth");

  const states = new Map<number, McpOAuthState>();
  const flowPorts = new Map<string, number>();
  const runtimes = new Map<string, FlowRuntime>();
  const listeners = new Map<string, McpOAuthListenerHandle>();
  const timeoutHandles = new Map<string, ReturnType<Clock["schedule"]>>();
  const closeBarriers = new Map<number, Promise<void>>();

  function getState(port: number): McpOAuthState {
    return states.get(port) ?? IDLE_MCP_OAUTH_STATE;
  }

  function cancelTimeout(flowId: string): void {
    const handle = timeoutHandles.get(flowId);
    if (handle === undefined) return;
    timeoutHandles.delete(flowId);
    clock.cancel(handle);
  }

  function settleFlow(
    flowId: string,
    result: McpOAuthConnectResult,
    abortProvider: boolean,
  ): void {
    const runtime = runtimes.get(flowId);
    if (!runtime || runtime.settled) return;
    runtime.settled = true;
    runtimes.delete(flowId);
    flowPorts.delete(flowId);
    cancelTimeout(flowId);
    if (abortProvider) runtime.onAbort();
    runtime.resolve(result);
  }

  function closeListener(port: number, flowId: string): Promise<void> {
    cancelTimeout(flowId);
    const listener = listeners.get(flowId);
    if (!listener) return closeBarriers.get(port) ?? Promise.resolve();
    listeners.delete(flowId);
    const closing = listener.close().catch(() => undefined);
    const barrier = Promise.all([
      closeBarriers.get(port) ?? Promise.resolve(),
      closing,
    ]).then(() => undefined);
    closeBarriers.set(port, barrier);
    void barrier.finally(() => {
      if (closeBarriers.get(port) === barrier) closeBarriers.delete(port);
    });
    return barrier;
  }

  function terminalMessage(port: number, state: McpOAuthState): string {
    if (state.status === "timedOut") {
      return `OAuth flow timed out after ${timeoutMs / 1000}s. Did you close the browser tab?`;
    }
    if (state.status !== "failed") return "OAuth flow failed.";
    if (state.message === "callback-port-in-use") {
      return (
        `Could not bind OAuth callback listener on port ${port}: ` +
        "another local process is holding one of the loopback stacks (127.0.0.1 / ::1). " +
        "Stop the conflicting process or configure a different OAuth callback port."
      );
    }
    if (state.message === "callback-bind-failed") {
      return `Could not bind OAuth callback listener on port ${port} (tried IPv4 and IPv6 loopback).`;
    }
    return state.message;
  }

  async function startBinding(
    port: number,
    identity: McpOAuthFlowIdentity,
  ): Promise<void> {
    await (closeBarriers.get(port) ?? Promise.resolve());
    const current = getState(port);
    if (current.status !== "binding" || current.flowId !== identity.flowId) {
      return;
    }

    let listener: McpOAuthListenerHandle;
    try {
      listener = options.bindListener({
        port,
        flowId: identity.flowId,
        onCallback: (callback) => claimCallback(port, callback),
      });
    } catch (error) {
      dispatch(port, {
        type: "EXCHANGE_FAILED",
        flowId: identity.flowId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    listeners.set(identity.flowId, listener);

    let bindResult: McpOAuthBindResult;
    try {
      bindResult = await listener.settled;
    } catch (error) {
      dispatch(port, {
        type: "EXCHANGE_FAILED",
        flowId: identity.flowId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    dispatch(port, {
      type: "BINDS_SETTLED",
      flowId: identity.flowId,
      ...bindResult,
    });
  }

  function startAwaitingEffects(
    port: number,
    identity: McpOAuthFlowIdentity,
  ): void {
    timeoutHandles.set(
      identity.flowId,
      clock.schedule(
        () => dispatch(port, { type: "TIMEOUT", flowId: identity.flowId }),
        timeoutMs,
      ),
    );
    const runtime = runtimes.get(identity.flowId);
    if (!runtime) return;
    void runtime.authorize().then(
      (result) => {
        if (result === "AUTHORIZED") {
          dispatch(port, {
            type: "AUTHORIZED_SILENTLY",
            flowId: identity.flowId,
          });
        }
      },
      (error) =>
        dispatch(port, {
          type: "EXCHANGE_FAILED",
          flowId: identity.flowId,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  function startExchange(port: number, flowId: string, code: string): void {
    cancelTimeout(flowId);
    void closeListener(port, flowId);
    const runtime = runtimes.get(flowId);
    if (!runtime) return;
    void runtime.authorize(code).then(
      (result) => {
        if (result === "AUTHORIZED") {
          dispatch(port, { type: "EXCHANGE_OK", flowId });
        } else {
          dispatch(port, {
            type: "EXCHANGE_FAILED",
            flowId,
            message: "OAuth completed without authorization; please try again.",
          });
        }
      },
      (error) =>
        dispatch(port, {
          type: "EXCHANGE_FAILED",
          flowId,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  function applyDerivedEffects(
    port: number,
    previous: McpOAuthState,
    event: McpOAuthEvent,
    state: McpOAuthState,
  ): void {
    if (state.status === "superseding") {
      if (previous.status === "superseding") {
        settleFlow(
          previous.next.flowId,
          {
            success: false,
            error: "OAuth flow superseded by a new Connect attempt.",
          },
          true,
        );
        return;
      }
      const closing = identityOf(previous);
      if (!closing) return;
      settleFlow(
        closing.flowId,
        {
          success: false,
          error: "OAuth flow superseded by a new Connect attempt.",
        },
        true,
      );
      void closeListener(port, closing.flowId).then(() => {
        dispatch(port, { type: "SOCKETS_CLOSED", flowId: closing.flowId });
      });
      return;
    }

    if (state.status === "binding") {
      void startBinding(port, state);
      return;
    }

    if (state.status === "awaitingCallback") {
      startAwaitingEffects(port, state);
      return;
    }

    if (
      state.status === "exchanging" &&
      event.type === "CALLBACK" &&
      event.code
    ) {
      startExchange(port, state.flowId, event.code);
      return;
    }

    if (!isTerminalMcpOAuthState(state)) return;

    const terminalIdentity = identityOf(state);
    if (!terminalIdentity) return;
    const succeeded = state.status === "connected";
    settleFlow(
      terminalIdentity.flowId,
      succeeded
        ? { success: true, error: null }
        : { success: false, error: terminalMessage(port, state) },
      !succeeded,
    );
    const closing = closeListener(port, terminalIdentity.flowId);
    void closing.then(() => {
      if (getState(port) === state) states.delete(port);
    });
  }

  function dispatch(port: number, event: McpOAuthEvent): boolean {
    const previous = getState(port);
    const result = transition(previous, event);
    if (result.kind === "ignored") {
      observer?.onEventIgnored?.({
        state: previous,
        event,
        reason: result.reason,
      });
      return false;
    }
    observer?.onTransitionApplied?.({
      previous,
      event,
      state: result.state,
      commands: [],
    });
    states.set(port, result.state);
    applyDerivedEffects(port, previous, event, result.state);
    return true;
  }

  function connect(
    request: McpOAuthConnectRequest,
  ): Promise<McpOAuthConnectResult> {
    const identity: McpOAuthFlowIdentity = {
      flowId: ids.next("mcp-oauth"),
      expectedState: request.expectedState,
      serverId: request.serverId,
    };
    if (runtimes.has(identity.flowId)) {
      request.onAbort();
      return Promise.resolve({
        success: false,
        error: `OAuth flow ID collision: ${identity.flowId}`,
      });
    }
    const promise = new Promise<McpOAuthConnectResult>((resolve) => {
      runtimes.set(identity.flowId, {
        authorize: request.authorize,
        onAbort: request.onAbort,
        resolve,
        settled: false,
      });
    });
    flowPorts.set(identity.flowId, request.port);
    dispatch(request.port, { type: "CONNECT", ...identity });
    return promise;
  }

  function claimCallback(
    port: number,
    callback: { state: string | null; code?: string; error?: string },
  ): ClaimCallbackResult {
    const current = getState(port);
    if (current.status !== "awaitingCallback") {
      return { claimed: false, reason: "inactive" };
    }
    const event: McpOAuthEvent = {
      type: "CALLBACK",
      flowId: current.flowId,
      ...callback,
    };
    const result = transition(current, event);
    if (result.kind === "ignored" && result.reason === "state-mismatch") {
      observer?.onEventIgnored?.({
        state: current,
        event,
        reason: result.reason,
      });
      return { claimed: false, reason: "state-mismatch" };
    }
    dispatch(port, event);
    return { claimed: true };
  }

  function dispose(): void {
    for (const flowId of runtimes.keys()) {
      const port = flowPorts.get(flowId);
      settleFlow(
        flowId,
        { success: false, error: "OAuth flow registry disposed." },
        true,
      );
      if (port !== undefined) void closeListener(port, flowId);
    }
    states.clear();
  }

  return { getState, connect, claimCallback, dispose };
}
