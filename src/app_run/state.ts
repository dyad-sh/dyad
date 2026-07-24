import type { RuntimeMode2 } from "@/lib/schemas";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import type { StaleOperationIgnoreReason } from "@/state_machines/types";

export const APP_RUN_INVOCATION_KIND = "app-run" as const;
export type AppRunInvocationRef = InvocationRef<
  typeof APP_RUN_INVOCATION_KIND,
  number
>;

/**
 * Types for the per-app run-state machine.
 *
 * This file is types-only: no runtime imports, no runtime code. The pure
 * transition function lives in `transition.ts`; side effects live in
 * `commands.ts`; orchestration (invocation minting, serial command execution)
 * lives in `controller.ts`.
 *
 * Every non-idle state carries both `appId` and `invocationRef`. The app ID is
 * domain data; the ref is the globally unique correlation identity for one
 * run / restart / rebuild / stop operation. Async completions and producer
 * events echo the ref so callbacks from superseded process lifetimes cannot
 * advance the current operation.
 */

export type RunOperation = "run" | "restart" | "rebuild";

export type ReloadReason = "hmr" | "manual";

export interface RestartOptions {
  removeNodeModules: boolean;
  recreateSandbox: boolean;
}

export interface RunErrorInfo {
  message: string;
}

/** A ready dev-server URL as reported by the dyad proxy server. */
export interface RunUrl {
  appUrl: string;
  originalUrl: string;
  mode: RuntimeMode2;
}

export type RunState =
  | { type: "idle" }
  | {
      type: "starting";
      appId: number;
      invocationRef: AppRunInvocationRef;
      operation: RunOperation;
      startedAt: number;
      /**
       * A URL from this same invocation that arrived before the run/restart
       * IPC settled. Cloud restarts legitimately report the current URL
       * first, so this distinct ordering race still requires buffering.
       */
      pendingUrl: RunUrl | null;
    }
  | {
      type: "ready";
      appId: number;
      invocationRef: AppRunInvocationRef;
      /**
       * Null when the process spawned but the dev server hasn't reported a
       * URL yet (the run IPC resolves at spawn time, before the server is
       * reachable).
       */
      url: RunUrl | null;
    }
  | {
      type: "reloading";
      appId: number;
      invocationRef: AppRunInvocationRef;
      reason: ReloadReason;
      url: RunUrl | null;
    }
  | {
      type: "stopping";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
    }
  | {
      type: "stopped";
      appId: number;
      invocationRef: AppRunInvocationRef;
      exitCode: number | null;
    }
  | {
      type: "errored";
      appId: number;
      invocationRef: AppRunInvocationRef;
      error: RunErrorInfo;
    };

export type RunEvent =
  | {
      type: "START";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
    }
  | {
      type: "RESTART";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
      options: RestartOptions;
    }
  | {
      type: "REBUILD";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
    }
  | {
      type: "EXTERNAL_RESTART";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
      operation: "restart" | "rebuild";
    }
  | {
      type: "STOP";
      appId: number;
      invocationRef: AppRunInvocationRef;
      startedAt: number;
    }
  | { type: "RUN_IPC_RESOLVED"; invocationRef: AppRunInvocationRef }
  | {
      type: "RUN_IPC_FAILED";
      invocationRef: AppRunInvocationRef;
      error: RunErrorInfo;
    }
  | { type: "STOP_IPC_RESOLVED"; invocationRef: AppRunInvocationRef }
  | {
      type: "STOP_IPC_FAILED";
      invocationRef: AppRunInvocationRef;
      error: RunErrorInfo;
    }
  | {
      type: "PROXY_READY";
      appId: number;
      invocationRef: AppRunInvocationRef;
      url: RunUrl;
    }
  | { type: "HMR_DETECTED"; appId: number }
  | { type: "MANUAL_RELOAD"; appId: number }
  | { type: "RELOAD_DONE"; invocationRef: AppRunInvocationRef }
  | {
      type: "APP_EXIT";
      appId: number;
      invocationRef: AppRunInvocationRef;
      exitCode: number | null;
      timestamp: number;
    };

export type RunCommand =
  | {
      type: "start";
      appId: number;
      invocationRef: AppRunInvocationRef;
      operation: RunOperation;
      startedAt: number;
      options: RestartOptions;
    }
  | {
      type: "prepareExternalStart";
      appId: number;
      operation: "restart" | "rebuild";
    }
  | {
      type: "stop";
      appId: number;
      invocationRef: AppRunInvocationRef;
    }
  | { type: "applyUrl"; appId: number; url: RunUrl }
  | { type: "bumpReloadToken"; appId: number }
  | {
      type: "reload";
      appId: number;
      invocationRef: AppRunInvocationRef;
      reason: ReloadReason;
    }
  | { type: "clearError"; appId: number }
  | { type: "setError"; appId: number; error: RunErrorInfo };

export type AppRunIgnoreReason =
  | "invalid-in-current-state"
  | StaleOperationIgnoreReason
  | "no-change";

export type TransitionResult =
  import("@/state_machines/types").TransitionResult<
    RunState,
    RunCommand,
    AppRunIgnoreReason
  >;
