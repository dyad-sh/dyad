import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";

export function assertNoTestingDecision(
  ctx: Pick<AgentContext, "testingDecision">,
): void {
  if (ctx.testingDecision?.requested) {
    throw new DyadError(
      "Tool admission is closed for this turn's testing decision. Wait for the user's choice and the fresh continuation turn before doing more work.",
      DyadErrorKind.Precondition,
    );
  }
}
