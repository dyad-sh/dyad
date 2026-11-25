/**
 * Stable per-chat plan slug. The main process saves a chat's plan as
 * `<slug>.md`, and the renderer shows that name, so both must use this
 * builder.
 */
export function canonicalPlanSlug(chatId: number): string {
  return `chat-${chatId}-plan`;
}
