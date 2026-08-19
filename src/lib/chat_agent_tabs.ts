import type {
  ChatAgentConversation,
  ChatAgentOpenTab,
} from "@/components/chat-agent/types";

export function openChatAgentTab(
  tabs: ChatAgentOpenTab[],
  conversation: ChatAgentConversation,
) {
  const existing = tabs.find((tab) => tab.id === conversation.id);
  return existing ? tabs : [...tabs, conversation];
}

export function closeChatAgentTab(tabs: ChatAgentOpenTab[], closedId: string) {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedId);
  if (closedIndex < 0) {
    return { tabs, fallback: tabs[0] };
  }

  const remaining = tabs.filter((tab) => tab.id !== closedId);
  return {
    tabs: remaining,
    fallback:
      remaining[Math.min(closedIndex, remaining.length - 1)] ?? undefined,
  };
}

/** Mirrors live state into an existing tab without reviving a closed one. */
export function syncChatAgentTab(
  tabs: ChatAgentOpenTab[],
  snapshot: Omit<ChatAgentOpenTab, "projectId"> & {
    projectId?: string | null;
  },
) {
  const index = tabs.findIndex((tab) => tab.id === snapshot.id);
  if (index < 0) return tabs;
  const existing = tabs[index]!;
  const nextTab: ChatAgentOpenTab = {
    ...snapshot,
    projectId: snapshot.projectId ?? existing.projectId ?? null,
  };
  if (
    existing.messages === nextTab.messages &&
    existing.title === nextTab.title &&
    existing.vectorCollectionIds === nextTab.vectorCollectionIds &&
    existing.dataSourceIds === nextTab.dataSourceIds &&
    existing.projectId === nextTab.projectId
  ) {
    return tabs;
  }
  const next = [...tabs];
  next[index] = nextTab;
  return next;
}
