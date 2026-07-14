import { describe, expect, it } from "vitest";

import {
  buildReboundReviewState,
  buildBoundedModelHistory,
  isAcceptableImplementerJoinStatus,
  isReusableReviewStatus,
  isWaitCompleteStatus,
  SUBAGENT_NONTERMINAL_STATUSES,
} from "./subagent_manager";

describe("sub-agent manager status policy", () => {
  it("recovers every persisted nonterminal state after restart", () => {
    expect(SUBAGENT_NONTERMINAL_STATUSES).toEqual([
      "queued",
      "running",
      "idle",
      "waiting_for_writer",
      "waiting_for_auto_review",
      "auto_fix_countdown",
      "fixing_findings",
      "verification_review",
      "needs_approval",
    ]);
  });

  it("only reuses active or successfully completed same-hash reviews", () => {
    expect(isReusableReviewStatus("queued")).toBe(true);
    expect(isReusableReviewStatus("completed")).toBe(true);
    for (const status of [
      "failed",
      "cancelled",
      "interrupted_by_restart",
      "review_outdated",
      "partial",
      "entitlement_revoked",
    ]) {
      expect(isReusableReviewStatus(status)).toBe(false);
    }
  });

  it("clears prior remediation state when rebinding a reusable review", () => {
    const updatedAt = new Date("2026-07-14T00:00:00Z");

    expect(
      buildReboundReviewState(
        { sourceMessageId: 41, files: ["src/app.ts"] },
        42,
        updatedAt,
      ),
    ).toEqual({
      contextJson: { sourceMessageId: 42, files: ["src/app.ts"] },
      remediationSource: null,
      autoFixAt: null,
      updatedAt,
    });
  });

  it("waits through active workflows but treats idle and terminal states as complete", () => {
    expect(isWaitCompleteStatus("running")).toBe(false);
    expect(isWaitCompleteStatus("auto_fix_countdown")).toBe(false);
    expect(isWaitCompleteStatus("fixing_findings")).toBe(false);
    expect(isWaitCompleteStatus("idle")).toBe(true);
    expect(isWaitCompleteStatus("completed")).toBe(true);
    expect(isWaitCompleteStatus("failed")).toBe(true);
  });

  it("allows an intentionally cancelled Implementer to reach root finalization", () => {
    expect(isAcceptableImplementerJoinStatus("completed")).toBe(true);
    expect(isAcceptableImplementerJoinStatus("cancelled")).toBe(true);
    expect(isAcceptableImplementerJoinStatus("failed")).toBe(false);
    expect(isAcceptableImplementerJoinStatus("entitlement_revoked")).toBe(
      false,
    );
  });

  it("preserves consumed thread history for contextual follow-up turns", () => {
    expect(
      buildBoundedModelHistory({
        originalAssignment: "Compare both auth options",
        currentAssignment: "Address queued messages in order",
        messages: [
          {
            role: "root",
            content: "Focus on option two",
            consumed: true,
          },
          {
            role: "assistant",
            content: "Option two uses callbacks.",
            consumed: false,
          },
          {
            role: "root",
            content: "This is the pending follow-up",
            consumed: false,
          },
        ],
      }),
    ).toEqual([
      { role: "user", content: "Compare both auth options" },
      { role: "user", content: "Focus on option two" },
      { role: "assistant", content: "Option two uses callbacks." },
      { role: "user", content: "Address queued messages in order" },
    ]);
  });
});
