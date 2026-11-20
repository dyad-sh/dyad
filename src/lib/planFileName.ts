/**
 * The file name shown for a chat's plan. A saved plan keeps its own slug, so a
 * legacy file such as `chat-1-20260101.md` shows its real name. A plan that is
 * not saved yet gets the name that the next save writes.
 */
export function planFileName(
  chatId: number,
  savedPlan?: { id: string; chatId: number | null } | null,
): string {
  return `${savedPlan?.chatId === chatId ? savedPlan.id : `chat-${chatId}-plan`}.md`;
}
