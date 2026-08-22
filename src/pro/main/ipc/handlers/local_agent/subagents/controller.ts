import type { SubagentLifecycleState, SubagentStatus } from "./state";
import {
  transitionSubagentLifecycle,
  type SubagentLifecycleEvent,
} from "./transition";

export interface SubagentLifecyclePatch {
  status: SubagentStatus;
  remediationSource?: SubagentLifecycleState["remediationSource"];
  autoFixAt?: Date | null;
  resultJson?: Record<string, unknown> | null;
  error?: string | null;
  invocationSource?: "followup";
  startedAt?: Date | null;
  completedAt?: Date | null;
  updatedAt: Date;
}

export interface ApplySubagentLifecycleParams {
  state: SubagentLifecycleState;
  event: SubagentLifecycleEvent;
  now?: Date;
  persist: (
    expected: SubagentLifecycleState,
    patch: SubagentLifecyclePatch,
  ) => Promise<boolean>;
}

export async function applySubagentLifecycleTransition({
  state,
  event,
  now = new Date(),
  persist,
}: ApplySubagentLifecycleParams): Promise<
  | { kind: "ignored"; reason: string }
  | { kind: "applied"; state: SubagentLifecycleState }
  | { kind: "conflict" }
> {
  const transition = transitionSubagentLifecycle(state, event);
  if (transition.kind === "ignored") {
    return { kind: "ignored", reason: transition.reason };
  }
  const patch = lifecyclePatch(event, transition.state, now);
  if (!(await persist(state, patch))) return { kind: "conflict" };
  return { kind: "applied", state: transition.state };
}

function lifecyclePatch(
  event: SubagentLifecycleEvent,
  next: SubagentLifecycleState,
  now: Date,
): SubagentLifecyclePatch {
  const base = { status: next.status, updatedAt: now };
  switch (event.type) {
    case "START":
      return { ...base, startedAt: now };
    case "REQUEST_STOP":
      return {
        ...base,
        error: null,
      };
    case "FINISH":
      return {
        ...base,
        resultJson: event.resultJson,
        error: event.error,
        completedAt: now,
      };
    case "INTERRUPT_FOR_RESTART":
      return {
        ...base,
        remediationSource: null,
        autoFixAt: null,
        error: "Dyad restarted while this sub-agent was active.",
        completedAt: now,
      };
    case "BEGIN_AUTO_FIX_COUNTDOWN":
      return { ...base, autoFixAt: new Date(event.autoFixAtMs) };
    case "CLAIM_REMEDIATION":
      return {
        ...base,
        remediationSource: event.source,
        autoFixAt: null,
      };
    case "SKIP_AUTO_FIX":
      return { ...base, autoFixAt: null };
    case "FAIL_REMEDIATION":
      return {
        ...base,
        remediationSource: null,
        error: event.error,
        completedAt: now,
      };
    case "COMPLETE_REMEDIATION":
      return { ...base, completedAt: now };
    case "MARK_REVIEW_OUTDATED":
      return { ...base, error: event.error, completedAt: now };
    case "QUEUE_FOLLOWUP":
      return {
        ...base,
        invocationSource: "followup",
        resultJson: null,
        remediationSource: null,
        error: null,
        startedAt: null,
        completedAt: null,
      };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled sub-agent lifecycle event: ${String(value)}`);
}
