/**
 * MCP OAuth loopback registry — authoritative resource owner.
 *
 * The private per-port lifecycle retains its listener, waiter, timer, and
 * close-barrier internals. Typed invocation references correlate every
 * asynchronous boundary; renderer message IDs independently deduplicate IPC
 * retries. Server-scoped cancellation settles callers and closes resources
 * before a row mutation is allowed to proceed.
 */

import type { Clock, IdSource } from "@/state_machines/clock";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  createInvocationRef,
  InvocationRegistry,
  sameInvocationRef,
} from "@/state_machines/invocation_ref";
import { createTraceObserver } from "@/state_machines/trace";
import type { TransitionObserver } from "@/state_machines/types";
import {
  IDLE_MCP_OAUTH_STATE,
  MCP_OAUTH_INVOCATION_KIND,
  identityOf,
  isTerminalMcpOAuthState,
  type McpOAuthEvent,
  type McpOAuthFlowIdentity,
  type McpOAuthInvocationRef,
  type McpOAuthState,
} from "./state";
import { transition, type IgnoreReason } from "./transition";

export const MCP_OAUTH_TIMEOUT_MS = 5 * 60_000;
const MESSAGE_DEDUPE_LIMIT = 128;

export interface McpOAuthBindResult {
  boundHosts: readonly string[];
  anyInUse: boolean;
}

export interface McpOAuthListenerHandle {
  settled: Promise<McpOAuthBindResult>;
  close(): Promise<void>;
}

export type ClaimCallbackResult =
  | { claimed: true; invocationRef: McpOAuthInvocationRef }
  | { claimed: false; reason: "state-mismatch" | "inactive" };

export interface McpOAuthListenerRequest {
  port: number;
  invocationRef: McpOAuthInvocationRef;
  onCallback(callback: {
    invocationRef: McpOAuthInvocationRef;
    state: string | null;
    code?: string;
    error?: string;
  }): ClaimCallbackResult;
}

export interface McpOAuthConnectRequest {
  port: number;
  serverId: number;
  rendererMessageId: string;
  expectedState: string;
  authorize(code?: string): Promise<"AUTHORIZED" | "REDIRECT">;
  onAbort(): void;
}

export interface McpOAuthConnectResult {
  success: boolean;
  error: string | null;
}

interface FlowRuntime {
  invocationRef: McpOAuthInvocationRef;
  serverId: number;
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
  onSettled?: (
    serverId: number,
    invocationRef: McpOAuthInvocationRef,
    result: McpOAuthConnectResult,
  ) => void;
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
  const activeInvocations = new InvocationRegistry<FlowRuntime>();
  const activeByServer = new Map<number, McpOAuthInvocationRef>();
  const listeners = new Map<string, McpOAuthListenerHandle>();
  const timeoutHandles = new Map<string, ReturnType<Clock["schedule"]>>();
  const closeBarriers = new Map<number, Promise<void>>();
  const messagePromises = new Map<
    string,
    { serverId: number; promise: Promise<McpOAuthConnectResult> }
  >();
  let disposed = false;

  const keyOf = (ref: McpOAuthInvocationRef) => ref.operationId;

  function getState(port: number): McpOAuthState {
    return states.get(port) ?? IDLE_MCP_OAUTH_STATE;
  }

  function cancelTimeout(invocationRef: McpOAuthInvocationRef): void {
    const key = keyOf(invocationRef);
    const handle = timeoutHandles.get(key);
    if (handle === undefined) return;
    timeoutHandles.delete(key);
    clock.cancel(handle);
  }

  function settleFlow(
    invocationRef: McpOAuthInvocationRef,
    result: McpOAuthConnectResult,
    abortProvider: boolean,
  ): void {
    const key = keyOf(invocationRef);
    const runtime = runtimes.get(key);
    if (!runtime || runtime.settled) return;
    runtime.settled = true;
    runtimes.delete(key);
    flowPorts.delete(key);
    activeInvocations.delete(invocationRef);
    if (
      sameInvocationRef(
        activeByServer.get(runtime.serverId) ?? invocationRef,
        invocationRef,
      )
    ) {
      activeByServer.delete(runtime.serverId);
    }
    cancelTimeout(invocationRef);
    if (abortProvider) runtime.onAbort();
    runtime.resolve(result);
    options.onSettled?.(runtime.serverId, invocationRef, result);
  }

