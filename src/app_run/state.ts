import type { RuntimeMode2 } from "@/lib/schemas";

/**
 * Types for the per-app run-state machine.
 *
 * This file is types-only: no runtime imports, no runtime code. The pure
 * transition function lives in `transition.ts`; side effects live in
 * `commands.ts`; orchestration (runId epochs, serial command execution)
 * lives in `controller.ts`.
 *
 * Every non-idle state carries `{ appId, runId }`. The `runId` is an epoch
 * allocated by the controller each time a user-level operation (run /
 * restart / rebuild / stop) starts. Async completions (IPC promise
 * settlement, proxy stdout lines, reload completions) are tagged with the
 * runId they belong to, so completions from a superseded operation are
 * dropped instead of stomping the newer operation's state.
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
      runId: number;
      operation: RunOperation;
      startedAt: number;
      /**
       * Proxy URL that arrived while the run/restart IPC call was still in
       * flight. It is buffered (never applied directly) so a re-emitted
       * cached proxy line can't clear a fresh operation's loading state; it
       * is applied when the IPC call resolves. Cloud restarts legitimately
       * report the proxy URL before the restart IPC resolves, so buffering
       * (rather than dropping) is required.
       */
      pendingUrl: RunUrl | null;
    }
  | {
      type: "ready";
      appId: number;
      runId: number;
      /**
       * Null when the process spawned but the dev server hasn't reported a
       * URL yet (the run IPC resolves at spawn time, before the server is
       * reachable). Matches today's behavior where loading clears at IPC
       * settle while the preview keeps waiting for the URL.
       */
      url: RunUrl | null;
    }
  | {
      type: "reloading";
      appId: number;
      runId: number;
      reason: ReloadReason;
      url: RunUrl | null;
    }
  | {
      type: "stopping";
      appId: number;
      runId: number;
      startedAt: number;
    }
  | {
      type: "stopped";
      appId: number;
      runId: number;
      exitCode: number | null;
    }
  | {
      type: "errored";
      appId: number;
      runId: number;
      error: RunErrorInfo;
    };

export type RunEvent =
  // User-level operations. The controller allocates a fresh runId for each.
  | { type: "START"; appId: number; runId: number; startedAt: number }
  | {
      type: "RESTART";
      appId: number;
      runId: number;
      startedAt: number;
      options: RestartOptions;
    }
  | { type: "REBUILD"; appId: number; runId: number; startedAt: number }
  | {
      type: "EXTERNAL_RESTART";
      appId: number;
      runId: number;
      startedAt: number;
      operation: "restart" | "rebuild";
    }
  | { type: "STOP"; appId: number; runId: number; startedAt: number }
  // IPC completions, tagged with the runId of the operation they belong to.
  | { type: "RUN_IPC_RESOLVED"; runId: number }
  | { type: "RUN_IPC_FAILED"; runId: number; error: RunErrorInfo }
  | { type: "STOP_IPC_RESOLVED"; runId: number }
  | { type: "STOP_IPC_FAILED"; runId: number; error: RunErrorInfo }
  // Producer events derived from app stdout. The proxy line doesn't carry
  // operation identity on the wire; the controller stamps it with the
  // current epoch when it arrives.
  | { type: "PROXY_READY"; appId: number; runId: number; url: RunUrl }
  | { type: "HMR_DETECTED"; appId: number }
  | { type: "MANUAL_RELOAD"; appId: number }
  | { type: "RELOAD_DONE"; runId: number }
  | {
      type: "APP_EXIT";
      appId: number;
      exitCode: number | null;
      timestamp: number;
    };

export type RunCommand =
  /**
   * Run the full start pipeline for run/restart/rebuild: reset per-app
   * runtime state, clear logs (restart/rebuild), append the startup log
   * line ("Connecting to app..." etc.), then call the run/restart IPC and
   * report settlement via RUN_IPC_RESOLVED / RUN_IPC_FAILED.
   */
  | {
      type: "start";
      appId: number;
      runId: number;
      operation: RunOperation;
      startedAt: number;
      options: RestartOptions;
    }
  | {
      type: "prepareExternalStart";
      appId: number;
      operation: "restart" | "rebuild";
    }
  /** Call the stop IPC; report settlement via STOP_IPC_RESOLVED / _FAILED. */
  | { type: "stop"; appId: number; runId: number }
  /** Write the app URL atom and bump the preview reload token. */
  | { type: "applyUrl"; appId: number; url: RunUrl }
  /** Bump the preview reload token (iframe reload). */
  | { type: "bumpReloadToken"; appId: number }
  /** Bump the reload token, then report completion via RELOAD_DONE. */
  | { type: "reload"; appId: number; runId: number; reason: ReloadReason }
  /** Clear the per-app preview error. */
  | { type: "clearError"; appId: number }
  /** Set the per-app preview error. */
  | { type: "setError"; appId: number; error: RunErrorInfo };

export type TransitionResult =
  import("@/state_machines/types").TransitionResult<
    RunState,
    RunCommand,
    | "invalid-in-current-state"
    | "stale-run-id"
    | "stale-proxy-output"
    | "no-change"
  >;
