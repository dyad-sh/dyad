import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";

import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import type { Message } from "@/ipc/types";

const EMPTY_CHAT_MESSAGES: Message[] = [];

export function useChatMessages(chatId: number | null | undefined): Message[] {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(
          chatMessagesByIdAtom,
          (messagesById) =>
            chatId == null
              ? EMPTY_CHAT_MESSAGES
              : (messagesById.get(chatId) ?? EMPTY_CHAT_MESSAGES),
          Object.is,
        ),
      [chatId],
    ),
  );
}

export function useChatMessagesLoaded(
  chatId: number | null | undefined,
): boolean {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(chatMessagesByIdAtom, (messagesById) =>
          chatId == null ? false : messagesById.has(chatId),
        ),
      [chatId],
    ),
  );
}

export function useChatMessageCount(chatId: number | null | undefined): number {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(chatMessagesByIdAtom, (messagesById) =>
          chatId == null ? 0 : (messagesById.get(chatId)?.length ?? 0),
        ),
      [chatId],
    ),
  );
}
