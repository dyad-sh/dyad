import { createContext, useContext, type PropsWithChildren } from "react";

import type { ChatStreamManager } from "./manager";

const ChatStreamContext = createContext<ChatStreamManager | null>(null);

export function ChatStreamProvider({
  manager,
  children,
}: PropsWithChildren<{ manager: ChatStreamManager }>) {
  return (
    <ChatStreamContext.Provider value={manager}>
      {children}
    </ChatStreamContext.Provider>
  );
}

export function useChatStreamManager(): ChatStreamManager {
  const manager = useContext(ChatStreamContext);
  if (!manager) {
    throw new Error("useChatStreamManager requires ChatStreamProvider");
  }
  return manager;
}
