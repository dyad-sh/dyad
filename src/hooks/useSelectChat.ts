import { useSetAtom } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";

/**
 * A hook for selecting a chat.
 * @returns {object} An object with a function to select a chat.
 * @property {(params: { chatId: number; appId: number }) => void} selectChat - A function to select a chat.
 */
export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const navigate = useNavigate();

  return {
    selectChat: ({ chatId, appId }: { chatId: number; appId: number }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      navigate({
        to: "/chat",
        search: { id: chatId },
      });
    },
  };
}
