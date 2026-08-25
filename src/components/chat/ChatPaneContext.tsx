import { createContext, useContext, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

const ChatPaneContext = createContext<number | undefined>(undefined);

export function ChatPaneProvider({
  chatId,
  children,
}: {
  chatId: number | undefined;
  children: ReactNode;
}) {
  return (
    <ChatPaneContext.Provider value={chatId}>
      {children}
    </ChatPaneContext.Provider>
  );
}

export function usePaneChatId(): number | undefined {
  const paneChatId = useContext(ChatPaneContext);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  return paneChatId ?? selectedChatId ?? undefined;
}
