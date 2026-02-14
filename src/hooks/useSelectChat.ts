import { useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const navigate = useNavigate();

  return {
    selectChat: ({
      chatId,
      appId,
      preserveTabOrder = false,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Track this chat as opened in the current session
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }
      navigate({
        to: "/chat",
        search: { id: chatId },
      });
    },
  };
}
