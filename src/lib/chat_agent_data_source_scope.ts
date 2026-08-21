/**
 * Resolves the trusted database allow-list for a Chat Agent turn.
 *
 * A conversation can narrow access to an explicit subset. When it has no
 * saved subset (including conversations created before source selection was
 * persisted), the enabled Data Sources permission cards are authoritative.
 */
export function resolveChatAgentDataSourceScope(
  requestedIds: string[] | undefined,
  enabledIds: string[],
): string[] {
  return [...new Set(requestedIds?.length ? requestedIds : enabledIds)];
}
