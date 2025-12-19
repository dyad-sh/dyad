import { useAtom } from "jotai";
import { useEffect } from "react";
import { chatsAtom, chatsLoadingAtom } from "@/atoms/chatAtoms";
import { getAllChats } from "@/lib/chat";
import type { ChatSummary } from "@/lib/schemas";

export function useChats(appId: number | null) {
  const [chats, setChats] = useAtom(chatsAtom);
  const [loading, setLoading] = useAtom(chatsLoadingAtom);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        setLoading(true);
        const chatList = await getAllChats(appId || undefined);
        setChats(chatList);
      } catch (error) {
        console.error("Failed to load chats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchChats();
  }, [appId, setChats, setLoading]);

  const refreshChats = async () => {
    try {
      setLoading(true);
      const chatList = await getAllChats(appId || undefined);
      setChats(chatList);
      return chatList;
    } catch (error) {
      console.error("Failed to refresh chats:", error);
      return [] as ChatSummary[];
    } finally {
      setLoading(false);
    }
  };

  return { chats, loading, refreshChats };
}
