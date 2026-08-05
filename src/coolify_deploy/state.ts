import type { InvocationRef } from "@/state_machines/invocation_ref";
import type { StaleOperationIgnoreReason } from "@/state_machines/types";
import type { TransitionResult as GenericTransitionResult } from "@/state_machines/types";

export const COOLIFY_DEPLOY_INVOCATION_KIND = "coolify-deploy" as const;
export type CoolifyDeployInvocationRef = InvocationRef<
  typeof COOLIFY_DEPLOY_INVOCATION_KIND,
  number
>;

/**
 * Types for the per-app Coolify deployment machine.
 *
 * Types only: the pure transition lives in `transition.ts`, side effects in
 * `commands.ts` and `controller.ts`. Every event from a running deployment
 * echoes its invocation ref, so progress from a deployment that was cancelled
 * or superseded (by disconnecting, or by starting a second one) cannot revive
 * or overwrite the current state.
 */

/** Named steps, so the UI can show progress without parsing the log. */
export type CoolifyDeployStage = "preparing" | "configuring" | "building";

export interface CoolifyDeployRunning {
  type: "running";
  appId: number;
  invocationRef: CoolifyDeployInvocationRef;
  stage: CoolifyDeployStage;
  log: string;
  startedAt: number;
  deploymentUuid: string | null;
}

export type CoolifyDeployState =
  | { type: "idle" }
  | CoolifyDeployRunning
  | {
      type: "succeeded";
      appId: number;
      log: string;
      url: string | null;
      finishedAt: number;
    }
  | {
      type: "failed";
      appId: number;
      log: string;
      error: string;
      finishedAt: number;
      /**
       * Retained so a retry can adopt a deployment that may still be running
       * rather than starting a second one — a timeout does not stop the build.
       */
      deploymentUuid: string | null;
    };

export type CoolifyDeployEvent =
  | {
      type: "DEPLOY_REQUESTED";
      appId: number;
      invocationRef: CoolifyDeployInvocationRef;
      startedAt: number;
    }
  | {
      type: "STAGE_CHANGED";
      invocationRef: CoolifyDeployInvocationRef;
      stage: CoolifyDeployStage;
    }
  | {
      type: "LOG_APPENDED";
      invocationRef: CoolifyDeployInvocationRef;
      chunk: string;
    }
  | {
      type: "DEPLOYMENT_STARTED";
      invocationRef: CoolifyDeployInvocationRef;
      deploymentUuid: string;
    }
  | {
      type: "SUCCEEDED";
      invocationRef: CoolifyDeployInvocationRef;
      url: string | null;
      finishedAt: number;
    }
  | {
      type: "FAILED";
      invocationRef: CoolifyDeployInvocationRef;
      error: string;
      finishedAt: number;
    }
  /** Disconnecting abandons whatever is running for that app. */
  | { type: "CANCELLED"; appId: number; finishedAt: number };

export type CoolifyDeployCommand =
  | {
      type: "RUN_DEPLOY";
      appId: number;
      invocationRef: CoolifyDeployInvocationRef;
      /** A prior attempt's deployment, if one may still be in flight. */
      resumeDeploymentUuid: string | null;
    }
  | { type: "ABORT_DEPLOY"; invocationRef: CoolifyDeployInvocationRef };

export type CoolifyDeployIgnoreReason =
  | StaleOperationIgnoreReason
  | "no-change"
  | "nothing-to-cancel"
  | "other-app"
  | "already-running";

export type TransitionResult = GenericTransitionResult<
  CoolifyDeployState,
  CoolifyDeployCommand,
  CoolifyDeployIgnoreReason
>;

/** Keeps a runaway build log from growing without bound. */
export const MAX_LOG_CHARS = 200_000;
