import type { ChatAgentMessage } from "@/components/chat-agent/types";

const MAX_TITLE_LENGTH = 56;

function visibleRequest(content: string) {
  if (content.includes("MCP_TOOL_MENU_SELECTION")) {
    const request = content.match(/(?:^|\n)User request:\s*([\s\S]+)$/i)?.[1];
    if (request?.trim()) return request.trim();
  }
  return content.trim();
}

export function chatAgentConversationTitle(messages: ChatAgentMessage[]) {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  if (!firstUser) return "New conversation";

  const normalized = visibleRequest(firstUser.content)
    .split(/\r?\n/)[0]!
    .replace(/\s+/g, " ")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (!normalized) return "New conversation";
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;

  const shortened = normalized.slice(0, MAX_TITLE_LENGTH + 1);
  const wordBoundary = shortened.lastIndexOf(" ");
  const title = shortened.slice(
    0,
    wordBoundary >= 32 ? wordBoundary : MAX_TITLE_LENGTH,
  );
  return `${title.trimEnd()}…`;
}
