import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./tools/types";

/** Host-recorded evidence, shared by native tools and both MCP execution paths. */
export function recordShellReviewOutcome(
  ctx: AgentContext,
  tool: string,
  args: unknown,
  outcome: { result: unknown } | { error: unknown; executed: boolean },
): void {
  if (!ctx.shellReviewContext || tool === "run_shell") return;
  const serialize = (value: unknown): string => {
    try {
      return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    } catch {
      return "[Unserializable evidence]";
    }
  };
  let status: "returned" | "execution_failed" | "not_executed_or_denied";
  if ("result" in outcome) {
    status = "returned";
  } else {
    const error = outcome.error;
    const denied =
      ctx.abortSignal?.aborted ||
      (error instanceof DyadError &&
        [
          DyadErrorKind.UserCancelled,
          DyadErrorKind.Precondition,
          DyadErrorKind.Auth,
          DyadErrorKind.Validation,
          DyadErrorKind.NotFound,
          DyadErrorKind.Conflict,
          DyadErrorKind.RateLimited,
        ].includes(error.kind));
    status =
      outcome.executed && !denied
        ? "execution_failed"
        : "not_executed_or_denied";
  }
  ctx.shellReviewContext.history.push({
    tool,
    args: serialize(args).slice(0, 2000),
    outcome: status,
  });
  if (ctx.shellReviewContext.history.length > 30)
    ctx.shellReviewContext.history.shift();
}
