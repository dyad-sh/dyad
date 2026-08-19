import type {
  ChatAgentConversation,
  ChatAgentOpenTab,
} from "@/components/chat-agent/types";
import { MAX_CHAT_AGENT_HISTORY } from "@/atoms/chatAgentAtoms";

export function mergeSettledChatTabsIntoHistory(
  history: ChatAgentConversation[],
  tabs: ChatAgentOpenTab[],
  busySessionIds: ReadonlySet<string>,
) {
  let next = history;
  for (const tab of tabs) {
    if (
      busySessionIds.has(tab.id) ||
      !tab.messages.some(
        (message) => message.role === "user" && message.content.trim(),
      )
    ) {
      continue;
    }
    const existingIndex = next.findIndex(
      (conversation) => conversation.id === tab.id,
    );
    const existing = next[existingIndex];
    if (
      existing?.messages === tab.messages &&
      existing.title === tab.title &&
      existing.vectorCollectionIds === tab.vectorCollectionIds &&
      existing.dataSourceIds === tab.dataSourceIds &&
      existing.projectId === tab.projectId
    ) {
      continue;
    }
    const conversation: ChatAgentConversation = {
      ...tab,
      updatedAt: tab.updatedAt || Date.now(),
    };
    next =
      existingIndex >= 0
        ? next.map((item, index) =>
            index === existingIndex ? conversation : item,
          )
        : [conversation, ...next];
  }
  return [...next]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHAT_AGENT_HISTORY);
}
