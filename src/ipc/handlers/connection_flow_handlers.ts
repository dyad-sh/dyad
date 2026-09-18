import { BrowserWindow, type WebContents } from "electron";
import log from "electron-log";
import { createTypedHandler } from "./base";
import {
  connectionFlowContracts,
  connectionFlowEvents,
} from "../types/connection_flow";
import {
  createConnectionFlowRegistry,
  type ClaimReturnResult,
  type ConnectionFlowRegistry,
} from "../../connection_flow/registry";
import {
  isTerminalFlowState,
  type ConnectionFlowFailureReason,
  type ConnectionFlowInvocationRef,
  type ConnectionFlowProvider,
} from "../../connection_flow/state";
import { safeSend } from "../utils/safe_sender";
import { publishQueryInvalidations } from "../utils/query_invalidation_delivery";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("connection_flow");

// -----------------------------------------------------------------------------
// Broadcasting
//
// Flow state lives in main; every renderer is a thin projection of it. State
// changes are pushed to all windows plus any webContents that has talked to
// the flow IPC (the latter covers test harnesses where BrowserWindow
// enumeration is stubbed out).
// -----------------------------------------------------------------------------

const subscribedWebContents = new Set<WebContents>();

function rememberSubscriber(sender: WebContents): void {
  if (!subscribedWebContents.has(sender)) {
    subscribedWebContents.add(sender);
    sender.once?.("destroyed", () => {
      subscribedWebContents.delete(sender);
    });
  }
}

function broadcast(channel: string, payload: unknown): void {
  const targets = new Set<WebContents>();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      targets.add(window.webContents);
    }
  }
  for (const sender of subscribedWebContents) {
    targets.add(sender);
  }
  for (const target of targets) {
    safeSend(target, channel, payload);
  }
}

// -----------------------------------------------------------------------------
// Provider hooks
//
// Provider-specific flow drivers (currently only GitHub's device flow)
// register themselves here. `start` kicks off the provider's async work for a
// freshly allocated invocation ref; `onFlowEnded` releases provider resources
// (poll timers, device codes) whenever a flow reaches a terminal state, no
// matter which event ended it (cancel IPC, timeout, failure, success).
// -----------------------------------------------------------------------------

export interface ConnectionFlowProviderHooks {
  start?: (args: {
    invocationRef: ConnectionFlowInvocationRef;
    appId: number | null;
    signal: AbortSignal;
  }) => void | Promise<void>;
  onFlowEnded?: (invocationRef: ConnectionFlowInvocationRef) => void;
  dispose?: () => void | Promise<void>;
}

const providerHooks = new Map<
  ConnectionFlowProvider,
  ConnectionFlowProviderHooks
>();
const providerWork = new Map<string, AbortController>();

function providerWorkKey(invocationRef: ConnectionFlowInvocationRef): string {
  return invocationRef.operationId;
}

function endProviderWork(
  provider: ConnectionFlowProvider,
  invocationRef: ConnectionFlowInvocationRef,
): void {
  const controller = providerWork.get(providerWorkKey(invocationRef));
  providerWork.delete(providerWorkKey(invocationRef));
  controller?.abort();
  providerHooks.get(provider)?.onFlowEnded?.(invocationRef);
}

export function registerConnectionFlowProvider(
  provider: ConnectionFlowProvider,
  hooks: ConnectionFlowProviderHooks,
): void {
  providerHooks.set(provider, hooks);
}

// -----------------------------------------------------------------------------
// The authoritative registry (main process singleton)
// -----------------------------------------------------------------------------

export const connectionFlowRegistry = createConnectionFlowRegistry({
  onStateChange: (provider, state) => {
    logger.debug(
      `[${provider}] flow state -> ${state.status}` +
        ("invocationRef" in state
          ? ` (${state.invocationRef.operationId})`
          : ""),
    );
    if (isTerminalFlowState(state) && "invocationRef" in state) {
      endProviderWork(provider, state.invocationRef);
    }
    broadcast(connectionFlowEvents.stateChanged.channel, { provider, state });
  },
  onUnsolicitedReturn: (provider) => {
    logger.info(
      `[${provider}] unsolicited OAuth return processed (no active flow)`,
    );
    broadcast(connectionFlowEvents.unsolicitedReturn.channel, { provider });
  },
  onIgnoredEvent: (provider, event, reason) => {
    logger.debug(`[${provider}] ignored flow event ${event.type}: ${reason}`);
  },
});

export type OAuthReturnExchangeOutcome =
  | { ok: true; claimed: boolean }
  | { ok: false; claimed: boolean; error: unknown };

