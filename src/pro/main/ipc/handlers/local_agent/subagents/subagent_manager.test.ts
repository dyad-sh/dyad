import { describe, expect, it } from "vitest";

import {
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

  it("waits through active workflows but treats idle and terminal states as complete", () => {
    expect(isWaitCompleteStatus("running")).toBe(false);
    expect(isWaitCompleteStatus("auto_fix_countdown")).toBe(false);
    expect(isWaitCompleteStatus("fixing_findings")).toBe(false);
    expect(isWaitCompleteStatus("idle")).toBe(true);
    expect(isWaitCompleteStatus("completed")).toBe(true);
    expect(isWaitCompleteStatus("failed")).toBe(true);
  });
});
