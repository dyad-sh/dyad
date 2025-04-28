import { useCallback, useState } from "react";
import type { Message } from "@/ipc/ipc_types";
import { useAtom, useSetAtom } from "jotai";
import {
  chatErrorAtom,
  chatMessagesAtom,
  chatStreamCountAtom,
  isStreamingAtom,
} from "@/atoms/chatAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import type { ChatResponseEnd } from "@/ipc/ipc_types";
import { useChats } from "./useChats";
import { useLoadApp } from "./useLoadApp";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadVersions } from "./useLoadVersions";
import { showError } from "@/lib/toast";
import { useProposal } from "./useProposal";
import { useSearch } from "@tanstack/react-router";
import { useRunApp } from "./useRunApp";
import { useCountTokens } from "./useCountTokens";

export function getRandomNumberId() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

export function useStreamChat({
  hasChatId = true,
}: { hasChatId?: boolean } = {}) {
  const [messages, setMessages] = useAtom(chatMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(isStreamingAtom);
  const [error, setError] = useAtom(chatErrorAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { refreshChats } = useChats(selectedAppId);
  const { refreshApp } = useLoadApp(selectedAppId);
  const setStreamCount = useSetAtom(chatStreamCountAtom);
  const { refreshVersions } = useLoadVersions(selectedAppId);
  const { refreshAppIframe } = useRunApp();
  const { countTokens } = useCountTokens();

  let chatId: number | undefined;

  if (hasChatId) {
    const { id } = useSearch({ from: "/chat" });
    chatId = id;
  }
  let { refreshProposal } = hasChatId ? useProposal(chatId) : useProposal();

  const streamMessage = useCallback(
    async ({
      prompt,
      chatId,
      redo,
    }: {
      prompt: string;
      chatId: number;
      redo?: boolean;
    }) => {
      if (!prompt.trim() || !chatId) {
        return;
      }

      setError(null);
      setMessages((currentMessages: Message[]) => {
        if (redo) {
          let remainingMessages = currentMessages.slice();
          if (
            currentMessages[currentMessages.length - 1].role === "assistant"
          ) {
            remainingMessages = currentMessages.slice(0, -1);
          }
          return [
            ...remainingMessages,
            {
              id: getRandomNumberId(),
              role: "assistant",
              content: "",
            },
          ];
        }
        return [
          ...currentMessages,
          {
            id: getRandomNumberId(),
            role: "user",
            content: prompt,
          },
          {
            id: getRandomNumberId(),
            role: "assistant",
            content: "",
          },
        ];
      });
      setIsStreaming(true);
      setStreamCount((streamCount) => streamCount + 1);
      try {
        IpcClient.getInstance().streamMessage(prompt, {
          chatId,
          redo,
          onUpdate: (updatedMessages: Message[]) => {
            setMessages(updatedMessages);
          },
          onEnd: (response: ChatResponseEnd) => {
            if (response.updatedFiles) {
              setIsPreviewOpen(true);
              refreshAppIframe();
            }
            refreshProposal(chatId);

            // Keep the same as below
            setIsStreaming(false);
            refreshChats();
            refreshApp();
            refreshVersions();
            countTokens(chatId, "");
          },
          onError: (errorMessage: string) => {
            console.error(`[CHAT] Stream error for ${chatId}:`, errorMessage);
            setError(errorMessage);

            // Keep the same as above
            setIsStreaming(false);
            refreshChats();
            refreshApp();
            refreshVersions();
            countTokens(chatId, "");
          },
        });
      } catch (error) {
        console.error("[CHAT] Exception during streaming setup:", error);
        setIsStreaming(false);
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    [setMessages, setIsStreaming, setIsPreviewOpen]
  );

  return {
    streamMessage,
    isStreaming,
    error,
    setError,
    setIsStreaming,
  };
}