/**
 * Wraps a provider's OAuth-return token write so the flow machine observes
 * it: claims the active flow, runs the token write, and advances or fails the
 * flow accordingly. By default, an unmatched return never runs the token
 * write. Authenticated internal producers may explicitly preserve a completed
 * exchange that raced UI cancellation without claiming a newer flow.
 *
 * `expectedInvocationRef` correlates the return with the flow that produced it.
 * The GitHub device poll chain carries the ref it was started for and
 * MUST pass it, so a stale poll result can never claim (and advance) a
 * newer flow.
 *
 * Failures are recorded on the claimed flow (surfaced by the renderer as a
 * flow-failure toast) and reported in the returned outcome instead of being
 * rethrown, so callers can avoid double-surfacing the same error.
 */
export async function runOAuthReturnExchange(
  provider: ConnectionFlowProvider,
  exchange: () => void | Promise<void>,
  {
    failureReason = "token_invalid",
    expectedInvocationRef,
    allowUnclaimedExchange = false,
  }: {
    failureReason?: ConnectionFlowFailureReason;
    expectedInvocationRef?: ConnectionFlowInvocationRef;
    allowUnclaimedExchange?: boolean;
  } = {},
  registry: Pick<
    ConnectionFlowRegistry,
    "claimReturn" | "completeTokenExchange" | "fail" | "notifyUnsolicitedReturn"
  > = connectionFlowRegistry,
): Promise<OAuthReturnExchangeOutcome> {
  const claim: ClaimReturnResult = registry.claimReturn(
    provider,
    expectedInvocationRef,
  );
  if (!claim.claimed && !allowUnclaimedExchange) {
    return {
      ok: false,
      claimed: false,
      error: new DyadError(
        `The ${provider} OAuth return did not match an active connection flow.`,
        DyadErrorKind.Auth,
      ),
    };
  }
  try {
    await exchange();
  } catch (error) {
    if (claim.claimed) {
      registry.fail(
        provider,
        claim.invocationRef,
        failureReason,
        error instanceof Error ? error.message : String(error),
      );
    }
    return { ok: false, claimed: claim.claimed, error };
  }
  if (claim.claimed) {
    registry.completeTokenExchange(provider, claim.invocationRef);
  } else {
    registry.notifyUnsolicitedReturn(provider);
  }
  // Persistence completed before this global epoch event. Every live window
  // invalidates independently, and a reloaded window recovers the scope from
  // the query-invalidation journal instead of acknowledging main lifecycle.
  publishQueryInvalidations([{ family: "provider-status", provider }]);
  return { ok: true, claimed: claim.claimed };
}

export async function disposeConnectionFlowsForShutdown(): Promise<void> {
  const active = Object.entries(connectionFlowRegistry.getSnapshot()).flatMap(
    ([provider, state]) =>
      "invocationRef" in state
        ? [
            {
              provider: provider as ConnectionFlowProvider,
              invocationRef: state.invocationRef,
            },
          ]
        : [],
  );
  connectionFlowRegistry.dispose();
  for (const { provider, invocationRef } of active) {
    endProviderWork(provider, invocationRef);
  }
  await Promise.all(
    [...providerHooks.values()].map((hooks) => hooks.dispose?.()),
  );
}

// -----------------------------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------------------------

export function registerConnectionFlowHandlers(): void {
  createTypedHandler(connectionFlowContracts.start, async (event, params) => {
    rememberSubscriber(event.sender);
    const result = connectionFlowRegistry.start(
      params.provider,
      params.expectedRevision,
    );
    if (!result.admitted) {
      throw new DyadError(
        `Connection flow changed before ${params.provider} start was admitted.`,
        DyadErrorKind.Conflict,
      );
    }
    if (result.started) {
      const starter = providerHooks.get(params.provider)?.start;
      if (starter) {
        const controller = new AbortController();
        providerWork.set(providerWorkKey(result.invocationRef), controller);
        void starter({
          invocationRef: result.invocationRef,
          appId: params.appId ?? null,
          signal: controller.signal,
        });
      } else {
        // Deep-link providers (Supabase/Neon) have no async preparation:
        // the flow goes straight to awaiting the dyad:// return.
        connectionFlowRegistry.markPrepared(
          params.provider,
          result.invocationRef,
        );
      }
    }
    return {
      invocationRef: result.invocationRef,
      started: result.started,
      state: connectionFlowRegistry.getState(params.provider),
    };
  });

  createTypedHandler(connectionFlowContracts.cancel, async (event, params) => {
    rememberSubscriber(event.sender);
    connectionFlowRegistry.cancel(params.provider, params.invocationRef);
  });

  createTypedHandler(
    connectionFlowContracts.acknowledge,
    async (event, params) => {
      rememberSubscriber(event.sender);
      const result = connectionFlowRegistry.acknowledge(
        params.provider,
        params.invocationRef,
        params.expectedRevision,
      );
      if (!result.admitted) {
        throw new DyadError(
          `Connection flow changed before ${params.provider} acknowledgement was admitted.`,
          DyadErrorKind.Conflict,
        );
      }
    },
  );

  createTypedHandler(connectionFlowContracts.getStates, async (event) => {
    rememberSubscriber(event.sender);
    return connectionFlowRegistry.getSnapshot();
  });
}
