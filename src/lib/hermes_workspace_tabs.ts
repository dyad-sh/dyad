export type HermesWorkspaceTab = "dashboard" | string;

export type HermesWorkspaceTabRecord = {
  id: string;
  name: string;
  icon: string;
};

export function openHermesWorkspaceTab(
  openTabs: HermesWorkspaceTabRecord[],
  tab: HermesWorkspaceTabRecord,
): HermesWorkspaceTabRecord[] {
  return openTabs.some((current) => current.id === tab.id)
    ? openTabs.map((current) =>
        current.id === tab.id ? { ...current, ...tab } : current,
      )
    : [...openTabs, tab];
}

export function closeHermesWorkspaceTab(
  openAgentIds: string[],
  closingAgentId: string,
  activeTab: HermesWorkspaceTab,
): { openAgentIds: string[]; activeTab: HermesWorkspaceTab } {
  const closingIndex = openAgentIds.indexOf(closingAgentId);
  const nextIds = openAgentIds.filter((id) => id !== closingAgentId);

  if (activeTab !== closingAgentId) {
    return { openAgentIds: nextIds, activeTab };
  }

  return {
    openAgentIds: nextIds,
    activeTab:
      nextIds[closingIndex] ?? nextIds[closingIndex - 1] ?? "dashboard",
  };
}
