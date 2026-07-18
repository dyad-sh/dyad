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
} from "../../connection_flow/registry";
import {
  isTerminalFlowState,
  type ConnectionFlowFailureReason,
  type ConnectionFlowProvider,
} from "../../connection_flow/state";
import { safeSend } from "../utils/safe_sender";

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
// freshly allocated flowId; `onFlowEnded` lets the provider release resources
// (poll timers, device codes) whenever a flow reaches a terminal state, no
// matter which event ended it (cancel IPC, timeout, failure, success).
// -----------------------------------------------------------------------------

export interface ConnectionFlowProviderHooks {
  start?: (args: {
    flowId: string;
    appId: number | null;
  }) => void | Promise<void>;
  onFlowEnded?: (flowId: string) => void;
}

const providerHooks = new Map<
  ConnectionFlowProvider,
  ConnectionFlowProviderHooks
>();

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
        ("flowId" in state ? ` (${state.flowId})` : ""),
    );
    if (isTerminalFlowState(state) && "flowId" in state) {
      providerHooks.get(provider)?.onFlowEnded?.(state.flowId);
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
 * it: claims the active flow (if any), runs the token write, and advances or
 * fails the flow accordingly. Unsolicited returns (no active flow, or the
 * flow already ended — e.g. it timed out first) still perform the token
 * write; the renderer is then told to refresh connection state without
 * transitioning any flow.
 *
 * `expectedFlowId` correlates the return with the flow that produced it.
 * The GitHub device poll chain carries the flowId it was started for and
 * MUST pass it, so a stale poll result can never claim (and advance) a
 * newer flow.
 *
 * The Supabase/Neon deep-link returns cannot pass it: the dyad.sh OAuth
 * proxy's login endpoints take no client-supplied state parameter, so the
 * dyad://…-oauth-return URL carries only tokens — there is nothing to
 * round-trip a flowId in. The closest safe correlation holds structurally
 * instead: the registry keeps at most one flow per provider and `start` is
 * a no-op while one is active, so the awaiting flow a return claims is
 * always the *newest* flow for that provider (an older flow must have
 * reached a terminal state before a new one could start, and terminal flows
 * can never be claimed). A stale browser tab completing after a retry can
 * therefore only be attributed to the newest awaiting flow — which is
 * benign for these providers, because the login URL carries no per-flow
 * parameters either: every return is the same account-level token grant the
 * awaiting flow is waiting for.
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
    expectedFlowId,
  }: {
    failureReason?: ConnectionFlowFailureReason;
    expectedFlowId?: string;
  } = {},
): Promise<OAuthReturnExchangeOutcome> {
  const claim: ClaimReturnResult = connectionFlowRegistry.claimReturn(
    provider,
    expectedFlowId,
  );
  try {
    await exchange();
  } catch (error) {
    if (claim.claimed) {
      connectionFlowRegistry.fail(
        provider,
        claim.flowId,
        failureReason,
        error instanceof Error ? error.message : String(error),
      );
    }
    return { ok: false, claimed: claim.claimed, error };
  }
  if (claim.claimed) {
    connectionFlowRegistry.completeTokenExchange(provider, claim.flowId);
  } else {
    connectionFlowRegistry.notifyUnsolicitedReturn(provider);
  }
  return { ok: true, claimed: claim.claimed };
}

// -----------------------------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------------------------

export function registerConnectionFlowHandlers(): void {
  createTypedHandler(connectionFlowContracts.start, async (event, params) => {
    rememberSubscriber(event.sender);
    const result = connectionFlowRegistry.start(params.provider);
    if (result.started) {
      const starter = providerHooks.get(params.provider)?.start;
      if (starter) {
        void starter({ flowId: result.flowId, appId: params.appId ?? null });
      } else {
        // Deep-link providers (Supabase/Neon) have no async preparation:
        // the flow goes straight to awaiting the dyad:// return.
        connectionFlowRegistry.markPrepared(params.provider, result.flowId);
      }
    }
    return {
      flowId: result.flowId,
      started: result.started,
      state: connectionFlowRegistry.getState(params.provider),
    };
  });

  createTypedHandler(connectionFlowContracts.cancel, async (event, params) => {
    rememberSubscriber(event.sender);
    connectionFlowRegistry.cancel(params.provider, params.flowId);
  });

  createTypedHandler(
    connectionFlowContracts.resourcesLoaded,
    async (event, params) => {
      rememberSubscriber(event.sender);
      connectionFlowRegistry.completeResourceLoad(
        params.provider,
        params.flowId,
      );
    },
  );

  createTypedHandler(
    connectionFlowContracts.acknowledge,
    async (event, params) => {
      rememberSubscriber(event.sender);
      connectionFlowRegistry.acknowledge(params.provider, params.flowId);
    },
  );

  createTypedHandler(connectionFlowContracts.getStates, async (event) => {
    rememberSubscriber(event.sender);
    return connectionFlowRegistry.getSnapshot();
  });
}
