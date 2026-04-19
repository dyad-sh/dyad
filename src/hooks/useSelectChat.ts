import { useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();

  const selectChat = useCallback(
    ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }

      const navigationResult = navigate({
        to: "/chat",
        search: { id: chatId },
      });

      if (prefillInput !== undefined) {
        Promise.resolve(navigationResult)
          .then(() => {
            setChatInputValue(prefillInput);
          })
          .catch(() => {});
      }
    },
    [
      addSessionOpenedChatId,
      navigate,
      pushRecentViewedChatId,
      setChatInputValue,
      setSelectedAppId,
      setSelectedChatId,
    ],
  );

  return useMemo(() => ({ selectChat }), [selectChat]);
}
