import { estimateTokens } from "@/ipc/utils/token_utils";
import type { ShellProcessResult } from "./shell_process";

export const SHELL_MODEL_RESULT_TOKEN_LIMIT = 20_000;
type ShellToolResult = ShellProcessResult & { reason: string; note?: string };

/** Bound serialized model context independently of the retained chat output. */
export function serializeShellResultForModel(result: ShellToolResult): string {
  const full = JSON.stringify(result);
  if (estimateTokens(full) <= SHELL_MODEL_RESULT_TOKEN_LIMIT) return full;

  const capMetadata = (value: string) =>
    value.length > 4000 ? `${value.slice(0, 4000)}…[truncated]` : value;
  const base = {
    ...result,
    reason: capMetadata(result.reason),
    ...(result.note ? { note: capMetadata(result.note) } : {}),
    truncated: true,
    outputNotice:
      "Output truncated for model context; the full retained output is available in chat.",
  };
  const serialize = (budget: number) => {
    let stderrLength = Math.min(result.stderr.length, Math.floor(budget / 2));
    const stdoutLength = Math.min(result.stdout.length, budget - stderrLength);
    stderrLength = Math.min(result.stderr.length, budget - stdoutLength);
    return JSON.stringify({
      ...base,
      stdout: stdoutLength ? result.stdout.slice(-stdoutLength) : "",
      stderr: stderrLength ? result.stderr.slice(-stderrLength) : "",
    });
  };
  // Search serialized size so quotes, control characters, and metadata count too.
  let low = 0;
  let high = result.stdout.length + result.stderr.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(serialize(middle)) <= SHELL_MODEL_RESULT_TOKEN_LIMIT)
      low = middle;
    else high = middle - 1;
  }
  return serialize(low);
}
