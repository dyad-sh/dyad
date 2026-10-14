import { change, ignore, type TransitionResult } from "@/state_machines/types";
import {
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  type IntegrationCommand,
  type IntegrationEvent,
  type IntegrationIgnoreReason,
  type IntegrationState,
} from "./state";

export type IntegrationTransitionResult = TransitionResult<
  IntegrationState,
  IntegrationCommand,
  IntegrationIgnoreReason
>;

function conflictPauseDetail(fileCount: number): string {
  return fileCount === 1
    ? "A conflict in 1 file needs your attention. Reply in this chat to continue resolving it."
    : `Conflicts in ${fileCount} files need your attention. Reply in this chat to continue resolving them.`;
}

export function transitionIntegration(
  state: IntegrationState,
  event: IntegrationEvent,
): IntegrationTransitionResult {
  switch (event.type) {
    case "REQUESTED": {
      switch (state.phase) {
        case "idle":
        case "merged":
        case "failed":
        case "paused":
        case "resolving-conflicts":
          return change(
            {
              phase: "queued",
              detail: null,
              targetCommit: null,
              repairAttempts: 0,
            },
            [{ type: "schedule" }],
          );
        case "queued":
        case "merging":
        case "validating":
        case "integrating":
          return ignore(state, "already-pending");
        default:
          return assertNever(state.phase);
      }
    }
    case "STARTED": {
      if (state.phase !== "queued") {
        return ignore(state, "invalid-in-current-state");
      }
      return change(
        {
          ...state,
          phase: "merging",
          detail: null,
          targetCommit: event.targetCommit,
        },
        [{ type: "merge", targetCommit: event.targetCommit }],
      );
    }
    case "WAITING": {
      switch (state.phase) {
        case "queued":
        case "merging":
        case "validating":
        case "integrating":
          if (state.phase === "queued" && state.detail === event.reason) {
            return ignore(state, "already-pending");
          }
          return change({
            ...state,
            phase: "queued",
            detail: event.reason,
            targetCommit: null,
          });
        case "idle":
        case "resolving-conflicts":
        case "merged":
        case "paused":
        case "failed":
          return ignore(state, "invalid-in-current-state");
        default:
          return assertNever(state.phase);
      }
    }
    case "MERGE_CLEAN": {
      if (state.phase !== "merging") return ignore(state, "stale-operation");
      return change({ ...state, phase: "validating", detail: null }, [
        { type: "validate" },
      ]);
    }
    case "NOTHING_TO_INTEGRATE": {
      if (state.phase !== "merging" && state.phase !== "integrating") {
        return ignore(state, "stale-operation");
      }
      return change({
        phase: "merged",
        detail: null,
        targetCommit: null,
        repairAttempts: 0,
      });
    }
    case "MERGE_CONFLICTED": {
      if (state.phase !== "merging") return ignore(state, "stale-operation");
      if (state.repairAttempts >= MAX_AUTOMATIC_REPAIR_ATTEMPTS) {
        return change({
          ...state,
          phase: "paused",
          detail: conflictPauseDetail(event.conflictedFiles.length),
        });
      }
      const attempt = state.repairAttempts + 1;
      return change(
        {
          ...state,
          phase: "resolving-conflicts",
          detail: null,
          repairAttempts: attempt,
        },
        [
          {
            type: "dispatch-repair",
            conflictedFiles: event.conflictedFiles,
            attempt,
          },
        ],
      );
    }
    case "REPAIR_SETTLED": {
      if (state.phase !== "resolving-conflicts" && state.phase !== "paused") {
        return ignore(state, "stale-operation");
      }
      switch (event.outcome) {
        case "resolved":
          return change({ ...state, phase: "validating", detail: null }, [
            { type: "validate" },
          ]);
        case "unresolved":
        case "interrupted": {
          const detail =
            event.detail ??
            (event.outcome === "interrupted"
              ? "Conflict resolution was interrupted. Send a message in this chat to continue."
              : "Conflicts remain. Reply in this chat to continue resolving them.");
          if (state.phase === "paused" && state.detail === detail) {
            return ignore(state, "already-pending");
          }
          return change({ ...state, phase: "paused", detail });
        }
        default:
          return assertNever(event.outcome);
      }
    }
    case "VALIDATION_PASSED": {
      if (state.phase !== "validating" || state.targetCommit === null) {
        return ignore(state, "stale-operation");
      }
      return change({ ...state, phase: "integrating", detail: null }, [
        { type: "integrate", targetCommit: state.targetCommit },
      ]);
    }
    case "VALIDATION_FAILED": {
      if (state.phase !== "validating") {
        return ignore(state, "stale-operation");
      }
      return change({ ...state, phase: "failed", detail: event.summary });
    }
    case "TARGET_ADVANCED": {
      if (state.phase !== "integrating" && state.phase !== "validating") {
        return ignore(state, "stale-operation");
      }
      return change(
        {
          ...state,
          phase: "merging",
          detail: null,
          targetCommit: event.targetCommit,
        },
        [{ type: "merge", targetCommit: event.targetCommit }],
      );
    }
    case "INTEGRATED": {
      if (state.phase !== "integrating") {
        return ignore(state, "stale-operation");
      }
      return change({
        phase: "merged",
        detail: null,
        targetCommit: null,
        repairAttempts: 0,
      });
    }
    case "FAILED": {
      switch (state.phase) {
        case "queued":
        case "merging":
        case "resolving-conflicts":
        case "validating":
        case "integrating":
          return change({ ...state, phase: "failed", detail: event.reason });
        case "idle":
        case "merged":
        case "paused":
        case "failed":
          return ignore(state, "invalid-in-current-state");
        default:
          return assertNever(state.phase);
      }
    }
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled integration value: ${JSON.stringify(value)}`);
}
