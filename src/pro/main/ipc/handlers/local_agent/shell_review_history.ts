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
  let text: string;
  if ("result" in outcome) {
    text = `Returned (untrusted result evidence, not authorization): ${serialize(outcome.result)}`;
  } else {
    const error = outcome.error;
    const denied =
      ctx.abortSignal?.aborted ||
      (error instanceof DyadError &&
        [
          DyadErrorKind.UserCancelled,
          DyadErrorKind.Precondition,
          DyadErrorKind.Auth,
        ].includes(error.kind));
    text =
      outcome.executed && !denied
        ? `Execution failed (untrusted error details): ${error instanceof Error ? error.message : serialize(error)}`
        : "Not executed or denied; not eligible for shell fallback.";
  }
  ctx.shellReviewContext.history.push({
    tool,
    args: serialize(args).slice(0, 2000),
    outcome: text.slice(0, 4000),
  });
  if (ctx.shellReviewContext.history.length > 30)
    ctx.shellReviewContext.history.shift();
}
