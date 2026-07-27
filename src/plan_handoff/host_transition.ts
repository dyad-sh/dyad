import { ignore } from "@/state_machines/types";
import type {
  PlanHandoffHostEvent,
  PlanHandoffHostState,
  PlanHandoffHostTransitionResult,
} from "./host_state";

export const PLAN_HANDOFF_DISPLAY_MS = 2500;

export function transitionPlanHandoffHost(
  state: PlanHandoffHostState,
  event: PlanHandoffHostEvent,
): PlanHandoffHostTransitionResult {
  switch (event.type) {
    case "ACCEPT":
      if (
        state.intent?.handoffId === event.intent.handoffId ||
        (state.phase !== "idle" &&
          state.phase !== "started" &&
          state.phase !== "failed" &&
          state.phase !== "cancelled")
      ) {
        return ignore(state, "already-running");
      }
      return {
        kind: "applied",
        state: {
          intent: event.intent,
          targetChatId: null,
          phase: "accepted",
          failure: null,
        },
        commands: [{ type: "begin-handoff", intent: event.intent }],
      };
    case "RESUME":
      if (
        !state.intent ||
        state.phase === "idle" ||
        state.phase === "started" ||
        state.phase === "failed" ||
        state.phase === "cancelled"
      ) {
        return ignore(state, "no-handoff");
      }
      return {
        kind: "applied",
        state,
        commands: [
          {
            type: state.phase === "accepted" ? "begin-handoff" : "run-handoff",
            intent: state.intent,
          },
        ],
      };
    case "DISPLAY_ELAPSED":
      if (
        state.intent?.handoffId !== event.handoffId ||
        state.phase !== "accepted"
      ) {
        return ignore(state, "stale-handoff");
      }
      return {
        kind: "applied",
        state,
        commands: [{ type: "run-handoff", intent: state.intent }],
      };
    case "CHECKPOINT":
      if (state.intent?.handoffId !== event.handoffId) {
        return ignore(state, "stale-handoff");
      }
      return {
        kind: "applied",
        state: {
          ...state,
          phase: event.phase,
          targetChatId: event.targetChatId ?? state.targetChatId,
          failure: null,
        },
        commands: [],
      };
    case "FAILED":
      if (state.intent?.handoffId !== event.handoffId) {
        return ignore(state, "stale-handoff");
      }
      return {
        kind: "applied",
        state: { ...state, phase: "failed", failure: event.error },
        commands: [],
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
