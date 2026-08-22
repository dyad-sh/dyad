import { describe, expect, it } from "vitest";

import { subagentLifecycleState, type SubagentStatus } from "./state";
import {
  transitionSubagentLifecycle,
  type SubagentLifecycleEvent,
} from "./transition";

const STATUSES: readonly SubagentStatus[] = [
  "queued",
  "running",
  "stopping",
  "waiting_for_writer",
  "auto_fix_countdown",
  "fixing_findings",
  "completed",
  "partial",
  "review_outdated",
  "cancelled",
  "entitlement_revoked",
  "interrupted_by_restart",
  "failed",
];

const EVENTS: readonly SubagentLifecycleEvent[] = [
  { type: "START" },
  { type: "REQUEST_STOP" },
  {
    type: "FINISH",
    status: "completed",
    resultJson: null,
    error: null,
  },
  { type: "INTERRUPT_FOR_RESTART" },
  { type: "BEGIN_AUTO_FIX_COUNTDOWN", autoFixAtMs: 1 },
  { type: "CLAIM_REMEDIATION", source: "fix_button" },
  { type: "CLAIM_REMEDIATION", source: "queued_message_override" },
  { type: "SKIP_AUTO_FIX" },
  { type: "FAIL_REMEDIATION", error: "failed" },
  { type: "COMPLETE_REMEDIATION" },
  { type: "MARK_REVIEW_OUTDATED", error: "outdated" },
  { type: "QUEUE_FOLLOWUP" },
];

describe("transitionSubagentLifecycle", () => {
  it("is total across every persisted status and event", () => {
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const state = subagentLifecycleState({ status });
        const result = transitionSubagentLifecycle(state, event);
        expect(["applied", "ignored"]).toContain(result.kind);
      }
    }
  });

  it("retains the exact state reference for every ignored transition", () => {
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const state = subagentLifecycleState({ status });
        const result = transitionSubagentLifecycle(state, event);
        if (result.kind === "ignored") expect(result.state).toBe(state);
      }
    }
  });

  it("keeps a stop request nonterminal until the runner physically settles", () => {
    const running = subagentLifecycleState({ status: "running" });
    expect(
      transitionSubagentLifecycle(running, { type: "REQUEST_STOP" }),
    ).toMatchObject({ kind: "applied", state: { status: "stopping" } });
    expect(
      transitionSubagentLifecycle(
        subagentLifecycleState({ status: "stopping" }),
        {
          type: "FINISH",
          status: "cancelled",
          resultJson: null,
          error: "Cancelled by user.",
        },
      ),
    ).toMatchObject({ kind: "applied", state: { status: "cancelled" } });
  });

  it("creates a distinct, non-value-equal state for every applied transition", () => {
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const state = subagentLifecycleState({ status });
        const result = transitionSubagentLifecycle(state, event);
        if (result.kind !== "applied") continue;
        expect(result.state).not.toBe(state);
        expect(result.state).not.toEqual(state);
      }
    }
  });

  it("requires the countdown before a queued-message remediation claim", () => {
    const completed = subagentLifecycleState({ status: "completed" });
    const early = transitionSubagentLifecycle(completed, {
      type: "CLAIM_REMEDIATION",
      source: "queued_message_override",
    });
    expect(early).toMatchObject({
      kind: "ignored",
      reason: "invalid-remediation-state",
    });

    const countdown = transitionSubagentLifecycle(completed, {
      type: "BEGIN_AUTO_FIX_COUNTDOWN",
      autoFixAtMs: 1,
    });
    expect(countdown.kind).toBe("applied");
    if (countdown.kind !== "applied") return;
    expect(
      transitionSubagentLifecycle(countdown.state, {
        type: "CLAIM_REMEDIATION",
        source: "queued_message_override",
      }),
    ).toMatchObject({
      kind: "applied",
      state: {
        status: "fixing_findings",
        remediationSource: "queued_message_override",
      },
    });
  });
});
