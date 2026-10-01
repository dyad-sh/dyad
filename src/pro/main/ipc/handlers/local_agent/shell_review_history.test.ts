import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./tools/types";
import { recordShellReviewOutcome } from "./shell_review_history";
function context() {
  return {
    shellReviewContext: { tools: [], history: [] },
  } as unknown as AgentContext;
}
describe("shell fallback evidence", () => {
  it.each([
    DyadErrorKind.Validation,
    DyadErrorKind.NotFound,
    DyadErrorKind.Conflict,
    DyadErrorKind.RateLimited,
    DyadErrorKind.Auth,
    DyadErrorKind.Precondition,
    DyadErrorKind.UserCancelled,
  ])("does not treat %s refusal as failed execution", (kind) => {
    const ctx = context();
    recordShellReviewOutcome(
      ctx,
      "read_file",
      { path: "../private" },
      {
        error: new DyadError("Rejected", kind),
        executed: true,
      },
    );
    expect(ctx.shellReviewContext!.history[0].outcome).toBe(
      "Not executed or denied; not eligible for shell fallback.",
    );
  });
  it("retains real execution failures as untrusted evidence", () => {
    const ctx = context();
    recordShellReviewOutcome(
      ctx,
      "read_file",
      {},
      { error: new Error("Read failed"), executed: true },
    );
    expect(ctx.shellReviewContext!.history[0].outcome).toContain(
      "Execution failed",
    );
  });
});
