import { ignore, type TransitionResult } from "@/state_machines/types";
import type { SubagentLifecycleState, SubagentTerminalStatus } from "./state";
import { isNonterminalSubagentStatus } from "./state";

export type RemediationSource = Exclude<
  SubagentLifecycleState["remediationSource"],
  null
>;

export type SubagentLifecycleEvent =
  | { readonly type: "START" }
  | { readonly type: "REQUEST_STOP" }
  | {
      readonly type: "FINISH";
      readonly status: Exclude<
        SubagentTerminalStatus,
        "interrupted_by_restart"
      >;
      readonly resultJson: Record<string, unknown> | null;
      readonly error: string | null;
    }
  | { readonly type: "INTERRUPT_FOR_RESTART" }
  | {
      readonly type: "BEGIN_AUTO_FIX_COUNTDOWN";
      readonly autoFixAtMs: number;
    }
  | {
      readonly type: "CLAIM_REMEDIATION";
      readonly source: RemediationSource;
    }
  | { readonly type: "SKIP_AUTO_FIX" }
  | {
      readonly type: "FAIL_REMEDIATION";
      readonly error: string;
    }
  | { readonly type: "COMPLETE_REMEDIATION" }
  | { readonly type: "MARK_REVIEW_OUTDATED"; readonly error: string }
  | { readonly type: "QUEUE_FOLLOWUP" };

export type SubagentLifecycleIgnoreReason =
  | "already-terminal"
  | "already-active"
  | "invalid-remediation-state"
  | "remediation-already-claimed"
  | "not-resumable";

type LifecycleTransition = TransitionResult<
  SubagentLifecycleState,
  never,
  SubagentLifecycleIgnoreReason
>;

function changed(
  state: SubagentLifecycleState,
  next: SubagentLifecycleState,
): LifecycleTransition {
  return { kind: "applied", state: next, commands: [] };
}

const FOLLOWUP_RESUMABLE = new Set<SubagentLifecycleState["status"]>([
  "completed",
  "partial",
  "review_outdated",
  "cancelled",
  "entitlement_revoked",
  "interrupted_by_restart",
  "failed",
]);

export function transitionSubagentLifecycle(
  state: SubagentLifecycleState,
  event: SubagentLifecycleEvent,
): LifecycleTransition {
  switch (event.type) {
    case "START":
      if (!isNonterminalSubagentStatus(state.status)) {
        return ignore(state, "already-terminal");
      }
      if (state.status === "running") return ignore(state, "already-active");
      return changed(state, { ...state, status: "running" });

    case "REQUEST_STOP":
      if (!isNonterminalSubagentStatus(state.status)) {
        return ignore(state, "already-terminal");
      }
      if (state.status === "stopping") return ignore(state, "already-active");
      return changed(state, { ...state, status: "stopping" });

    case "FINISH":
      if (!isNonterminalSubagentStatus(state.status)) {
        return ignore(state, "already-terminal");
      }
      return changed(state, { ...state, status: event.status });

    case "INTERRUPT_FOR_RESTART":
      if (!isNonterminalSubagentStatus(state.status)) {
        return ignore(state, "already-terminal");
      }
      return changed(state, {
        status: "interrupted_by_restart",
        remediationSource: null,
      });

    case "BEGIN_AUTO_FIX_COUNTDOWN":
      if (state.status !== "completed") {
        return ignore(state, "invalid-remediation-state");
      }
      if (state.remediationSource !== null) {
        return ignore(state, "remediation-already-claimed");
      }
      return changed(state, { ...state, status: "auto_fix_countdown" });

    case "CLAIM_REMEDIATION": {
      const expectedStatus =
        event.source === "queued_message_override"
          ? "auto_fix_countdown"
          : "completed";
      if (state.status !== expectedStatus) {
        return ignore(state, "invalid-remediation-state");
      }
      if (state.remediationSource !== null) {
        return ignore(state, "remediation-already-claimed");
      }
      return changed(state, {
        status: "fixing_findings",
        remediationSource: event.source,
      });
    }

    case "SKIP_AUTO_FIX":
      if (
        state.status !== "auto_fix_countdown" ||
        state.remediationSource !== null
      ) {
        return ignore(state, "invalid-remediation-state");
      }
      return changed(state, { ...state, status: "completed" });

    case "FAIL_REMEDIATION":
      if (state.status !== "fixing_findings") {
        return ignore(state, "invalid-remediation-state");
      }
      return changed(state, {
        status: "completed",
        remediationSource: null,
      });

    case "COMPLETE_REMEDIATION":
      if (state.status !== "fixing_findings") {
        return ignore(state, "invalid-remediation-state");
      }
      return changed(state, { ...state, status: "completed" });

    case "MARK_REVIEW_OUTDATED":
      if (state.status === "review_outdated") {
        return ignore(state, "already-terminal");
      }
      return changed(state, { ...state, status: "review_outdated" });

    case "QUEUE_FOLLOWUP":
      if (!FOLLOWUP_RESUMABLE.has(state.status)) {
        return ignore(state, "not-resumable");
      }
      return changed(state, { status: "queued", remediationSource: null });

    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled sub-agent lifecycle event: ${String(value)}`);
}
