/**
 * Fake responses for the MCP auto-consent classifier
 * (src/pro/main/ipc/handlers/local_agent/mcp_auto_consent.ts buildUserPayload).
 * Shared by the chat-completions and responses fake routes so tests exercise
 * both the allow and ask paths regardless of which protocol the selected fake
 * model uses.
 */

/** Tool the classifier answers slowly for, so tests can observe the
 * "AI reviewing" spinner and exercise the user-decides-first path. */
export const SLOW_CONSENT_TOOL = "print_envs";

export interface ConsentClassifierMatch {
  /** JSON decision body to return as the assistant message. */
  content: string;
  /** Tool name extracted from the payload. */
  toolName: string;
}

/**
 * Detect the classifier payload by its exact line-anchored labels (not bare
 * substrings — an unrelated chat prompt merely mentioning these words must not
 * be hijacked into a JSON decision), and decide off the tool NAME only so
 * conversation context containing e.g. "delete" doesn't flip the decision.
 */
export function matchConsentClassifierPayload(
  text: string,
): ConsentClassifierMatch | null {
  const toolMatch = text.match(/^Tool: (.+)$/m);
  if (
    !toolMatch ||
    !/^MCP server: /m.test(text) ||
    !/^Arguments: /m.test(text)
  ) {
    return null;
  }
  const toolName = toolMatch[1].trim();
  const risky = /(delete|drop|danger|destroy|remove)/i.test(toolName);
  return {
    content: JSON.stringify({
      reason: risky ? "destructive tool" : "safe tool",
      decision: risky ? "ask" : "allow",
    }),
    toolName,
  };
}
