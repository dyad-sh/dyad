import type { InvocationRef } from "@/state_machines/invocation_ref";
import type {
  StaleOperationIgnoreReason,
  TransitionResult as GenericTransitionResult,
} from "@/state_machines/types";

/**
 * Written out here rather than imported from the wire schema.
 *
 * A pure machine module may not reach into `src/ipc` at all — the boundary
 * check does not care that an import is type-only, and it is right not to:
 * the rule is about which side owns the definition. The schemas beside
 * `SetupSnapshotSchema` assert against these, so neither can drift.
 */
export type SetupStep =
  | "connecting"
  | "checking-server"
  | "installing"
  | "waiting-for-dashboard"
  | "verifying-account"
  | "securing"
  | "creating-token"
  | "done";

export interface SetupTarget {
  host: string;
  username: string;
  port?: number;
  adminEmail: string;
  customDomain?: string;
}

export interface SetupResult {
  dashboardUrl: string;
  secure: boolean;
  insecureReason: string | null;
  adminEmail: string;
  adminPassword: string;
  tokenStored: boolean;
  tokenUnavailableReason: string | null;
  version: string | null;
}

/**
 * Types for the machine that sets up one Coolify server.
 *
 * Types only: the pure transition lives in `transition.ts` and the side
 * effects in `controller.ts`. The state belongs to the main process because
 * that is where the work happens — an install outlives the screen that started
 * it, since leaving that screen is invited and a background refetch can
 * replace it. A copy in the renderer goes stale the moment either happens.
 *
 * Every event from a running setup echoes its invocation ref, so an answer
 * from a run that was cancelled or superseded cannot revive or overwrite
 * whatever the user is looking at now. Correlation is by operation rather than
 * by address: the same server can be set up twice, and the second run must not
 * inherit the first one's answers.
 *
 * Nothing here reaches into `src/ipc`: a pure machine module owns its own
 * types, and the wire schema asserts against them rather than the other way
 * round.
 */

export const COOLIFY_SETUP_INVOCATION_KIND = "coolify-setup" as const;

/** Keyed by host: one machine at a time, and which one matters. */
export type CoolifySetupInvocationRef = InvocationRef<
  typeof COOLIFY_SETUP_INVOCATION_KIND,
  string
>;

/** How much installer output is kept. The end is what explains a failure. */
export const MAX_LOG_CHARS = 20_000;

export interface CoolifySetupRunning {
  type: "running";
  host: string;
  invocationRef: CoolifySetupInvocationRef;
  step: SetupStep;
  log: string;
  /** True once the user has asked it to stop and before it has. */
  stopping: boolean;
}

export interface CoolifySetupDone {
  type: "done";
  host: string;
  invocationRef: CoolifySetupInvocationRef;
  result: SetupResult;
}

export interface CoolifySetupFailed {
  type: "failed";
  host: string;
  invocationRef: CoolifySetupInvocationRef;
  message: string;
  /** Kept: the installer's own last words are what explain the failure. */
  log: string;
  /** Cancelling is the user's decision, not a fault of the install. */
  cancelled: boolean;
}

export type CoolifySetupState =
  | { type: "idle" }
  | CoolifySetupRunning
  | CoolifySetupDone
  | CoolifySetupFailed;

export const IDLE: CoolifySetupState = { type: "idle" };

/**
 * What the machine asks the controller to do.
 *
 * Kept out of the handler so the rules that decide them are testable without
 * a server: one setup at a time, and cancelling only something that is
 * running.
 */
export type CoolifySetupCommand =
  | {
      type: "launch";
      invocationRef: CoolifySetupInvocationRef;
      target: SetupTarget;
    }
  | { type: "abort"; invocationRef: CoolifySetupInvocationRef };

export type CoolifySetupEvent =
  | {
      type: "start-requested";
      invocationRef: CoolifySetupInvocationRef;
      target: SetupTarget;
    }
  | { type: "cancel-requested" }
  | {
      type: "progress";
      invocationRef: CoolifySetupInvocationRef;
      step: SetupStep;
      output?: string;
    }
  | {
      type: "succeeded";
      invocationRef: CoolifySetupInvocationRef;
      result: SetupResult;
    }
  | {
      type: "failed";
      invocationRef: CoolifySetupInvocationRef;
      message: string;
      cancelled: boolean;
    }
  /** The user has read the terminal screen and moved on. */
  | { type: "dismissed" };

export type CoolifySetupIgnoreReason =
  | StaleOperationIgnoreReason
  /** One server at a time: two installs would fight over the same docker. */
  | "already-running"
  /** Nothing is running, so there is nothing this could belong to. */
  | "not-running"
  /** Dismissing while it runs would hide work that is still going on. */
  | "still-running";

export type TransitionResult = GenericTransitionResult<
  CoolifySetupState,
  CoolifySetupCommand,
  CoolifySetupIgnoreReason
>;
