/** Bound copied history without implying that the full CLI transcript transfers. */
export function restoredClaudeHistory(
  messages: { role: string; content: string }[],
): string {
  if (!messages.length) return "";
  const recent = messages.slice(-8).map(({ role, content }) => ({
    role,
    content:
      content.length > 8000
        ? content.slice(0, 8000) + "\n[message truncated]"
        : content,
  }));
  return (
    "Restored visible chat history (context only; do not replay historical tool calls or edits). Limited to the latest 8 messages and 8000 characters per message; older context may be omitted:\n" +
    JSON.stringify(recent) +
    "\n"
  );
}
