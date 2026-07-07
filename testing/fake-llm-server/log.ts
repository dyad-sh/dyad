/**
 * Logging helper for the fake-LLM server.
 *
 * When the server is embedded in-process by the vitest chat-flow harness it
 * would otherwise flood test output with per-request dumps. Set
 * `FAKE_LLM_QUIET=1` (the harness does this by default) to silence the
 * informational logs. Real errors still go through `console.error` directly at
 * the call sites and are never suppressed.
 */
// Read the env var at CALL time, not module-load time: the vitest chat-flow
// harness sets FAKE_LLM_QUIET=1 at runtime (inside setupChatFlowHarness), which
// is AFTER this module has already been imported by the statically-imported
// server. Capturing it in a module-level const would freeze the gate open and
// let per-request dumps (including the large system prompt) flood test output.
export function fakeLlmLog(...args: unknown[]): void {
  if (process.env.FAKE_LLM_QUIET === "1") {
    return;
  }
  console.log(...args);
}
