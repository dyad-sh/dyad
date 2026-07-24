import { ignore } from "@/state_machines/types";
import type {
  ImageGenerationEvent,
  ImageGenerationState,
  ImageGenerationTransitionResult,
} from "./state";

export function transition(
  state: ImageGenerationState,
  event: ImageGenerationEvent,
): ImageGenerationTransitionResult {
  switch (state.type) {
    case "pending":
      switch (event.type) {
        case "JOB_SUCCEEDED":
          return succeed(state, event, false);
        case "JOB_FAILED":
          return {
            kind: "applied",
            state: { type: "failed", job: state.job, message: event.message },
            commands: [],
          };
        case "CANCEL_REQUESTED":
          return {
            kind: "applied",
            state: { type: "cancelling", job: state.job },
            commands: [{ type: "RequestCancel", jobId: state.job.id }],
          };
        case "CANCEL_CONFIRMED":
          return ignore(state, "invalid-in-current-state");
        default:
          return assertNever(event);
      }

    case "cancelling":
      switch (event.type) {
        case "JOB_SUCCEEDED":
          return succeed(state, event, true);
        case "JOB_FAILED":
          return event.kind === "user_cancelled"
            ? {
                kind: "applied",
                state: { type: "cancelled", job: state.job },
                commands: [],
              }
            : {
                kind: "applied",
                state: {
                  type: "failed",
                  job: state.job,
                  message: event.message,
                },
                commands: [],
              };
        case "CANCEL_REQUESTED":
          return ignore(state, "already-cancelling");
        case "CANCEL_CONFIRMED":
          // Applied command-settlement event. `cancelled: false` means main
          // already settled; either way the generation promise remains the
          // authority for the terminal state.
          return { kind: "applied", state, commands: [] };
        default:
          return assertNever(event);
      }

    case "succeeded":
    case "failed":
    case "cancelled":
      return ignore(state, "already-terminal");

    default:
      return assertNever(state);
  }
}

function succeed(
  state: Extract<ImageGenerationState, { type: "pending" | "cancelling" }>,
  event: Extract<ImageGenerationEvent, { type: "JOB_SUCCEEDED" }>,
  lateAfterCancel: boolean,
): ImageGenerationTransitionResult {
  return {
    kind: "applied",
    state: {
      type: "succeeded",
      job: state.job,
      result: event.result,
      lateAfterCancel,
    },
    commands: [{ type: "InvalidateMediaQueries" }],
  };
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected image-generation value: ${JSON.stringify(value)}`,
  );
}
