import type { TransitionResult } from "@/state_machines/types";
import type { PlanHandoffIntent, PlanHandoffRemoteSnapshot } from "./transport";

export interface PlanHandoffHostState {
  readonly intent: PlanHandoffIntent | null;
  readonly targetChatId: number | null;
  readonly phase: PlanHandoffRemoteSnapshot["phase"];
  readonly failure: string | null;
}

export type PlanHandoffHostEvent =
  | { type: "ACCEPT"; intent: PlanHandoffIntent }
  | { type: "RESUME" }
  | { type: "DISPLAY_ELAPSED"; handoffId: string }
  | {
      type: "CHECKPOINT";
      handoffId: string;
      phase: Exclude<PlanHandoffRemoteSnapshot["phase"], "idle">;
      targetChatId?: number;
    }
  | { type: "FAILED"; handoffId: string; error: string };

export type PlanHandoffCommand =
  | {
      type: "begin-handoff";
      intent: PlanHandoffIntent;
    }
  | {
      type: "run-handoff";
      intent: PlanHandoffIntent;
    };

export type PlanHandoffIgnoreReason =
  | "no-handoff"
  | "stale-handoff"
  | "already-running";

export type PlanHandoffHostTransitionResult = TransitionResult<
  PlanHandoffHostState,
  PlanHandoffCommand,
  PlanHandoffIgnoreReason
>;
