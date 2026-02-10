import { useEffect, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatSummary } from "@/lib/schemas";
import { useChats } from "@/hooks/useChats";
import { useSelectChat } from "@/hooks/useSelectChat";
import {
  recentViewedChatIdsAtom,
  removeRecentViewedChatIdAtom,
  pushRecentViewedChatIdAtom,
} from "@/atoms/chatAtoms";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_TABS = 3;

export function getVisibleRecentChats(
  recentViewedChatIds: number[],
  chats: ChatSummary[],
  limit = MAX_VISIBLE_TABS,
): ChatSummary[] {
  if (recentViewedChatIds.length === 0 || chats.length === 0 || limit <= 0) {
    return [];
  }

  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const visibleTabs: ChatSummary[] = [];

  for (const chatId of recentViewedChatIds) {
    const chat = chatsById.get(chatId);
    if (!chat) continue;
    visibleTabs.push(chat);
    if (visibleTabs.length >= limit) break;
  }

  return visibleTabs;
}

export function getFallbackChatIdAfterClose(
  tabs: ChatSummary[],
  closedChatId: number,
): number | null {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedChatId);
  if (closedIndex === -1) return null;

  const remainingTabs = tabs.filter((tab) => tab.id !== closedChatId);
  if (remainingTabs.length === 0) return null;

  const fallbackIndex = Math.min(closedIndex, remainingTabs.length - 1);
  return remainingTabs[fallbackIndex]?.id ?? null;
}

interface ChatTabsProps {
  appId: number | null;
  selectedChatId: number | null;
}

export function ChatTabs({ appId, selectedChatId }: ChatTabsProps) {
  const { t } = useTranslation("chat");
  const { chats } = useChats(appId);
  const recentViewedChatIds = useAtomValue(recentViewedChatIdsAtom);
  const removeRecentViewedChatId = useSetAtom(removeRecentViewedChatIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const { selectChat } = useSelectChat();

  useEffect(() => {
    if (selectedChatId !== null) {
      pushRecentViewedChatId(selectedChatId);
    }
  }, [selectedChatId, pushRecentViewedChatId]);

  const tabs = useMemo(
    () => getVisibleRecentChats(recentViewedChatIds, chats),
    [recentViewedChatIds, chats],
  );

  const handleTabClick = (chat: ChatSummary) => {
    selectChat({ chatId: chat.id, appId: chat.appId });
  };

  const handleCloseTab = (chatId: number) => {
    const closedTab = tabs.find((tab) => tab.id === chatId);
    const fallbackChatId = getFallbackChatIdAfterClose(tabs, chatId);

    removeRecentViewedChatId(chatId);

    if (!closedTab || selectedChatId !== chatId || fallbackChatId === null) {
      return;
    }

    const fallbackTab = tabs.find((tab) => tab.id === fallbackChatId);
    if (!fallbackTab) return;

    selectChat({ chatId: fallbackTab.id, appId: fallbackTab.appId });
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((chat) => {
        const isActive = selectedChatId === chat.id;
        const title = chat.title?.trim() || t("newChat");

        return (
          <div
            key={chat.id}
            className={cn(
              "group flex h-7 max-w-44 min-w-0 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm border-border"
                : "bg-muted/50 text-muted-foreground hover:bg-muted border-transparent",
            )}
          >
            <button
              type="button"
              onClick={() => handleTabClick(chat)}
              className="min-w-0 flex-1 truncate text-left"
              aria-current={isActive ? "page" : undefined}
            >
              {title}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCloseTab(chat.id);
              }}
              className={cn(
                "rounded-sm p-0.5 transition-colors",
                isActive
                  ? "opacity-80 hover:bg-muted"
                  : "opacity-0 group-hover:opacity-80 hover:bg-background/50",
              )}
              aria-label={t("closeChatTab", { title })}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