  function closeListener(
    port: number,
    invocationRef: McpOAuthInvocationRef,
  ): Promise<void> {
    cancelTimeout(invocationRef);
    const key = keyOf(invocationRef);
    const listener = listeners.get(key);
    if (!listener) return closeBarriers.get(port) ?? Promise.resolve();
    listeners.delete(key);
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
    if (
      disposed ||
      current.status !== "binding" ||
      !sameInvocationRef(current.invocationRef, identity.invocationRef)
    ) {
      return;
    }

    let listener: McpOAuthListenerHandle;
    try {
      listener = options.bindListener({
        port,
        invocationRef: identity.invocationRef,
        onCallback: (callback) => claimCallback(port, callback),
      });
    } catch (error) {
      dispatch(port, {
        type: "EXCHANGE_FAILED",
        invocationRef: identity.invocationRef,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    listeners.set(keyOf(identity.invocationRef), listener);

    try {
      const bindResult = await listener.settled;
      dispatch(port, {
        type: "BINDS_SETTLED",
        invocationRef: identity.invocationRef,
        ...bindResult,
      });
    } catch (error) {
      dispatch(port, {
        type: "EXCHANGE_FAILED",
        invocationRef: identity.invocationRef,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function startAwaitingEffects(
    port: number,
    identity: McpOAuthFlowIdentity,
  ): void {
    const key = keyOf(identity.invocationRef);
    timeoutHandles.set(
      key,
      clock.schedule(
        () =>
          dispatch(port, {
            type: "TIMEOUT",
            invocationRef: identity.invocationRef,
          }),
        timeoutMs,
      ),
    );
    const runtime = runtimes.get(key);
    if (!runtime) return;
    void runtime.authorize().then(
      (result) => {
        if (result === "AUTHORIZED") {
          dispatch(port, {
            type: "AUTHORIZED_SILENTLY",
            invocationRef: identity.invocationRef,
          });
        }
      },
      (error) =>
        dispatch(port, {
          type: "EXCHANGE_FAILED",
          invocationRef: identity.invocationRef,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  function startExchange(
    port: number,
    invocationRef: McpOAuthInvocationRef,
    code: string,
  ): void {
    cancelTimeout(invocationRef);
    void closeListener(port, invocationRef);
    const runtime = runtimes.get(keyOf(invocationRef));
    if (!runtime) return;
    void runtime.authorize(code).then(
      (result) =>
        dispatch(
          port,
          result === "AUTHORIZED"
            ? { type: "EXCHANGE_OK", invocationRef }
            : {
                type: "EXCHANGE_FAILED",
                invocationRef,
                message:
                  "OAuth completed without authorization; please try again.",
              },
        ),
      (error) =>
        dispatch(port, {
          type: "EXCHANGE_FAILED",
          invocationRef,
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
          previous.next.invocationRef,
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
        closing.invocationRef,
        {
          success: false,
          error: "OAuth flow superseded by a new Connect attempt.",
        },
        true,
      );
      void closeListener(port, closing.invocationRef).then(() => {
        dispatch(port, {
          type: "SOCKETS_CLOSED",
          invocationRef: closing.invocationRef,
        });
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
      startExchange(port, state.invocationRef, event.code);
      return;
    }
    if (!isTerminalMcpOAuthState(state)) return;

    const terminalIdentity = identityOf(state);
    if (!terminalIdentity) return;
    const succeeded = state.status === "connected";
    settleFlow(
      terminalIdentity.invocationRef,
      succeeded
        ? { success: true, error: null }
        : { success: false, error: terminalMessage(port, state) },
      !succeeded,
    );
    const closing = closeListener(port, terminalIdentity.invocationRef);
    void closing.then(() => {
      if (getState(port) === state) states.delete(port);
    });
  }

  function dispatch(port: number, event: McpOAuthEvent): boolean {
    if (disposed) return false;
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

  function rememberMessage(
    rendererMessageId: string,
    serverId: number,
    promise: Promise<McpOAuthConnectResult>,
  ): void {
    messagePromises.set(rendererMessageId, { serverId, promise });
    while (messagePromises.size > MESSAGE_DEDUPE_LIMIT) {
      const oldest = messagePromises.keys().next().value;
      if (oldest === undefined) break;
      messagePromises.delete(oldest);
    }
  }

  function connect(
    request: McpOAuthConnectRequest,
  ): Promise<McpOAuthConnectResult> {
    const duplicate = messagePromises.get(request.rendererMessageId);
    if (duplicate) {
      if (duplicate.serverId === request.serverId) return duplicate.promise;
      request.onAbort();
      return Promise.resolve({
        success: false,
        error: "OAuth retry message ID was reused for a different server.",
      });
    }
    if (disposed) {
      request.onAbort();
      return Promise.resolve({
        success: false,
        error: "OAuth flow registry disposed.",
      });
    }

    const previousForServer = activeByServer.get(request.serverId);
    if (previousForServer) {
      void cancelInvocation(
        previousForServer,
        "OAuth flow superseded by a new Connect attempt.",
      );
    }

    const invocationRef = createInvocationRef(
      MCP_OAUTH_INVOCATION_KIND,
      request.serverId,
      ids,
    );
    let resolvePromise!: (result: McpOAuthConnectResult) => void;
    const promise = new Promise<McpOAuthConnectResult>((resolve) => {
      resolvePromise = resolve;
    });
    const runtime: FlowRuntime = {
      invocationRef,
      serverId: request.serverId,
      authorize: request.authorize,
      onAbort: request.onAbort,
      resolve: resolvePromise,
      settled: false,
    };
    runtimes.set(keyOf(invocationRef), runtime);
    activeInvocations.register(invocationRef, runtime);
    activeByServer.set(request.serverId, invocationRef);
    flowPorts.set(keyOf(invocationRef), request.port);
    rememberMessage(request.rendererMessageId, request.serverId, promise);
    dispatch(request.port, {
      type: "CONNECT",
      invocationRef,
      rendererMessageId: request.rendererMessageId,
      expectedState: request.expectedState,
      serverId: request.serverId,
    });
    return promise;
  }

  function retryResult(
    rendererMessageId: string,
    serverId: number,
  ): Promise<McpOAuthConnectResult> | undefined {
    const duplicate = messagePromises.get(rendererMessageId);
    if (!duplicate) return undefined;
    return duplicate.serverId === serverId
      ? duplicate.promise
      : Promise.resolve({
          success: false,
          error: "OAuth retry message ID was reused for a different server.",
        });
  }

  function claimCallback(
    port: number,
    callback: {
      invocationRef: McpOAuthInvocationRef;
      state: string | null;
      code?: string;
      error?: string;
    },
  ): ClaimCallbackResult {
    const current = getState(port);
    if (
      current.status !== "awaitingCallback" ||
      activeInvocations.claim(callback.invocationRef).kind !== "claimed"
    ) {
      return { claimed: false, reason: "inactive" };
    }
    const event: McpOAuthEvent = {
      type: "CALLBACK",
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
    return { claimed: true, invocationRef: callback.invocationRef };
  }

  async function cancelInvocation(
    invocationRef: McpOAuthInvocationRef,
    reason: string,
  ): Promise<void> {
    if (activeInvocations.claim(invocationRef).kind !== "claimed") return;
    const port = flowPorts.get(keyOf(invocationRef));
    settleFlow(invocationRef, { success: false, error: reason }, true);
    if (port === undefined) return;
    const state = states.get(port);
    const ownsState =
      state?.status === "superseding"
        ? sameInvocationRef(state.closing.invocationRef, invocationRef) ||
          sameInvocationRef(state.next.invocationRef, invocationRef)
        : state !== undefined && state.status !== "idle"
          ? sameInvocationRef(state.invocationRef, invocationRef)
          : false;
    if (ownsState) {
      states.delete(port);
    }
    await closeListener(port, invocationRef);
  }

  function cancelServer(serverId: number, reason: string): Promise<void> {
    const invocationRef = activeByServer.get(serverId);
    return invocationRef
      ? cancelInvocation(invocationRef, reason)
      : Promise.resolve();
  }

  async function dispose(): Promise<void> {
    if (disposed) {
      await Promise.all(closeBarriers.values());
      return;
    }
    disposed = true;
    const closes: Promise<void>[] = [];
    for (const runtime of runtimes.values()) {
      const port = flowPorts.get(keyOf(runtime.invocationRef));
      settleFlow(
        runtime.invocationRef,
        { success: false, error: "OAuth flow registry disposed." },
        true,
      );
      if (port !== undefined) {
        closes.push(closeListener(port, runtime.invocationRef));
      }
    }
    states.clear();
    await Promise.all([...closes, ...closeBarriers.values()]);
  }

  return {
    getState,
    retryResult,
    connect,
    claimCallback,
    cancelServer,
    dispose,
  };
}
