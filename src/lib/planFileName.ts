import { canonicalPlanSlug } from "@/shared/plan_slug";

/**
 * The file name shown for a chat's plan. A saved plan keeps its own slug, so a
 * legacy file such as `chat-1-20260101.md` shows its real name. The saved slug
 * counts only while its content is the plan on screen: the plan cache can keep
 * an older legacy plan after a new plan is written. In other cases the name is
 * the one that the next save writes.
 */
export function planFileName(
  chatId: number,
  savedPlan: { id: string; chatId: number | null; content: string } | null,
  currentContent: string | null | undefined,
): string {
  const useSavedSlug =
    savedPlan != null &&
    savedPlan.chatId === chatId &&
    savedPlan.content === currentContent;
  return `${useSavedSlug ? savedPlan.id : canonicalPlanSlug(chatId)}.md`;
}
