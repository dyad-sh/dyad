/**
 * Per-workspace integration lifecycle for isolated chat workspaces.
 *
 * Integration combines a chat's committed workspace work with the app's
 * target branch: merge the latest target commit into the workspace, resolve
 * conflicts there (by resuming the originating chat), validate the combined
 * result, and only then fast-forward the target to it.
 *
 * The state is persisted on the `chat_workspaces` row so a restart can tell a
 * queued integration from an unfinished merge or a failed validation. The
 * main-process queue (`src/ipc/services/workspace_integration_queue.ts`) owns
 * execution: it runs the commands this transition emits and feeds their
 * results back as events.
 *
 * Concurrency: one integration per app executes at a time; a workspace whose
 * repair turn is waiting for model output does not hold the queue. Events
 * from a superseded attempt are rejected by phase, never by arrival order.
 *
 * Dependency graph: workspace_integration -> state_machines (no domain
 * machines).
 */

export const INTEGRATION_PHASES = [
  "idle",
  "queued",
  "merging",
  "resolving-conflicts",
  "validating",
  "integrating",
  "merged",
  "paused",
  "failed",
] as const;
export type IntegrationPhase = (typeof INTEGRATION_PHASES)[number];

/** Automatic repair turns per integration attempt before asking the user. */
export const MAX_AUTOMATIC_REPAIR_ATTEMPTS = 2;

export interface IntegrationState {
  readonly phase: IntegrationPhase;
  /** User-facing explanation for waiting, paused, or failed phases. */
  readonly detail: string | null;
  /** Target commit captured for the attempt in progress. */
  readonly targetCommit: string | null;
  /** Automatic repair turns started during the current attempt. */
  readonly repairAttempts: number;
}

export const IDLE_INTEGRATION_STATE: IntegrationState = {
  phase: "idle",
  detail: null,
  targetCommit: null,
  repairAttempts: 0,
};

export type RepairOutcome =
  /** The merge was completed after confirming every conflict is resolved. */
  | "resolved"
  /** The turn finished but conflicts (or markers) remain. */
  | "unresolved"
  /** The turn was cancelled, hit its step limit, or failed. */
  | "interrupted";

export type IntegrationEvent =
  /** A writable turn committed work that the target does not contain yet. */
  | { type: "REQUESTED"; userInitiated: boolean }
  /** The queue acquired the workspace and is starting an attempt. */
  | { type: "STARTED"; targetCommit: string }
  /** Something the user can fix blocks the attempt; retry later. */
  | { type: "WAITING"; reason: string }
  /** The workspace already contains every target commit, or merged cleanly. */
  | { type: "MERGE_CLEAN" }
  /** Nothing in the workspace is missing from the target. */
  | { type: "NOTHING_TO_INTEGRATE" }
  | { type: "MERGE_CONFLICTED"; conflictedFiles: readonly string[] }
  /** A repair turn settled; the queue already verified the outcome. */
  | { type: "REPAIR_SETTLED"; outcome: RepairOutcome; detail?: string }
  | { type: "VALIDATION_PASSED" }
  | { type: "VALIDATION_FAILED"; summary: string }
  /** The target moved while validating; merge the newer commits first. */
  | { type: "TARGET_ADVANCED"; targetCommit: string }
  | { type: "INTEGRATED" }
  | { type: "FAILED"; reason: string };

export type IntegrationCommand =
  /** Ask the queue to (re)process this workspace. */
  | { type: "schedule" }
  /** Merge the captured target commit into the workspace. */
  | { type: "merge"; targetCommit: string }
  /** Resume the originating chat to resolve the in-progress merge. */
  | {
      type: "dispatch-repair";
      conflictedFiles: readonly string[];
      attempt: number;
    }
  | { type: "validate" }
  /** Fast-forward the target after rechecking it under claims. */
  | { type: "integrate"; targetCommit: string };

export type IntegrationIgnoreReason =
  | "already-pending"
  | "invalid-in-current-state"
  | "stale-operation";

export function isIntegrationActive(phase: IntegrationPhase): boolean {
  return (
    phase === "merging" || phase === "validating" || phase === "integrating"
  );
}

export function isIntegrationPending(phase: IntegrationPhase): boolean {
  return (
    phase === "queued" ||
    phase === "merging" ||
    phase === "resolving-conflicts" ||
    phase === "validating" ||
    phase === "integrating"
  );
}

/** UI capabilities for the integration status shown under the chat input. */
export function selectIntegrationCapabilities(state: IntegrationState) {
  return {
    canRetry: state.phase === "paused" || state.phase === "failed",
  };
}
