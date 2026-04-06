import { useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";
import { useSettings } from "./useSettings";
import { useInitialChatMode } from "./useInitialChatMode";
import { ChatMode } from "@/lib/schemas";
import log from "electron-log";

const logger = log.scope("useSelectChat");

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();
  const { updateSettings } = useSettings();
  const initialChatMode = useInitialChatMode();

  return {
    selectChat: ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
      chatMode,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
      chatMode?: ChatMode | null;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Track this chat as opened in the current session
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }

      // Navigate immediately - don't block on async mode restoration
      const navigationResult = navigate({
        to: "/chat",
        search: { id: chatId },
      });

      //  Update settings with the chat's mode or effective global default
      // For null chatMode (legacy chats), use initialChatMode which accounts for:
      // - User's selectedChatMode setting (global default)
      // - Environment variables (DYAD_MODE override)
      // - Free agent quota availability
      const modeToSet = chatMode ?? initialChatMode;
      if (modeToSet) {
        updateSettings({ selectedChatMode: modeToSet }).catch((error) => {
          logger.error("Error updating chat mode:", error);
        });
      }

      if (prefillInput !== undefined) {
        Promise.resolve(navigationResult)
          .then(() => {
            setChatInputValue(prefillInput);
          })
          .catch(() => {
            // Ignore navigation errors here; navigation handling is centralized.
          });
      }
    },
  };
}
