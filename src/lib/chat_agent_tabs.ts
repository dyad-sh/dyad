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
