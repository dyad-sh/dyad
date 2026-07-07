/**
 * Logging helper for the fake-LLM server.
 *
 * When the server is embedded in-process by the vitest chat-flow harness it
 * would otherwise flood test output with per-request dumps. Set
 * `FAKE_LLM_QUIET=1` (the harness does this by default) to silence the
 * informational logs. Real errors still go through `console.error` directly at
 * the call sites and are never suppressed.
 */
const QUIET = process.env.FAKE_LLM_QUIET === "1";

export function fakeLlmLog(...args: unknown[]): void {
  if (QUIET) {
    return;
  }
  console.log(...args);
}
